import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and } from 'drizzle-orm'
import { db } from '../db/index.js'
import { authMiddleware, getUserId } from '../lib/auth.js'
import {
  workspaces,
  workspace_members,
  teams,
  fiscal_periods,
  headcount_plans,
  plan_lines,
  requisitions,
  req_events,
  filled_positions,
  terminations,
  budget_baselines,
  reconciliations,
  reconciliation_cells,
  ghost_reqs,
  backfill_links,
  burn_forecasts,
  velocity_metrics,
  variance_packs,
  variance_pack_lines,
  scenarios,
  scenario_overrides,
  thresholds,
  alerts,
  exceptions,
  notifications,
  activity_log,
  snapshots,
  imports,
} from '../db/schema.js'

const router = new Hono()

// Ensure the caller is a member of the workspace; returns true if member.
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

function quarterStart(fiscalYear: number, quarter: number): Date {
  // quarter 1..4 → first month of that quarter (calendar-year aligned).
  const month = (quarter - 1) * 3
  return new Date(Date.UTC(fiscalYear, month, 1))
}

function quarterEnd(fiscalYear: number, quarter: number): Date {
  const month = quarter * 3
  return new Date(Date.UTC(fiscalYear, month, 0))
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000)
}

const sampleSchema = z.object({
  workspace_id: z.string().optional(),
  fiscal_year: z.number().int().optional(),
})

// ---------------------------------------------------------------------------
// POST /sample — populate a realistic sample company for the caller.
// Creates (or reuses) a workspace the caller owns, then seeds a full graph:
// teams, fiscal periods, an approved headcount plan with lines, requisitions
// (+ events), filled positions, terminations, budget baselines.
// ---------------------------------------------------------------------------
router.post('/sample', authMiddleware, zValidator('json', sampleSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const fiscalYear = body.fiscal_year ?? new Date().getUTCFullYear()

  // Resolve / create the target workspace.
  let workspaceId = body.workspace_id
  if (workspaceId) {
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId))
    if (!ws) return c.json({ error: 'Workspace not found' }, 404)
    if (!(await isMember(workspaceId, userId))) return c.json({ error: 'Forbidden' }, 403)
  } else {
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'Sample Co', owner_id: userId, fiscal_year_start_month: 1, currency: 'USD' })
      .returning()
    workspaceId = ws.id
    await db.insert(workspace_members).values({ workspace_id: workspaceId, user_id: userId, role: 'owner' })
  }

  const counts: Record<string, number> = {}

  // ---- Teams (a small org tree) ----
  const [eng] = await db
    .insert(teams)
    .values({ workspace_id: workspaceId, name: 'Engineering', cost_center: 'CC-100', owner_user_id: userId })
    .returning()
  const [platform] = await db
    .insert(teams)
    .values({ workspace_id: workspaceId, name: 'Platform', parent_id: eng.id, cost_center: 'CC-101', owner_user_id: userId })
    .returning()
  const [product] = await db
    .insert(teams)
    .values({ workspace_id: workspaceId, name: 'Product', cost_center: 'CC-200', owner_user_id: userId })
    .returning()
  const [sales] = await db
    .insert(teams)
    .values({ workspace_id: workspaceId, name: 'Sales', cost_center: 'CC-300', owner_user_id: userId })
    .returning()
  const teamRows = [eng, platform, product, sales]
  counts.teams = teamRows.length

  // ---- Fiscal periods (4 quarters) ----
  const periodVals = [1, 2, 3, 4].map((q) => ({
    workspace_id: workspaceId!,
    fiscal_year: fiscalYear,
    quarter: q,
    label: `FY${fiscalYear} Q${q}`,
    start_date: quarterStart(fiscalYear, q),
    end_date: quarterEnd(fiscalYear, q),
  }))
  const periodRows = await db.insert(fiscal_periods).values(periodVals).returning()
  counts.fiscal_periods = periodRows.length

  // ---- Headcount plan (approved) ----
  const [plan] = await db
    .insert(headcount_plans)
    .values({
      workspace_id: workspaceId,
      name: `FY${fiscalYear} Operating Plan`,
      fiscal_year: fiscalYear,
      version: 1,
      status: 'approved',
      approved_by: userId,
      approved_at: new Date(),
      created_by: userId,
    })
    .returning()
  counts.headcount_plans = 1

  // ---- Plan lines (team / level / quarter) ----
  const lineSpecs: Array<{
    team: typeof eng
    level: string
    role: string
    quarter: number
    count: number
    base: number
    variable: number
    hire_type: string
  }> = [
    { team: platform, level: 'L4', role: 'Software Engineer', quarter: 1, count: 2, base: 165000, variable: 15000, hire_type: 'growth' },
    { team: platform, level: 'L5', role: 'Senior Software Engineer', quarter: 2, count: 1, base: 195000, variable: 25000, hire_type: 'growth' },
    { team: eng, level: 'L6', role: 'Staff Engineer', quarter: 1, count: 1, base: 235000, variable: 35000, hire_type: 'growth' },
    { team: product, level: 'L4', role: 'Product Manager', quarter: 2, count: 1, base: 175000, variable: 20000, hire_type: 'growth' },
    { team: product, level: 'L5', role: 'Senior PM', quarter: 3, count: 1, base: 205000, variable: 30000, hire_type: 'backfill' },
    { team: sales, level: 'L4', role: 'Account Executive', quarter: 1, count: 3, base: 120000, variable: 120000, hire_type: 'growth' },
    { team: sales, level: 'L3', role: 'SDR', quarter: 3, count: 2, base: 75000, variable: 35000, hire_type: 'growth' },
  ]
  const lineVals = lineSpecs.map((s) => ({
    plan_id: plan.id,
    workspace_id: workspaceId!,
    team_id: s.team.id,
    level: s.level,
    role_title: s.role,
    quarter: s.quarter,
    count: s.count,
    budgeted_base: s.base,
    budgeted_variable: s.variable,
    burden_rate: 0.25,
    planned_start_quarter: s.quarter,
    hire_type: s.hire_type,
    justification: 'Per approved operating plan',
  }))
  const lineRows = await db.insert(plan_lines).values(lineVals).returning()
  counts.plan_lines = lineRows.length

  // ---- Requisitions (some open, some filled, one overdue/ghost) ----
  const reqVals = [
    {
      workspace_id: workspaceId!,
      team_id: platform.id,
      plan_line_id: lineRows[0].id,
      title: 'Software Engineer',
      level: 'L4',
      status: 'filled',
      target_start: quarterStart(fiscalYear, 1),
      fill_by: quarterEnd(fiscalYear, 1),
      opened_at: daysAgo(120),
      recruiter: 'Dana Liu',
      hiring_manager: 'Sam Park',
      hire_type: 'growth',
      budgeted_base: 165000,
    },
    {
      workspace_id: workspaceId!,
      team_id: platform.id,
      plan_line_id: lineRows[0].id,
      title: 'Software Engineer',
      level: 'L4',
      status: 'open',
      target_start: quarterStart(fiscalYear, 1),
      fill_by: quarterEnd(fiscalYear, 1),
      opened_at: daysAgo(60),
      recruiter: 'Dana Liu',
      hiring_manager: 'Sam Park',
      hire_type: 'growth',
      budgeted_base: 165000,
    },
    {
      workspace_id: workspaceId!,
      team_id: eng.id,
      plan_line_id: lineRows[2].id,
      title: 'Staff Engineer',
      level: 'L6',
      status: 'open',
      target_start: quarterStart(fiscalYear, 1),
      fill_by: daysAgo(30), // overdue → ghost candidate
      opened_at: daysAgo(150),
      recruiter: 'Dana Liu',
      hiring_manager: 'Sam Park',
      hire_type: 'growth',
      budgeted_base: 235000,
    },
    {
      workspace_id: workspaceId!,
      team_id: sales.id,
      plan_line_id: lineRows[5].id,
      title: 'Account Executive',
      level: 'L4',
      status: 'filled',
      target_start: quarterStart(fiscalYear, 1),
      fill_by: quarterEnd(fiscalYear, 1),
      opened_at: daysAgo(100),
      recruiter: 'Mona Reed',
      hiring_manager: 'Pat Vega',
      hire_type: 'growth',
      budgeted_base: 120000,
    },
    {
      workspace_id: workspaceId!,
      team_id: sales.id,
      plan_line_id: null, // no plan line → ghost candidate (off-plan)
      title: 'Sales Engineer',
      level: 'L4',
      status: 'open',
      target_start: quarterStart(fiscalYear, 2),
      fill_by: quarterEnd(fiscalYear, 2),
      opened_at: daysAgo(20),
      recruiter: 'Mona Reed',
      hiring_manager: 'Pat Vega',
      hire_type: 'growth',
      budgeted_base: 150000,
    },
  ]
  const reqRows = await db.insert(requisitions).values(reqVals).returning()
  counts.requisitions = reqRows.length

  // ---- Req events (opened for each + a fill event for the filled ones) ----
  const eventVals: Array<typeof req_events.$inferInsert> = []
  for (const r of reqRows) {
    eventVals.push({
      req_id: r.id,
      workspace_id: workspaceId!,
      from_status: null,
      to_status: 'open',
      note: 'Requisition opened',
      created_by: userId,
    })
    if (r.status === 'filled') {
      eventVals.push({
        req_id: r.id,
        workspace_id: workspaceId!,
        from_status: 'open',
        to_status: 'filled',
        note: 'Candidate signed',
        created_by: userId,
      })
    }
  }
  await db.insert(req_events).values(eventVals)
  counts.req_events = eventVals.length

  // ---- Filled positions (link to the filled reqs) ----
  const filledReqs = reqRows.filter((r) => r.status === 'filled')
  const filledVals = [
    {
      workspace_id: workspaceId!,
      team_id: platform.id,
      req_id: filledReqs[0]?.id ?? null,
      plan_line_id: lineRows[0].id,
      person_name: 'Alex Chen',
      title: 'Software Engineer',
      level: 'L4',
      actual_start: quarterStart(fiscalYear, 1),
      actual_base: 168000,
      actual_variable: 15000,
      burden_rate: 0.25,
      hire_type: 'growth',
    },
    {
      workspace_id: workspaceId!,
      team_id: sales.id,
      req_id: filledReqs[1]?.id ?? null,
      plan_line_id: lineRows[5].id,
      person_name: 'Jordan Smith',
      title: 'Account Executive',
      level: 'L4',
      actual_start: quarterStart(fiscalYear, 1),
      actual_base: 122000,
      actual_variable: 118000,
      burden_rate: 0.25,
      hire_type: 'growth',
    },
  ]
  const filledRows = await db.insert(filled_positions).values(filledVals).returning()
  counts.filled_positions = filledRows.length

  // ---- Terminations ----
  const termVals = [
    {
      workspace_id: workspaceId!,
      team_id: product.id,
      person_name: 'Riley Moore',
      level: 'L5',
      title: 'Senior PM',
      term_date: daysAgo(45),
      reason: 'voluntary',
      base: 200000,
    },
  ]
  const termRows = await db.insert(terminations).values(termVals).returning()
  counts.terminations = termRows.length

  // ---- Budget baselines (per team / quarter) ----
  const budgetVals: Array<typeof budget_baselines.$inferInsert> = []
  for (const t of teamRows) {
    for (const q of [1, 2, 3, 4]) {
      // Aggregate planned cost for this team+quarter as a rough baseline.
      const teamLines = lineRows.filter((l) => l.team_id === t.id && l.quarter <= q)
      const cost = teamLines.reduce(
        (acc, l) => acc + (l.budgeted_base + l.budgeted_variable) * l.count * (1 + l.burden_rate),
        0,
      )
      budgetVals.push({
        workspace_id: workspaceId!,
        team_id: t.id,
        fiscal_year: fiscalYear,
        quarter: q,
        budgeted_cost: Math.round(cost * 1.05), // budget slightly above plan
        headcount_cap: teamLines.reduce((a, l) => a + l.count, 0) + 1,
        source: 'finance',
      })
    }
  }
  const budgetRows = await db.insert(budget_baselines).values(budgetVals).returning()
  counts.budget_baselines = budgetRows.length

  // Record the activity.
  await db.insert(activity_log).values({
    workspace_id: workspaceId,
    user_id: userId,
    action: 'seed_sample',
    entity_type: 'workspace',
    entity_id: workspaceId,
    detail: counts,
  })

  return c.json({ workspace_id: workspaceId, counts }, 201)
})

const resetSchema = z.object({
  workspace_id: z.string().min(1),
})

// ---------------------------------------------------------------------------
// POST /reset — clear all domain data for the caller's workspace. Deletes in
// FK-dependency order. Keeps the workspace + memberships intact.
// ---------------------------------------------------------------------------
router.post('/reset', authMiddleware, zValidator('json', resetSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')

  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const wsEq = (col: any) => eq(col, workspace_id)

  // Children first (tables that reference other domain rows), then parents.
  // reconciliation_cells → reconciliations
  await db.delete(reconciliation_cells).where(wsEq(reconciliation_cells.workspace_id))
  await db.delete(reconciliations).where(wsEq(reconciliations.workspace_id))
  // variance_pack_lines → variance_packs
  await db.delete(variance_pack_lines).where(wsEq(variance_pack_lines.workspace_id))
  await db.delete(variance_packs).where(wsEq(variance_packs.workspace_id))
  // scenario_overrides → scenarios
  await db.delete(scenario_overrides).where(wsEq(scenario_overrides.workspace_id))
  await db.delete(scenarios).where(wsEq(scenarios.workspace_id))
  // alerts → thresholds
  await db.delete(alerts).where(wsEq(alerts.workspace_id))
  await db.delete(thresholds).where(wsEq(thresholds.workspace_id))
  // exceptions → requisitions / filled_positions
  await db.delete(exceptions).where(wsEq(exceptions.workspace_id))
  // backfill_links → filled_positions / requisitions / terminations
  await db.delete(backfill_links).where(wsEq(backfill_links.workspace_id))
  // ghost_reqs → requisitions
  await db.delete(ghost_reqs).where(wsEq(ghost_reqs.workspace_id))
  // burn_forecasts, velocity_metrics
  await db.delete(burn_forecasts).where(wsEq(burn_forecasts.workspace_id))
  await db.delete(velocity_metrics).where(wsEq(velocity_metrics.workspace_id))
  // filled_positions → requisitions / plan_lines
  await db.delete(filled_positions).where(wsEq(filled_positions.workspace_id))
  // req_events → requisitions
  await db.delete(req_events).where(wsEq(req_events.workspace_id))
  // requisitions → plan_lines / teams
  await db.delete(requisitions).where(wsEq(requisitions.workspace_id))
  // terminations
  await db.delete(terminations).where(wsEq(terminations.workspace_id))
  // budget_baselines
  await db.delete(budget_baselines).where(wsEq(budget_baselines.workspace_id))
  // plan_lines → headcount_plans / teams
  await db.delete(plan_lines).where(wsEq(plan_lines.workspace_id))
  await db.delete(headcount_plans).where(wsEq(headcount_plans.workspace_id))
  // periods
  await db.delete(fiscal_periods).where(wsEq(fiscal_periods.workspace_id))
  // teams (parent_id is self-referential but not a DB FK, so a single delete is fine)
  await db.delete(teams).where(wsEq(teams.workspace_id))
  // misc workspace-scoped collateral
  await db.delete(notifications).where(wsEq(notifications.workspace_id))
  await db.delete(snapshots).where(wsEq(snapshots.workspace_id))
  await db.delete(imports).where(wsEq(imports.workspace_id))
  await db.delete(activity_log).where(wsEq(activity_log.workspace_id))

  return c.json({ success: true })
})

export default router
