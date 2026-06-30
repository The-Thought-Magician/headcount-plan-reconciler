import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  reconciliations,
  reconciliation_cells,
  workspace_members,
  plan_lines,
  requisitions,
  filled_positions,
  headcount_plans,
} from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
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

const runSchema = z.object({
  workspace_id: z.string().min(1),
  plan_id: z.string().min(1),
  fiscal_year: z.number().int(),
  quarter: z.number().int().min(1).max(4),
})

// ── GET / — public — list runs for a workspace ──────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const rows = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.workspace_id, workspaceId))
    .orderBy(reconciliations.created_at)
  return c.json(rows)
})

// ── GET /:id — public — run + cells ─────────────────────────────────────────
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [run] = await db.select().from(reconciliations).where(eq(reconciliations.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  const cells = await db
    .select()
    .from(reconciliation_cells)
    .where(eq(reconciliation_cells.reconciliation_id, id))
  return c.json({ ...run, cells })
})

// ── GET /:id/cells — public ─────────────────────────────────────────────────
router.get('/:id/cells', async (c) => {
  const id = c.req.param('id')
  const [run] = await db.select().from(reconciliations).where(eq(reconciliations.id, id))
  if (!run) return c.json({ error: 'Not found' }, 404)
  const cells = await db
    .select()
    .from(reconciliation_cells)
    .where(eq(reconciliation_cells.reconciliation_id, id))
  return c.json(cells)
})

// ── POST /run — auth — compute three-way match, persist run + cells ─────────
router.post('/run', authMiddleware, zValidator('json', runSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, plan_id, fiscal_year, quarter } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [plan] = await db
    .select()
    .from(headcount_plans)
    .where(and(eq(headcount_plans.id, plan_id), eq(headcount_plans.workspace_id, workspace_id)))
  if (!plan) return c.json({ error: 'Plan not found' }, 404)

  // Pull the three sources scoped to workspace.
  const lines = await db.select().from(plan_lines).where(eq(plan_lines.plan_id, plan_id))
  const reqs = await db.select().from(requisitions).where(eq(requisitions.workspace_id, workspace_id))
  const filled = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.workspace_id, workspace_id))

  // Cell key = team_id|level|quarter.
  type Agg = {
    team_id: string | null
    level: string
    quarter: number
    planned_count: number
    open_count: number
    filled_count: number
    planned_cost: number
    filled_cost: number
  }
  const cellMap = new Map<string, Agg>()
  const keyOf = (teamId: string | null, level: string, q: number) => `${teamId ?? 'none'}|${level}|${q}`
  const ensure = (teamId: string | null, level: string, q: number): Agg => {
    const k = keyOf(teamId, level, q)
    let agg = cellMap.get(k)
    if (!agg) {
      agg = {
        team_id: teamId,
        level,
        quarter: q,
        planned_count: 0,
        open_count: 0,
        filled_count: 0,
        planned_cost: 0,
        filled_cost: 0,
      }
      cellMap.set(k, agg)
    }
    return agg
  }

  const lineCost = (base: number, variable: number, burden: number, count: number) =>
    (base + variable) * (1 + burden) * count

  // Plan side — bucket by the line's planned_start_quarter, filtered to target quarter.
  for (const l of lines) {
    if (l.planned_start_quarter !== quarter) continue
    const agg = ensure(l.team_id ?? null, l.level, quarter)
    agg.planned_count += l.count
    agg.planned_cost += lineCost(l.budgeted_base, l.budgeted_variable, l.burden_rate, l.count)
  }

  // Open reqs — those still open/in-flight, bucketed by their plan line's quarter
  // when linked, else attributed to the target quarter.
  const lineById = new Map(lines.map((l) => [l.id, l]))
  const openStatuses = new Set(['open', 'sourcing', 'interviewing', 'offer', 'in_progress'])
  for (const r of reqs) {
    if (!openStatuses.has(r.status)) continue
    const linked = r.plan_line_id ? lineById.get(r.plan_line_id) : undefined
    const q = linked ? linked.planned_start_quarter : quarter
    if (q !== quarter) continue
    const teamId = r.team_id ?? linked?.team_id ?? null
    const agg = ensure(teamId, r.level, quarter)
    agg.open_count += 1
  }

  // Filled — actual hires; bucket by linked plan line's quarter, else target quarter.
  for (const f of filled) {
    const linked = f.plan_line_id ? lineById.get(f.plan_line_id) : undefined
    const q = linked ? linked.planned_start_quarter : quarter
    if (q !== quarter) continue
    const teamId = f.team_id ?? linked?.team_id ?? null
    const agg = ensure(teamId, f.level, quarter)
    agg.filled_count += 1
    agg.filled_cost += lineCost(f.actual_base, f.actual_variable, f.burden_rate, 1)
  }

  // Persist the run first, then cells.
  let totalPlanned = 0
  let totalOpen = 0
  let totalFilled = 0
  let totalCostVariance = 0

  const cellValues = [...cellMap.values()].map((a) => {
    const countVariance = a.filled_count + a.open_count - a.planned_count
    const costVariance = a.filled_cost - a.planned_cost
    let status: string
    if (a.filled_count > a.planned_count) status = 'over'
    else if (a.filled_count + a.open_count < a.planned_count) status = 'under'
    else status = 'on_plan'
    totalPlanned += a.planned_count
    totalOpen += a.open_count
    totalFilled += a.filled_count
    totalCostVariance += costVariance
    return {
      team_id: a.team_id,
      level: a.level,
      quarter: a.quarter,
      planned_count: a.planned_count,
      open_count: a.open_count,
      filled_count: a.filled_count,
      count_variance: countVariance,
      cost_variance: costVariance,
      status,
    }
  })

  const [run] = await db
    .insert(reconciliations)
    .values({
      workspace_id,
      plan_id,
      fiscal_year,
      quarter,
      status: 'draft',
      total_planned: totalPlanned,
      total_open: totalOpen,
      total_filled: totalFilled,
      cost_variance: totalCostVariance,
      summary: {
        cell_count: cellValues.length,
        over_cells: cellValues.filter((x) => x.status === 'over').length,
        under_cells: cellValues.filter((x) => x.status === 'under').length,
        on_plan_cells: cellValues.filter((x) => x.status === 'on_plan').length,
      },
      created_by: userId,
    })
    .returning()

  let cells: typeof reconciliation_cells.$inferSelect[] = []
  if (cellValues.length > 0) {
    cells = await db
      .insert(reconciliation_cells)
      .values(
        cellValues.map((cv) => ({
          reconciliation_id: run.id,
          workspace_id,
          team_id: cv.team_id,
          level: cv.level,
          quarter: cv.quarter,
          planned_count: cv.planned_count,
          open_count: cv.open_count,
          filled_count: cv.filled_count,
          count_variance: cv.count_variance,
          cost_variance: cv.cost_variance,
          status: cv.status,
        })),
      )
      .returning()
  }

  return c.json({ ...run, cells }, 201)
})

// ── POST /:id/snapshot — auth — freeze run ──────────────────────────────────
router.post('/:id/snapshot', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reconciliations).where(eq(reconciliations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(reconciliations)
    .set({ status: 'closed' })
    .where(eq(reconciliations.id, id))
    .returning()
  return c.json(updated)
})

// ── DELETE /:id — auth ──────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(reconciliations).where(eq(reconciliations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(reconciliation_cells).where(eq(reconciliation_cells.reconciliation_id, id))
  await db.delete(reconciliations).where(eq(reconciliations.id, id))
  return c.json({ success: true })
})

export default router
