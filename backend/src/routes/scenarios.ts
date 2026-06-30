import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  scenarios,
  scenario_overrides,
  plan_lines,
  workspace_members,
} from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

function loadedCost(base: number, variable: number, burden: number, count: number): number {
  return (base + variable) * (1 + burden) * count
}

// ── GET / — public — list scenarios for a workspace ──────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(scenarios)
    .where(eq(scenarios.workspace_id, workspaceId))
    .orderBy(desc(scenarios.created_at))
  return c.json(rows)
})

// ── GET /:id — public — scenario + overrides + computed diff vs base ─────────
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [scenario] = await db.select().from(scenarios).where(eq(scenarios.id, id))
  if (!scenario) return c.json({ error: 'Not found' }, 404)

  const overrides = await db
    .select()
    .from(scenario_overrides)
    .where(eq(scenario_overrides.scenario_id, id))

  // Base plan lines for the scenario's plan.
  const baseLines = scenario.plan_id
    ? await db.select().from(plan_lines).where(eq(plan_lines.plan_id, scenario.plan_id))
    : []

  const overrideByLine = new Map<string, typeof overrides[number]>()
  for (const o of overrides) {
    if (o.plan_line_id) overrideByLine.set(o.plan_line_id, o)
  }

  const lineDiffs: Array<{
    plan_line_id: string
    role_title: string
    base_count: number
    scenario_count: number
    count_delta: number
    base_cost: number
    scenario_cost: number
    cost_delta: number
    base_start_quarter: number
    scenario_start_quarter: number
  }> = []

  let baseTotalCount = 0
  let scenarioTotalCount = 0
  let baseTotalCost = 0
  let scenarioTotalCost = 0

  for (const line of baseLines) {
    const o = overrideByLine.get(line.id)
    const baseCount = line.count ?? 1
    const baseBase = line.budgeted_base
    const baseStart = line.planned_start_quarter
    const scenarioCount = o?.override_count ?? baseCount
    const scenarioBase = o?.override_base ?? baseBase
    const scenarioStart = o?.override_start_quarter ?? baseStart

    const bCost = loadedCost(baseBase, line.budgeted_variable, line.burden_rate ?? 0, baseCount)
    const sCost = loadedCost(scenarioBase, line.budgeted_variable, line.burden_rate ?? 0, scenarioCount)

    baseTotalCount += baseCount
    scenarioTotalCount += scenarioCount
    baseTotalCost += bCost
    scenarioTotalCost += sCost

    lineDiffs.push({
      plan_line_id: line.id,
      role_title: line.role_title,
      base_count: baseCount,
      scenario_count: scenarioCount,
      count_delta: scenarioCount - baseCount,
      base_cost: bCost,
      scenario_cost: sCost,
      cost_delta: sCost - bCost,
      base_start_quarter: baseStart,
      scenario_start_quarter: scenarioStart,
    })
  }

  const diff = {
    base_total_count: baseTotalCount,
    scenario_total_count: scenarioTotalCount,
    count_delta: scenarioTotalCount - baseTotalCount,
    base_total_cost: baseTotalCost,
    scenario_total_cost: scenarioTotalCost,
    cost_delta: scenarioTotalCost - baseTotalCost,
    lines: lineDiffs,
  }

  return c.json({ ...scenario, overrides, diff })
})

// ── POST / — auth — create scenario ──────────────────────────────────────────
const createSchema = z.object({
  workspace_id: z.string().min(1),
  plan_id: z.string().min(1).optional(),
  name: z.string().min(1),
  description: z.string().optional().default(''),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [scenario] = await db
    .insert(scenarios)
    .values({
      workspace_id: body.workspace_id,
      plan_id: body.plan_id ?? null,
      name: body.name,
      description: body.description ?? '',
      created_by: userId,
    })
    .returning()
  return c.json(scenario, 201)
})

// ── POST /:id/overrides — auth — set (upsert) a plan-line override ───────────
const overrideSchema = z.object({
  plan_line_id: z.string().min(1),
  override_count: z.number().int().nullable().optional(),
  override_start_quarter: z.number().int().nullable().optional(),
  override_base: z.number().nullable().optional(),
})

router.post('/:id/overrides', authMiddleware, zValidator('json', overrideSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [scenario] = await db.select().from(scenarios).where(eq(scenarios.id, id))
  if (!scenario) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(scenario.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  if (scenario.is_frozen) return c.json({ error: 'Scenario is frozen' }, 409)

  // Verify the plan line belongs to this workspace.
  const [line] = await db.select().from(plan_lines).where(eq(plan_lines.id, body.plan_line_id))
  if (!line || line.workspace_id !== scenario.workspace_id) {
    return c.json({ error: 'plan_line not in workspace' }, 400)
  }

  // Upsert: one override per (scenario, plan_line).
  const [existing] = await db
    .select()
    .from(scenario_overrides)
    .where(
      and(
        eq(scenario_overrides.scenario_id, id),
        eq(scenario_overrides.plan_line_id, body.plan_line_id),
      ),
    )

  const values = {
    override_count: body.override_count ?? null,
    override_start_quarter: body.override_start_quarter ?? null,
    override_base: body.override_base ?? null,
  }

  if (existing) {
    const [updated] = await db
      .update(scenario_overrides)
      .set(values)
      .where(eq(scenario_overrides.id, existing.id))
      .returning()
    return c.json(updated, 201)
  }

  const [override] = await db
    .insert(scenario_overrides)
    .values({
      scenario_id: id,
      workspace_id: scenario.workspace_id,
      plan_line_id: body.plan_line_id,
      ...values,
    })
    .returning()
  return c.json(override, 201)
})

// ── POST /:id/freeze — auth — toggle is_frozen ───────────────────────────────
router.post('/:id/freeze', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [scenario] = await db.select().from(scenarios).where(eq(scenarios.id, id))
  if (!scenario) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(scenario.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(scenarios)
    .set({ is_frozen: !scenario.is_frozen })
    .where(eq(scenarios.id, id))
    .returning()
  return c.json(updated)
})

// ── DELETE /:id — auth ───────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [scenario] = await db.select().from(scenarios).where(eq(scenarios.id, id))
  if (!scenario) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(scenario.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(scenario_overrides).where(eq(scenario_overrides.scenario_id, id))
  await db.delete(scenarios).where(eq(scenarios.id, id))
  return c.json({ success: true })
})

export default router
