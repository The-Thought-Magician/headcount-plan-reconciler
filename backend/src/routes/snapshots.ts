import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  snapshots,
  workspace_members,
  headcount_plans,
  plan_lines,
  requisitions,
  filled_positions,
  terminations,
  reconciliations,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
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

// Public: list snapshots for a workspace. GET /?workspace_id=...
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(snapshots)
    .where(eq(snapshots.workspace_id, workspaceId))
    .orderBy(desc(snapshots.created_at))
  return c.json(rows)
})

// Public: compare two snapshots. GET /compare?a=<id>&b=<id>
// Registered BEFORE /:id so "compare" is not captured as a snapshot id.
router.get('/compare', async (c) => {
  const aId = c.req.query('a')
  const bId = c.req.query('b')
  if (!aId || !bId) return c.json({ error: 'Both a and b query params are required' }, 400)

  const [a] = await db.select().from(snapshots).where(eq(snapshots.id, aId))
  const [b] = await db.select().from(snapshots).where(eq(snapshots.id, bId))
  if (!a) return c.json({ error: 'Snapshot a not found' }, 404)
  if (!b) return c.json({ error: 'Snapshot b not found' }, 404)

  const ap = (a.payload ?? {}) as Record<string, any>
  const bp = (b.payload ?? {}) as Record<string, any>

  const numericKeys = [
    'plan_line_count',
    'planned_headcount',
    'planned_cost',
    'open_reqs',
    'filled_count',
    'filled_cost',
    'termination_count',
    'reconciliation_count',
  ]

  const metrics: Record<string, { a: number; b: number; delta: number }> = {}
  for (const k of numericKeys) {
    const av = typeof ap[k] === 'number' ? ap[k] : 0
    const bv = typeof bp[k] === 'number' ? bp[k] : 0
    metrics[k] = { a: av, b: bv, delta: bv - av }
  }

  const diff = {
    a_period: a.period_label,
    b_period: b.period_label,
    metrics,
  }

  return c.json({ a, b, diff })
})

// Public: snapshot payload. GET /:id
router.get('/:id', async (c) => {
  const [row] = await db.select().from(snapshots).where(eq(snapshots.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

const createSchema = z.object({
  workspace_id: z.string().min(1),
  period_label: z.string().min(1),
  kind: z.string().optional().default('period_close'),
})

// Auth: create a period-close snapshot capturing plan/reqs/hires/recon for the workspace.
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const ws = body.workspace_id

  const [plansRows, lineRows, reqRows, filledRows, termRows, reconRows] = await Promise.all([
    db.select().from(headcount_plans).where(eq(headcount_plans.workspace_id, ws)),
    db.select().from(plan_lines).where(eq(plan_lines.workspace_id, ws)),
    db.select().from(requisitions).where(eq(requisitions.workspace_id, ws)),
    db.select().from(filled_positions).where(eq(filled_positions.workspace_id, ws)),
    db.select().from(terminations).where(eq(terminations.workspace_id, ws)),
    db.select().from(reconciliations).where(eq(reconciliations.workspace_id, ws)),
  ])

  const plannedHeadcount = lineRows.reduce((s, l) => s + (l.count ?? 0), 0)
  const plannedCost = lineRows.reduce((s, l) => {
    const base = (l.budgeted_base ?? 0) + (l.budgeted_variable ?? 0)
    const burdened = base * (1 + (l.burden_rate ?? 0))
    return s + burdened * (l.count ?? 0)
  }, 0)
  const openReqs = reqRows.filter((r) => r.status === 'open').length
  const filledCost = filledRows.reduce((s, f) => {
    const base = (f.actual_base ?? 0) + (f.actual_variable ?? 0)
    return s + base * (1 + (f.burden_rate ?? 0))
  }, 0)

  const payload = {
    captured_at: new Date().toISOString(),
    plan_line_count: lineRows.length,
    planned_headcount: plannedHeadcount,
    planned_cost: plannedCost,
    open_reqs: openReqs,
    filled_count: filledRows.length,
    filled_cost: filledCost,
    termination_count: termRows.length,
    reconciliation_count: reconRows.length,
    plans: plansRows,
    plan_lines: lineRows,
    requisitions: reqRows,
    filled_positions: filledRows,
    terminations: termRows,
    reconciliations: reconRows,
  }

  const [row] = await db
    .insert(snapshots)
    .values({
      workspace_id: ws,
      period_label: body.period_label,
      kind: body.kind ?? 'period_close',
      payload,
      created_by: userId,
    })
    .returning()

  return c.json(row, 201)
})

export default router
