import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  budget_baselines,
  workspace_members,
  teams,
  plan_lines,
  headcount_plans,
  filled_positions,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── ownership helper ────────────────────────────────────────────────────────
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

const baselineSchema = z.object({
  workspace_id: z.string().min(1),
  team_id: z.string().min(1).nullable().optional(),
  fiscal_year: z.number().int(),
  quarter: z.number().int().min(1).max(4),
  budgeted_cost: z.number().default(0),
  headcount_cap: z.number().int().default(0),
  source: z.string().optional().default('finance'),
})

const reviseSchema = z.object({
  budgeted_cost: z.number(),
  note: z.string().optional().default(''),
})

// ── GET / — public — list baselines for a workspace ─────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const rows = await db
    .select()
    .from(budget_baselines)
    .where(eq(budget_baselines.workspace_id, workspaceId))
    .orderBy(budget_baselines.fiscal_year, budget_baselines.quarter)
  return c.json(rows)
})

// ── GET /summary — public — budget vs plan vs actual ────────────────────────
router.get('/summary', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  const fyRaw = c.req.query('fiscal_year')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const fiscalYear = fyRaw ? parseInt(fyRaw, 10) : undefined

  // Budget baselines (optionally scoped to a fiscal year)
  const baselines = await db
    .select()
    .from(budget_baselines)
    .where(
      fiscalYear !== undefined && !Number.isNaN(fiscalYear)
        ? and(eq(budget_baselines.workspace_id, workspaceId), eq(budget_baselines.fiscal_year, fiscalYear))
        : eq(budget_baselines.workspace_id, workspaceId),
    )

  // Planned cost: sum over plan_lines belonging to plans in this workspace (+fy)
  const planRows = await db
    .select({
      line_id: plan_lines.id,
      team_id: plan_lines.team_id,
      count: plan_lines.count,
      budgeted_base: plan_lines.budgeted_base,
      budgeted_variable: plan_lines.budgeted_variable,
      burden_rate: plan_lines.burden_rate,
      fiscal_year: headcount_plans.fiscal_year,
    })
    .from(plan_lines)
    .innerJoin(headcount_plans, eq(plan_lines.plan_id, headcount_plans.id))
    .where(eq(plan_lines.workspace_id, workspaceId))

  // Actual cost: sum over filled_positions in this workspace
  const filledRows = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.workspace_id, workspaceId))

  const lineCost = (base: number, variable: number, burden: number, count: number) =>
    (base + variable) * (1 + burden) * count

  let budgetTotal = 0
  const budgetByTeam = new Map<string, number>()
  for (const b of baselines) {
    budgetTotal += b.budgeted_cost
    const key = b.team_id ?? 'unassigned'
    budgetByTeam.set(key, (budgetByTeam.get(key) ?? 0) + b.budgeted_cost)
  }

  let planTotal = 0
  const planByTeam = new Map<string, number>()
  for (const p of planRows) {
    if (fiscalYear !== undefined && !Number.isNaN(fiscalYear) && p.fiscal_year !== fiscalYear) continue
    const cost = lineCost(p.budgeted_base, p.budgeted_variable, p.burden_rate, p.count)
    planTotal += cost
    const key = p.team_id ?? 'unassigned'
    planByTeam.set(key, (planByTeam.get(key) ?? 0) + cost)
  }

  let actualTotal = 0
  const actualByTeam = new Map<string, number>()
  for (const f of filledRows) {
    const cost = lineCost(f.actual_base, f.actual_variable, f.burden_rate, 1)
    actualTotal += cost
    const key = f.team_id ?? 'unassigned'
    actualByTeam.set(key, (actualByTeam.get(key) ?? 0) + cost)
  }

  const teamRows = await db.select().from(teams).where(eq(teams.workspace_id, workspaceId))
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]))

  const teamKeys = new Set<string>([
    ...budgetByTeam.keys(),
    ...planByTeam.keys(),
    ...actualByTeam.keys(),
  ])
  const byTeam = [...teamKeys].map((key) => {
    const budget = budgetByTeam.get(key) ?? 0
    const plan = planByTeam.get(key) ?? 0
    const actual = actualByTeam.get(key) ?? 0
    return {
      team_id: key === 'unassigned' ? null : key,
      team_name: key === 'unassigned' ? 'Unassigned' : teamName.get(key) ?? key,
      budget,
      plan,
      actual,
      plan_variance: plan - budget,
      actual_variance: actual - budget,
    }
  })

  return c.json({
    budget: budgetTotal,
    plan: planTotal,
    actual: actualTotal,
    plan_variance: planTotal - budgetTotal,
    actual_variance: actualTotal - budgetTotal,
    byTeam,
  })
})

// ── POST / — auth — upsert baseline ─────────────────────────────────────────
router.post('/', authMiddleware, zValidator('json', baselineSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [row] = await db
    .insert(budget_baselines)
    .values({
      workspace_id: body.workspace_id,
      team_id: body.team_id ?? null,
      fiscal_year: body.fiscal_year,
      quarter: body.quarter,
      budgeted_cost: body.budgeted_cost,
      headcount_cap: body.headcount_cap,
      source: body.source,
    })
    .onConflictDoUpdate({
      target: [
        budget_baselines.workspace_id,
        budget_baselines.team_id,
        budget_baselines.fiscal_year,
        budget_baselines.quarter,
      ],
      set: {
        budgeted_cost: body.budgeted_cost,
        headcount_cap: body.headcount_cap,
        source: body.source,
      },
    })
    .returning()
  return c.json(row, 201)
})

// ── POST /:id/revise — auth — append revision + update cost ─────────────────
router.post('/:id/revise', authMiddleware, zValidator('json', reviseSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [existing] = await db.select().from(budget_baselines).where(eq(budget_baselines.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const revisions = [
    ...(existing.revisions ?? []),
    { at: new Date().toISOString(), budgeted_cost: body.budgeted_cost, note: body.note },
  ]
  const [updated] = await db
    .update(budget_baselines)
    .set({ budgeted_cost: body.budgeted_cost, revisions })
    .where(eq(budget_baselines.id, id))
    .returning()
  return c.json(updated)
})

// ── DELETE /:id — auth ──────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(budget_baselines).where(eq(budget_baselines.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(budget_baselines).where(eq(budget_baselines.id, id))
  return c.json({ success: true })
})

export default router
