import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import {
  workspaces,
  teams,
  fiscal_periods,
  plan_lines,
  headcount_plans,
  requisitions,
  filled_positions,
  terminations,
  budget_baselines,
  reconciliations,
  reconciliation_cells,
  ghost_reqs,
  burn_forecasts,
} from '../db/schema.js'

const router = new Hono()

// Fully-loaded cost of a plan line (base + variable, scaled by count + burden).
function planLineCost(l: typeof plan_lines.$inferSelect): number {
  return (l.budgeted_base + l.budgeted_variable) * l.count * (1 + l.burden_rate)
}

// Fully-loaded cost of a filled position (annualized).
function filledCost(f: typeof filled_positions.$inferSelect): number {
  return (f.actual_base + f.actual_variable) * (1 + f.burden_rate)
}

// ---------------------------------------------------------------------------
// GET /dashboard — exec KPIs for a workspace.
//   ?workspace_id (required) [&fiscal_year]
// Returns { kpis, topVariances[], trend[] }.
// ---------------------------------------------------------------------------
router.get('/dashboard', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const fyParam = c.req.query('fiscal_year')
  const fiscalYear = fyParam ? parseInt(fyParam, 10) : undefined

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)

  const teamRows = await db.select().from(teams).where(eq(teams.workspace_id, workspaceId))
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]))

  // Plan lines (optionally scoped to fiscal year via their plan).
  const planRows = await db
    .select()
    .from(headcount_plans)
    .where(eq(headcount_plans.workspace_id, workspaceId))
  const planIds = new Set(
    planRows
      .filter((p) => (fiscalYear === undefined ? true : p.fiscal_year === fiscalYear))
      .map((p) => p.id),
  )
  const allLines = await db.select().from(plan_lines).where(eq(plan_lines.workspace_id, workspaceId))
  const lineRows = allLines.filter((l) => planIds.has(l.plan_id))

  const reqRows = await db
    .select()
    .from(requisitions)
    .where(eq(requisitions.workspace_id, workspaceId))
  const filledRows = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.workspace_id, workspaceId))
  const termRows = await db
    .select()
    .from(terminations)
    .where(eq(terminations.workspace_id, workspaceId))
  const budgetRows = await db
    .select()
    .from(budget_baselines)
    .where(eq(budget_baselines.workspace_id, workspaceId))
  const ghostRows = await db
    .select()
    .from(ghost_reqs)
    .where(and(eq(ghost_reqs.workspace_id, workspaceId), eq(ghost_reqs.status, 'open')))

  // Headcount: planned count, open reqs, filled, terminations → net.
  const plannedCount = lineRows.reduce((a, l) => a + l.count, 0)
  const openReqs = reqRows.filter((r) => r.status === 'open').length
  const filledCount = filledRows.length
  const terminationCount = termRows.length
  const netHeadcount = filledCount - terminationCount
  const headcountVsPlan = netHeadcount - plannedCount

  // Burn vs budget.
  const plannedCost = lineRows.reduce((a, l) => a + planLineCost(l), 0)
  const actualCost = filledRows.reduce((a, f) => a + filledCost(f), 0)
  const budgetTotal = budgetRows
    .filter((b) => (fiscalYear === undefined ? true : b.fiscal_year === fiscalYear))
    .reduce((a, b) => a + b.budgeted_cost, 0)
  const burnVsBudget = actualCost - budgetTotal

  // Latest reconciliation cost variance, if any.
  const [latestRecon] = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.workspace_id, workspaceId))
    .orderBy(desc(reconciliations.created_at))
    .limit(1)

  const kpis = {
    plannedHeadcount: plannedCount,
    planned_headcount: plannedCount,
    openReqs,
    open_headcount: openReqs,
    filledCount,
    filled_headcount: filledCount,
    actual_headcount: filledCount,
    terminationCount,
    netHeadcount,
    net_headcount: netHeadcount,
    headcountVsPlan,
    plannedCost: Math.round(plannedCost),
    actualCost: Math.round(actualCost),
    burn_total: Math.round(actualCost),
    actual_cost: Math.round(actualCost),
    burn: Math.round(actualCost),
    budgetTotal: Math.round(budgetTotal),
    budget: Math.round(budgetTotal),
    burnVsBudget: Math.round(burnVsBudget),
    burn_variance: Math.round(burnVsBudget),
    openGhostReqs: ghostRows.length,
    open_ghost_reqs: ghostRows.length,
    latestReconciliationVariance: latestRecon ? Math.round(latestRecon.cost_variance) : 0,
  }

  // Top variances by team: budget vs actual.
  const actualByTeam = new Map<string, number>()
  for (const f of filledRows) {
    if (!f.team_id) continue
    actualByTeam.set(f.team_id, (actualByTeam.get(f.team_id) ?? 0) + filledCost(f))
  }
  const budgetByTeam = new Map<string, number>()
  for (const b of budgetRows) {
    if (!b.team_id) continue
    if (fiscalYear !== undefined && b.fiscal_year !== fiscalYear) continue
    budgetByTeam.set(b.team_id, (budgetByTeam.get(b.team_id) ?? 0) + b.budgeted_cost)
  }
  const teamIds = new Set<string>([...actualByTeam.keys(), ...budgetByTeam.keys()])
  const topVariances = [...teamIds]
    .map((tid) => {
      const budget = Math.round(budgetByTeam.get(tid) ?? 0)
      const actual = Math.round(actualByTeam.get(tid) ?? 0)
      return {
        team_id: tid,
        team_name: teamName.get(tid) ?? 'Unknown',
        budget,
        actual,
        variance: actual - budget,
      }
    })
    .sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance))
    .slice(0, 5)

  // Trend over quarters: planned cost vs actual cost vs budget.
  const quarters = [1, 2, 3, 4]
  const trend = quarters.map((q) => {
    const plannedQ = lineRows
      .filter((l) => l.planned_start_quarter <= q)
      .reduce((a, l) => a + planLineCost(l), 0)
    const budgetQ = budgetRows
      .filter((b) => (fiscalYear === undefined ? true : b.fiscal_year === fiscalYear) && b.quarter === q)
      .reduce((a, b) => a + b.budgeted_cost, 0)
    // Actual: positions started on/before the end of this quarter.
    const actualQ = filledRows
      .filter((f) => {
        if (!f.actual_start) return false
        const m = new Date(f.actual_start).getUTCMonth()
        const startedQuarter = Math.floor(m / 3) + 1
        return startedQuarter <= q
      })
      .reduce((a, f) => a + filledCost(f), 0)
    return {
      quarter: q,
      label: `Q${q}`,
      planned: Math.round(plannedQ),
      actual: Math.round(actualQ),
      budget: Math.round(budgetQ),
    }
  })

  return c.json({ kpis, topVariances, trend })
})

// ---------------------------------------------------------------------------
// GET /team/:teamId — per-team reconciliation report.
//   ?workspace_id (required) [&fiscal_year]
// Returns { team, cells, cost }.
// ---------------------------------------------------------------------------
router.get('/team/:teamId', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const teamId = c.req.param('teamId')
  const fyParam = c.req.query('fiscal_year')
  const fiscalYear = fyParam ? parseInt(fyParam, 10) : undefined

  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.workspace_id, workspaceId)))
  if (!team) return c.json({ error: 'Team not found' }, 404)

  // Plan lines for this team (scoped by fiscal year via plan).
  const planRows = await db
    .select()
    .from(headcount_plans)
    .where(eq(headcount_plans.workspace_id, workspaceId))
  const planIds = new Set(
    planRows
      .filter((p) => (fiscalYear === undefined ? true : p.fiscal_year === fiscalYear))
      .map((p) => p.id),
  )
  const allLines = await db
    .select()
    .from(plan_lines)
    .where(and(eq(plan_lines.workspace_id, workspaceId), eq(plan_lines.team_id, teamId)))
  const teamLines = allLines.filter((l) => planIds.has(l.plan_id))

  const reqRows = await db
    .select()
    .from(requisitions)
    .where(and(eq(requisitions.workspace_id, workspaceId), eq(requisitions.team_id, teamId)))
  const filledRows = await db
    .select()
    .from(filled_positions)
    .where(and(eq(filled_positions.workspace_id, workspaceId), eq(filled_positions.team_id, teamId)))

  // Build cells keyed by level+quarter: planned / open / filled / variances.
  type Cell = {
    level: string
    quarter: number
    planned_count: number
    open_count: number
    filled_count: number
    count_variance: number
    planned_cost: number
    actual_cost: number
    cost_variance: number
    status: string
  }
  const cellMap = new Map<string, Cell>()
  const key = (level: string, q: number) => `${level}::${q}`
  const ensure = (level: string, q: number): Cell => {
    const k = key(level, q)
    let cell = cellMap.get(k)
    if (!cell) {
      cell = {
        level,
        quarter: q,
        planned_count: 0,
        open_count: 0,
        filled_count: 0,
        count_variance: 0,
        planned_cost: 0,
        actual_cost: 0,
        cost_variance: 0,
        status: 'on_plan',
      }
      cellMap.set(k, cell)
    }
    return cell
  }

  for (const l of teamLines) {
    const cell = ensure(l.level, l.planned_start_quarter)
    cell.planned_count += l.count
    cell.planned_cost += planLineCost(l)
  }
  for (const r of reqRows) {
    if (r.status !== 'open') continue
    // Bucket open reqs by target_start quarter (fallback: Q1).
    const q = r.target_start ? Math.floor(new Date(r.target_start).getUTCMonth() / 3) + 1 : 1
    const cell = ensure(r.level, q)
    cell.open_count += 1
  }
  for (const f of filledRows) {
    const q = f.actual_start ? Math.floor(new Date(f.actual_start).getUTCMonth() / 3) + 1 : 1
    const cell = ensure(f.level, q)
    cell.filled_count += 1
    cell.actual_cost += filledCost(f)
  }

  const cells = [...cellMap.values()]
    .map((cell) => {
      cell.count_variance = cell.filled_count + cell.open_count - cell.planned_count
      cell.cost_variance = Math.round(cell.actual_cost - cell.planned_cost)
      cell.planned_cost = Math.round(cell.planned_cost)
      cell.actual_cost = Math.round(cell.actual_cost)
      if (cell.count_variance > 0) cell.status = 'over_plan'
      else if (cell.filled_count + cell.open_count < cell.planned_count) cell.status = 'under_plan'
      else cell.status = 'on_plan'
      return cell
    })
    .sort((a, b) => a.quarter - b.quarter || a.level.localeCompare(b.level))

  const cost = {
    planned: cells.reduce((a, x) => a + x.planned_cost, 0),
    actual: cells.reduce((a, x) => a + x.actual_cost, 0),
    variance: cells.reduce((a, x) => a + x.cost_variance, 0),
  }

  return c.json({ team, cells, cost })
})

// ---------------------------------------------------------------------------
// GET /trend — headcount + burn trend over fiscal periods.
//   ?workspace_id (required) [&fiscal_year]
// Returns { periods[] }.
// ---------------------------------------------------------------------------
router.get('/trend', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const fyParam = c.req.query('fiscal_year')
  const fiscalYear = fyParam ? parseInt(fyParam, 10) : undefined

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)

  const periodRows = await db
    .select()
    .from(fiscal_periods)
    .where(eq(fiscal_periods.workspace_id, workspaceId))
    .orderBy(fiscal_periods.fiscal_year, fiscal_periods.quarter)
  const periods0 = fiscalYear === undefined ? periodRows : periodRows.filter((p) => p.fiscal_year === fiscalYear)

  const planRows = await db
    .select()
    .from(headcount_plans)
    .where(eq(headcount_plans.workspace_id, workspaceId))
  const allLines = await db.select().from(plan_lines).where(eq(plan_lines.workspace_id, workspaceId))
  const filledRows = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.workspace_id, workspaceId))
  const termRows = await db
    .select()
    .from(terminations)
    .where(eq(terminations.workspace_id, workspaceId))
  const budgetRows = await db
    .select()
    .from(budget_baselines)
    .where(eq(budget_baselines.workspace_id, workspaceId))

  const planFy = new Map(planRows.map((p) => [p.id, p.fiscal_year]))

  const periods = periods0.map((p) => {
    const fy = p.fiscal_year
    const q = p.quarter
    // Cumulative planned headcount/cost through this quarter for this FY.
    const linesThrough = allLines.filter(
      (l) => planFy.get(l.plan_id) === fy && l.planned_start_quarter <= q,
    )
    const plannedHeadcount = linesThrough.reduce((a, l) => a + l.count, 0)
    const plannedCost = linesThrough.reduce((a, l) => a + planLineCost(l), 0)

    // Actuals: positions started on/before the end of this quarter.
    const filledThrough = filledRows.filter((f) => {
      if (!f.actual_start) return false
      const d = new Date(f.actual_start)
      return d.getUTCFullYear() < fy || (d.getUTCFullYear() === fy && Math.floor(d.getUTCMonth() / 3) + 1 <= q)
    })
    const filledCount = filledThrough.length
    const actualCost = filledThrough.reduce((a, f) => a + filledCost(f), 0)

    const termsThrough = termRows.filter((t) => {
      if (!t.term_date) return false
      const d = new Date(t.term_date)
      return d.getUTCFullYear() < fy || (d.getUTCFullYear() === fy && Math.floor(d.getUTCMonth() / 3) + 1 <= q)
    }).length

    const budgetQ = budgetRows
      .filter((b) => b.fiscal_year === fy && b.quarter === q)
      .reduce((a, b) => a + b.budgeted_cost, 0)

    return {
      period_id: p.id,
      label: p.label,
      fiscal_year: fy,
      quarter: q,
      plannedHeadcount,
      filledCount,
      terminationCount: termsThrough,
      netHeadcount: filledCount - termsThrough,
      plannedCost: Math.round(plannedCost),
      actualCost: Math.round(actualCost),
      budget: Math.round(budgetQ),
    }
  })

  return c.json({ periods })
})

export default router
