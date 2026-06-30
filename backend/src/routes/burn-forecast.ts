import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  burn_forecasts,
  workspace_members,
  headcount_plans,
  plan_lines,
  filled_positions,
  budget_baselines,
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

// Loaded annual cost of one position: (base + variable) * (1 + burden_rate).
function loadedAnnual(base: number, variable: number, burden: number): number {
  return (base + variable) * (1 + burden)
}

// Scenario multipliers applied to *planned, not-yet-filled* cost. Filled cost is
// always counted in full; only the forward-looking plan is scenario-adjusted.
const SCENARIO_MULTIPLIER: Record<string, number> = {
  conservative: 0.7,
  expected: 1.0,
  aggressive: 1.15,
}

// ── GET / — public — list forecast runs ─────────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const rows = await db
    .select()
    .from(burn_forecasts)
    .where(eq(burn_forecasts.workspace_id, workspaceId))
    .orderBy(desc(burn_forecasts.created_at))
  return c.json(rows)
})

// ── GET /:id — public — forecast detail ─────────────────────────────────────
router.get('/:id', async (c) => {
  const [row] = await db.select().from(burn_forecasts).where(eq(burn_forecasts.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// ── POST /run — auth — compute phased personnel-cost burn forecast ──────────
const runSchema = z.object({
  workspace_id: z.string().min(1),
  plan_id: z.string().min(1),
  fiscal_year: z.number().int(),
  scenario: z.enum(['conservative', 'expected', 'aggressive']).optional().default('expected'),
  assumptions: z
    .object({
      attrition_rate: z.number().min(0).max(1).optional(),
      merit_increase: z.number().min(0).max(1).optional(),
      start_delay_quarters: z.number().int().min(0).max(4).optional(),
    })
    .optional()
    .default({}),
})

router.post('/run', authMiddleware, zValidator('json', runSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, plan_id, fiscal_year, scenario, assumptions } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [plan] = await db
    .select()
    .from(headcount_plans)
    .where(and(eq(headcount_plans.id, plan_id), eq(headcount_plans.workspace_id, workspace_id)))
  if (!plan) return c.json({ error: 'Plan not found' }, 404)

  const lines = await db.select().from(plan_lines).where(eq(plan_lines.plan_id, plan_id))
  const hires = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.workspace_id, workspace_id))
  const budgets = await db
    .select()
    .from(budget_baselines)
    .where(and(eq(budget_baselines.workspace_id, workspace_id), eq(budget_baselines.fiscal_year, fiscal_year)))

  const mult = SCENARIO_MULTIPLIER[scenario] ?? 1.0
  const merit = assumptions.merit_increase ?? 0
  const attrition = assumptions.attrition_rate ?? 0
  const startDelay = assumptions.start_delay_quarters ?? 0

  // For each quarter Q (1..4) sum the run-rate cost active during that quarter.
  // A planned line contributes its loaded annual / 4 per quarter it is "active",
  // i.e. from its (delay-adjusted) planned start quarter through year end.
  // Filled positions contribute actual loaded cost from the quarter of their
  // actual start (using fiscal_year start month assumption: quarter = ceil(month/3)).
  const byPeriod: Array<{ quarter: number; actual: number; projected: number; budget: number }> = []

  // Pre-bucket filled-position quarterly run-rate.
  const filledQuarterCost: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const h of hires) {
    if (!h.actual_start) continue
    const d = new Date(h.actual_start)
    if (d.getUTCFullYear() !== fiscal_year) continue
    const startQ = Math.min(4, Math.max(1, Math.ceil((d.getUTCMonth() + 1) / 3)))
    const annual = loadedAnnual(h.actual_base ?? 0, h.actual_variable ?? 0, h.burden_rate ?? 0.25)
    const perQuarter = annual / 4
    for (let q = startQ; q <= 4; q++) filledQuarterCost[q] += perQuarter
  }

  // Pre-bucket planned (not-yet-filled) quarterly run-rate, scenario-adjusted.
  // We treat ALL plan lines as the demand curve and net out filled where the
  // line is already realized would be double counting; to keep it conservative
  // we project plan run-rate and report actual separately (actual = filled).
  const plannedQuarterCost: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const ln of lines) {
    const startQ = Math.min(4, Math.max(1, (ln.planned_start_quarter || ln.quarter || 1) + startDelay))
    const baseWithMerit = (ln.budgeted_base ?? 0) * (1 + merit)
    const annual =
      loadedAnnual(baseWithMerit, ln.budgeted_variable ?? 0, ln.burden_rate ?? 0.25) * (ln.count ?? 1)
    // Apply attrition haircut to forward headcount and scenario multiplier.
    const adjustedAnnual = annual * (1 - attrition) * mult
    const perQuarter = adjustedAnnual / 4
    for (let q = startQ; q <= 4; q++) plannedQuarterCost[q] += perQuarter
  }

  const budgetByQuarter: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const b of budgets) {
    const q = b.quarter >= 1 && b.quarter <= 4 ? b.quarter : 1
    budgetByQuarter[q] += b.budgeted_cost ?? 0
  }

  let projectedYearEnd = 0
  let budgetTotal = 0
  for (let q = 1; q <= 4; q++) {
    // Projected = max(actual realized, scenario-adjusted plan) for the quarter so
    // that already-filled cost is never under-counted by the plan curve.
    const actual = filledQuarterCost[q]
    const projected = Math.max(actual, plannedQuarterCost[q])
    const budget = budgetByQuarter[q]
    byPeriod.push({ quarter: q, actual, projected, budget })
    projectedYearEnd += projected
    budgetTotal += budget
  }

  const variance = projectedYearEnd - budgetTotal

  const [row] = await db
    .insert(burn_forecasts)
    .values({
      workspace_id,
      plan_id,
      fiscal_year,
      scenario,
      projected_year_end_cost: projectedYearEnd,
      budget_total: budgetTotal,
      variance,
      by_period: byPeriod,
      assumptions: {
        scenario,
        multiplier: mult,
        attrition_rate: attrition,
        merit_increase: merit,
        start_delay_quarters: startDelay,
        plan_lines: lines.length,
        filled_positions: hires.length,
      },
      created_by: userId,
    })
    .returning()

  return c.json(row, 201)
})

// ── DELETE /:id — auth ──────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(burn_forecasts).where(eq(burn_forecasts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(burn_forecasts).where(eq(burn_forecasts.id, id))
  return c.json({ success: true })
})

export default router
