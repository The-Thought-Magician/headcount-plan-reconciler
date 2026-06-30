import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { plan_lines, headcount_plans, workspace_members } from '../db/schema.js'
import { eq, and, asc } from 'drizzle-orm'
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

// Resolves the workspace_id for a plan and verifies it matches a provided one.
async function planWorkspace(planId: string): Promise<string | null> {
  const [p] = await db
    .select({ workspace_id: headcount_plans.workspace_id })
    .from(headcount_plans)
    .where(eq(headcount_plans.id, planId))
  return p?.workspace_id ?? null
}

const lineFields = {
  team_id: z.string().min(1).nullable().optional(),
  level: z.string().min(1),
  role_title: z.string().min(1),
  quarter: z.number().int().min(1).max(4),
  count: z.number().int().min(0).optional(),
  budgeted_base: z.number().optional(),
  budgeted_variable: z.number().optional(),
  burden_rate: z.number().optional(),
  planned_start_quarter: z.number().int().min(1).max(4),
  hire_type: z.enum(['growth', 'backfill', 'conversion']).optional(),
  justification: z.string().optional(),
}

const createSchema = z.object({
  plan_id: z.string().min(1),
  ...lineFields,
})

const bulkSchema = z.object({
  plan_id: z.string().min(1),
  lines: z
    .array(z.object(lineFields))
    .min(1),
})

const updateSchema = z.object({
  team_id: z.string().min(1).nullable().optional(),
  level: z.string().min(1).optional(),
  role_title: z.string().min(1).optional(),
  quarter: z.number().int().min(1).max(4).optional(),
  count: z.number().int().min(0).optional(),
  budgeted_base: z.number().optional(),
  budgeted_variable: z.number().optional(),
  burden_rate: z.number().optional(),
  planned_start_quarter: z.number().int().min(1).max(4).optional(),
  hire_type: z.enum(['growth', 'backfill', 'conversion']).optional(),
  justification: z.string().optional(),
})

const annotateSchema = z.object({
  note: z.string().min(1),
})

// GET / — public — list lines by ?plan_id or ?workspace_id
router.get('/', async (c) => {
  const planId = c.req.query('plan_id')
  const workspaceId = c.req.query('workspace_id')
  if (!planId && !workspaceId) {
    return c.json({ error: 'plan_id or workspace_id is required' }, 400)
  }
  const where = planId
    ? eq(plan_lines.plan_id, planId)
    : eq(plan_lines.workspace_id, workspaceId!)
  const rows = await db
    .select()
    .from(plan_lines)
    .where(where)
    .orderBy(asc(plan_lines.quarter), asc(plan_lines.level))
  return c.json(rows)
})

// GET /:id — public — line detail
router.get('/:id', async (c) => {
  const [row] = await db.select().from(plan_lines).where(eq(plan_lines.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// POST / — auth — create one line
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const workspaceId = await planWorkspace(body.plan_id)
  if (!workspaceId) return c.json({ error: 'Plan not found' }, 404)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [row] = await db
    .insert(plan_lines)
    .values({
      plan_id: body.plan_id,
      workspace_id: workspaceId,
      team_id: body.team_id ?? null,
      level: body.level,
      role_title: body.role_title,
      quarter: body.quarter,
      count: body.count ?? 1,
      budgeted_base: body.budgeted_base ?? 0,
      budgeted_variable: body.budgeted_variable ?? 0,
      burden_rate: body.burden_rate ?? 0.25,
      planned_start_quarter: body.planned_start_quarter,
      hire_type: body.hire_type ?? 'growth',
      justification: body.justification ?? '',
      annotations: [],
    })
    .returning()
  return c.json(row, 201)
})

// POST /bulk — auth — create many lines under one plan
router.post('/bulk', authMiddleware, zValidator('json', bulkSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const workspaceId = await planWorkspace(body.plan_id)
  if (!workspaceId) return c.json({ error: 'Plan not found' }, 404)
  if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)

  const rows = await db
    .insert(plan_lines)
    .values(
      body.lines.map((l) => ({
        plan_id: body.plan_id,
        workspace_id: workspaceId,
        team_id: l.team_id ?? null,
        level: l.level,
        role_title: l.role_title,
        quarter: l.quarter,
        count: l.count ?? 1,
        budgeted_base: l.budgeted_base ?? 0,
        budgeted_variable: l.budgeted_variable ?? 0,
        burden_rate: l.burden_rate ?? 0.25,
        planned_start_quarter: l.planned_start_quarter,
        hire_type: l.hire_type ?? 'growth',
        justification: l.justification ?? '',
        annotations: [],
      })),
    )
    .returning()
  return c.json(rows, 201)
})

// PUT /:id — auth — update a line
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(plan_lines).where(eq(plan_lines.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const patch: Record<string, unknown> = { ...body }
  if (body.team_id === undefined) delete patch.team_id
  const [updated] = await db
    .update(plan_lines)
    .set(patch)
    .where(eq(plan_lines.id, id))
    .returning()
  return c.json(updated)
})

// POST /:id/annotate — auth — append an annotation
router.post('/:id/annotate', authMiddleware, zValidator('json', annotateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(plan_lines).where(eq(plan_lines.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const { note } = c.req.valid('json')
  const annotations = [
    ...(existing.annotations ?? []),
    { user_id: userId, note, at: new Date().toISOString() },
  ]
  const [updated] = await db
    .update(plan_lines)
    .set({ annotations })
    .where(eq(plan_lines.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete a line
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(plan_lines).where(eq(plan_lines.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(plan_lines).where(eq(plan_lines.id, id))
  return c.json({ success: true })
})

export default router
