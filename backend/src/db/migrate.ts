import { db } from './index.js'
import { sql } from 'drizzle-orm'

const statements: string[] = [
  // ── workspaces ──
  `CREATE TABLE IF NOT EXISTS workspaces (
    id text PRIMARY KEY,
    name text NOT NULL,
    owner_id text NOT NULL,
    fiscal_year_start_month integer NOT NULL DEFAULT 1,
    currency text NOT NULL DEFAULT 'USD',
    default_burden_rate real NOT NULL DEFAULT 0.25,
    planning_granularity text NOT NULL DEFAULT 'team_level_quarter',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── workspace_members ──
  `CREATE TABLE IF NOT EXISTS workspace_members (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    role text NOT NULL DEFAULT 'editor',
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id)
  )`,

  // ── teams ──
  `CREATE TABLE IF NOT EXISTS teams (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    parent_id text,
    cost_center text,
    owner_user_id text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── fiscal_periods ──
  `CREATE TABLE IF NOT EXISTS fiscal_periods (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    fiscal_year integer NOT NULL,
    quarter integer NOT NULL,
    label text NOT NULL,
    start_date timestamptz,
    end_date timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, fiscal_year, quarter)
  )`,

  // ── headcount_plans ──
  `CREATE TABLE IF NOT EXISTS headcount_plans (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    fiscal_year integer NOT NULL,
    version integer NOT NULL DEFAULT 1,
    status text NOT NULL DEFAULT 'draft',
    approved_by text,
    approved_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── plan_lines ──
  `CREATE TABLE IF NOT EXISTS plan_lines (
    id text PRIMARY KEY,
    plan_id text NOT NULL REFERENCES headcount_plans(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    team_id text REFERENCES teams(id),
    level text NOT NULL,
    role_title text NOT NULL,
    quarter integer NOT NULL,
    count integer NOT NULL DEFAULT 1,
    budgeted_base real NOT NULL DEFAULT 0,
    budgeted_variable real NOT NULL DEFAULT 0,
    burden_rate real NOT NULL DEFAULT 0.25,
    planned_start_quarter integer NOT NULL,
    hire_type text NOT NULL DEFAULT 'growth',
    justification text NOT NULL DEFAULT '',
    annotations jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── requisitions ──
  `CREATE TABLE IF NOT EXISTS requisitions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    team_id text REFERENCES teams(id),
    plan_line_id text REFERENCES plan_lines(id),
    title text NOT NULL,
    level text NOT NULL,
    status text NOT NULL DEFAULT 'open',
    target_start timestamptz,
    fill_by timestamptz,
    opened_at timestamptz NOT NULL DEFAULT now(),
    recruiter text,
    hiring_manager text,
    hire_type text NOT NULL DEFAULT 'growth',
    budgeted_base real NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── req_events ──
  `CREATE TABLE IF NOT EXISTS req_events (
    id text PRIMARY KEY,
    req_id text NOT NULL REFERENCES requisitions(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    from_status text,
    to_status text NOT NULL,
    note text NOT NULL DEFAULT '',
    created_by text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── filled_positions ──
  `CREATE TABLE IF NOT EXISTS filled_positions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    team_id text REFERENCES teams(id),
    req_id text REFERENCES requisitions(id),
    plan_line_id text REFERENCES plan_lines(id),
    person_name text NOT NULL,
    title text NOT NULL,
    level text NOT NULL,
    actual_start timestamptz,
    actual_base real NOT NULL DEFAULT 0,
    actual_variable real NOT NULL DEFAULT 0,
    burden_rate real NOT NULL DEFAULT 0.25,
    hire_type text NOT NULL DEFAULT 'growth',
    backfill_of text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── terminations ──
  `CREATE TABLE IF NOT EXISTS terminations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    team_id text REFERENCES teams(id),
    person_name text NOT NULL,
    level text NOT NULL,
    title text NOT NULL,
    term_date timestamptz,
    reason text NOT NULL DEFAULT '',
    base real NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── budget_baselines ──
  `CREATE TABLE IF NOT EXISTS budget_baselines (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    team_id text REFERENCES teams(id),
    fiscal_year integer NOT NULL,
    quarter integer NOT NULL,
    budgeted_cost real NOT NULL DEFAULT 0,
    headcount_cap integer NOT NULL DEFAULT 0,
    source text NOT NULL DEFAULT 'finance',
    revisions jsonb DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, team_id, fiscal_year, quarter)
  )`,

  // ── reconciliations ──
  `CREATE TABLE IF NOT EXISTS reconciliations (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    plan_id text REFERENCES headcount_plans(id),
    fiscal_year integer NOT NULL,
    quarter integer NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    total_planned integer NOT NULL DEFAULT 0,
    total_open integer NOT NULL DEFAULT 0,
    total_filled integer NOT NULL DEFAULT 0,
    cost_variance real NOT NULL DEFAULT 0,
    summary jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── reconciliation_cells ──
  `CREATE TABLE IF NOT EXISTS reconciliation_cells (
    id text PRIMARY KEY,
    reconciliation_id text NOT NULL REFERENCES reconciliations(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    team_id text REFERENCES teams(id),
    level text NOT NULL,
    quarter integer NOT NULL,
    planned_count integer NOT NULL DEFAULT 0,
    open_count integer NOT NULL DEFAULT 0,
    filled_count integer NOT NULL DEFAULT 0,
    count_variance integer NOT NULL DEFAULT 0,
    cost_variance real NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'on_plan',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── ghost_reqs ──
  `CREATE TABLE IF NOT EXISTS ghost_reqs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    req_id text NOT NULL REFERENCES requisitions(id),
    reason text NOT NULL,
    severity text NOT NULL DEFAULT 'medium',
    days_overdue integer NOT NULL DEFAULT 0,
    status text NOT NULL DEFAULT 'open',
    resolution text NOT NULL DEFAULT '',
    resolved_by text,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── backfill_links ──
  `CREATE TABLE IF NOT EXISTS backfill_links (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    filled_position_id text REFERENCES filled_positions(id),
    req_id text REFERENCES requisitions(id),
    termination_id text REFERENCES terminations(id),
    classification text NOT NULL DEFAULT 'backfill',
    confidence real NOT NULL DEFAULT 0,
    confirmed boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── burn_forecasts ──
  `CREATE TABLE IF NOT EXISTS burn_forecasts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    plan_id text REFERENCES headcount_plans(id),
    fiscal_year integer NOT NULL,
    scenario text NOT NULL DEFAULT 'expected',
    projected_year_end_cost real NOT NULL DEFAULT 0,
    budget_total real NOT NULL DEFAULT 0,
    variance real NOT NULL DEFAULT 0,
    by_period jsonb DEFAULT '[]'::jsonb,
    assumptions jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── velocity_metrics ──
  `CREATE TABLE IF NOT EXISTS velocity_metrics (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    team_id text REFERENCES teams(id),
    level text,
    recruiter text,
    avg_days_to_fill real NOT NULL DEFAULT 0,
    open_count integer NOT NULL DEFAULT 0,
    filled_count integer NOT NULL DEFAULT 0,
    bottleneck_stage text NOT NULL DEFAULT '',
    period_label text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── variance_packs ──
  `CREATE TABLE IF NOT EXISTS variance_packs (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    fiscal_year integer NOT NULL,
    period_label text NOT NULL,
    status text NOT NULL DEFAULT 'draft',
    starting_budget real NOT NULL DEFAULT 0,
    ending_actual real NOT NULL DEFAULT 0,
    total_variance real NOT NULL DEFAULT 0,
    people_signed_by text,
    people_signed_at timestamptz,
    finance_signed_by text,
    finance_signed_at timestamptz,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── variance_pack_lines ──
  `CREATE TABLE IF NOT EXISTS variance_pack_lines (
    id text PRIMARY KEY,
    variance_pack_id text NOT NULL REFERENCES variance_packs(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    bucket text NOT NULL,
    label text NOT NULL,
    amount real NOT NULL DEFAULT 0,
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── scenarios ──
  `CREATE TABLE IF NOT EXISTS scenarios (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    plan_id text REFERENCES headcount_plans(id),
    name text NOT NULL,
    description text NOT NULL DEFAULT '',
    is_frozen boolean NOT NULL DEFAULT false,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── scenario_overrides ──
  `CREATE TABLE IF NOT EXISTS scenario_overrides (
    id text PRIMARY KEY,
    scenario_id text NOT NULL REFERENCES scenarios(id),
    workspace_id text NOT NULL REFERENCES workspaces(id),
    plan_line_id text REFERENCES plan_lines(id),
    override_count integer,
    override_start_quarter integer,
    override_base real,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── thresholds ──
  `CREATE TABLE IF NOT EXISTS thresholds (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    metric text NOT NULL,
    comparator text NOT NULL DEFAULT 'gt',
    value real NOT NULL DEFAULT 0,
    team_id text REFERENCES teams(id),
    is_active boolean NOT NULL DEFAULT true,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── alerts ──
  `CREATE TABLE IF NOT EXISTS alerts (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    threshold_id text REFERENCES thresholds(id),
    title text NOT NULL,
    detail text NOT NULL DEFAULT '',
    severity text NOT NULL DEFAULT 'medium',
    status text NOT NULL DEFAULT 'open',
    assigned_to text,
    acknowledged_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── exceptions ──
  `CREATE TABLE IF NOT EXISTS exceptions (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    req_id text REFERENCES requisitions(id),
    filled_position_id text REFERENCES filled_positions(id),
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    requested_by text NOT NULL,
    approver text,
    decided_at timestamptz,
    decision_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── notifications ──
  `CREATE TABLE IF NOT EXISTS notifications (
    id text PRIMARY KEY,
    workspace_id text REFERENCES workspaces(id),
    user_id text NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    link text NOT NULL DEFAULT '',
    is_read boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── activity_log ──
  `CREATE TABLE IF NOT EXISTS activity_log (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    user_id text NOT NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id text,
    detail jsonb DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── snapshots ──
  `CREATE TABLE IF NOT EXISTS snapshots (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    period_label text NOT NULL,
    kind text NOT NULL DEFAULT 'period_close',
    payload jsonb DEFAULT '{}'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── imports ──
  `CREATE TABLE IF NOT EXISTS imports (
    id text PRIMARY KEY,
    workspace_id text NOT NULL REFERENCES workspaces(id),
    entity_type text NOT NULL,
    status text NOT NULL DEFAULT 'dry_run',
    row_count integer NOT NULL DEFAULT 0,
    error_count integer NOT NULL DEFAULT 0,
    errors jsonb DEFAULT '[]'::jsonb,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── plans (billing) ──
  `CREATE TABLE IF NOT EXISTS plans (
    id text PRIMARY KEY,
    name text NOT NULL,
    price_cents integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── subscriptions ──
  `CREATE TABLE IF NOT EXISTS subscriptions (
    id text PRIMARY KEY,
    user_id text NOT NULL UNIQUE,
    plan_id text NOT NULL REFERENCES plans(id),
    stripe_customer_id text,
    stripe_subscription_id text,
    status text NOT NULL DEFAULT 'active',
    current_period_end timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  )`,

  // ── indexes on FKs / workspace_id ──
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_teams_workspace ON teams(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_fiscal_periods_workspace ON fiscal_periods(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_headcount_plans_workspace ON headcount_plans(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plan_lines_plan ON plan_lines(plan_id)`,
  `CREATE INDEX IF NOT EXISTS idx_plan_lines_workspace ON plan_lines(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_requisitions_workspace ON requisitions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_requisitions_plan_line ON requisitions(plan_line_id)`,
  `CREATE INDEX IF NOT EXISTS idx_req_events_req ON req_events(req_id)`,
  `CREATE INDEX IF NOT EXISTS idx_filled_positions_workspace ON filled_positions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_filled_positions_req ON filled_positions(req_id)`,
  `CREATE INDEX IF NOT EXISTS idx_terminations_workspace ON terminations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_budget_baselines_workspace ON budget_baselines(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliations_workspace ON reconciliations(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reconciliation_cells_recon ON reconciliation_cells(reconciliation_id)`,
  `CREATE INDEX IF NOT EXISTS idx_ghost_reqs_workspace ON ghost_reqs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_backfill_links_workspace ON backfill_links(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_burn_forecasts_workspace ON burn_forecasts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_velocity_metrics_workspace ON velocity_metrics(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_variance_packs_workspace ON variance_packs(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_variance_pack_lines_pack ON variance_pack_lines(variance_pack_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenarios_workspace ON scenarios(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_scenario_overrides_scenario ON scenario_overrides(scenario_id)`,
  `CREATE INDEX IF NOT EXISTS idx_thresholds_workspace ON thresholds(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_alerts_workspace ON alerts(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_exceptions_workspace ON exceptions(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activity_log_workspace ON activity_log(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_snapshots_workspace ON snapshots(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_imports_workspace ON imports(workspace_id)`,
  `CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id)`,
]

export async function migrate() {
  for (const stmt of statements) {
    await db.execute(sql.raw(stmt))
  }
  console.log(`Applied ${statements.length} migration statements`)
}
