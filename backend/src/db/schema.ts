import { pgTable, text, integer, boolean, timestamp, jsonb, unique, real } from 'drizzle-orm/pg-core'

// ─────────────────────────────────────────────────────────────
// Core: workspaces, members, teams, periods
// ─────────────────────────────────────────────────────────────

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  owner_id: text('owner_id').notNull(),
  fiscal_year_start_month: integer('fiscal_year_start_month').default(1).notNull(),
  currency: text('currency').default('USD').notNull(),
  default_burden_rate: real('default_burden_rate').default(0.25).notNull(),
  planning_granularity: text('planning_granularity').default('team_level_quarter').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const workspace_members = pgTable('workspace_members', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  role: text('role').default('editor').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.user_id)])

export const teams = pgTable('teams', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  parent_id: text('parent_id'),
  cost_center: text('cost_center'),
  owner_user_id: text('owner_user_id'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const fiscal_periods = pgTable('fiscal_periods', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  fiscal_year: integer('fiscal_year').notNull(),
  quarter: integer('quarter').notNull(),
  label: text('label').notNull(),
  start_date: timestamp('start_date'),
  end_date: timestamp('end_date'),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.fiscal_year, t.quarter)])

// ─────────────────────────────────────────────────────────────
// Headcount plan + plan lines
// ─────────────────────────────────────────────────────────────

export const headcount_plans = pgTable('headcount_plans', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  fiscal_year: integer('fiscal_year').notNull(),
  version: integer('version').default(1).notNull(),
  status: text('status').default('draft').notNull(),
  approved_by: text('approved_by'),
  approved_at: timestamp('approved_at'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})

export const plan_lines = pgTable('plan_lines', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  plan_id: text('plan_id').notNull().references(() => headcount_plans.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  team_id: text('team_id').references(() => teams.id),
  level: text('level').notNull(),
  role_title: text('role_title').notNull(),
  quarter: integer('quarter').notNull(),
  count: integer('count').default(1).notNull(),
  budgeted_base: real('budgeted_base').default(0).notNull(),
  budgeted_variable: real('budgeted_variable').default(0).notNull(),
  burden_rate: real('burden_rate').default(0.25).notNull(),
  planned_start_quarter: integer('planned_start_quarter').notNull(),
  hire_type: text('hire_type').default('growth').notNull(),
  justification: text('justification').default('').notNull(),
  annotations: jsonb('annotations').$type<Array<{ user_id: string; note: string; at: string }>>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Requisitions + events
// ─────────────────────────────────────────────────────────────

export const requisitions = pgTable('requisitions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  team_id: text('team_id').references(() => teams.id),
  plan_line_id: text('plan_line_id').references(() => plan_lines.id),
  title: text('title').notNull(),
  level: text('level').notNull(),
  status: text('status').default('open').notNull(),
  target_start: timestamp('target_start'),
  fill_by: timestamp('fill_by'),
  opened_at: timestamp('opened_at').defaultNow().notNull(),
  recruiter: text('recruiter'),
  hiring_manager: text('hiring_manager'),
  hire_type: text('hire_type').default('growth').notNull(),
  budgeted_base: real('budgeted_base').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const req_events = pgTable('req_events', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  req_id: text('req_id').notNull().references(() => requisitions.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  from_status: text('from_status'),
  to_status: text('to_status').notNull(),
  note: text('note').default('').notNull(),
  created_by: text('created_by'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Filled positions + terminations
// ─────────────────────────────────────────────────────────────

export const filled_positions = pgTable('filled_positions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  team_id: text('team_id').references(() => teams.id),
  req_id: text('req_id').references(() => requisitions.id),
  plan_line_id: text('plan_line_id').references(() => plan_lines.id),
  person_name: text('person_name').notNull(),
  title: text('title').notNull(),
  level: text('level').notNull(),
  actual_start: timestamp('actual_start'),
  actual_base: real('actual_base').default(0).notNull(),
  actual_variable: real('actual_variable').default(0).notNull(),
  burden_rate: real('burden_rate').default(0.25).notNull(),
  hire_type: text('hire_type').default('growth').notNull(),
  backfill_of: text('backfill_of'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const terminations = pgTable('terminations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  team_id: text('team_id').references(() => teams.id),
  person_name: text('person_name').notNull(),
  level: text('level').notNull(),
  title: text('title').notNull(),
  term_date: timestamp('term_date'),
  reason: text('reason').default('').notNull(),
  base: real('base').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Budget baseline
// ─────────────────────────────────────────────────────────────

export const budget_baselines = pgTable('budget_baselines', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  team_id: text('team_id').references(() => teams.id),
  fiscal_year: integer('fiscal_year').notNull(),
  quarter: integer('quarter').notNull(),
  budgeted_cost: real('budgeted_cost').default(0).notNull(),
  headcount_cap: integer('headcount_cap').default(0).notNull(),
  source: text('source').default('finance').notNull(),
  revisions: jsonb('revisions').$type<Array<{ at: string; budgeted_cost: number; note: string }>>().default([]),
  created_at: timestamp('created_at').defaultNow().notNull(),
}, (t) => [unique().on(t.workspace_id, t.team_id, t.fiscal_year, t.quarter)])

// ─────────────────────────────────────────────────────────────
// Reconciliation engine
// ─────────────────────────────────────────────────────────────

export const reconciliations = pgTable('reconciliations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  plan_id: text('plan_id').references(() => headcount_plans.id),
  fiscal_year: integer('fiscal_year').notNull(),
  quarter: integer('quarter').notNull(),
  status: text('status').default('draft').notNull(),
  total_planned: integer('total_planned').default(0).notNull(),
  total_open: integer('total_open').default(0).notNull(),
  total_filled: integer('total_filled').default(0).notNull(),
  cost_variance: real('cost_variance').default(0).notNull(),
  summary: jsonb('summary').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const reconciliation_cells = pgTable('reconciliation_cells', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  reconciliation_id: text('reconciliation_id').notNull().references(() => reconciliations.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  team_id: text('team_id').references(() => teams.id),
  level: text('level').notNull(),
  quarter: integer('quarter').notNull(),
  planned_count: integer('planned_count').default(0).notNull(),
  open_count: integer('open_count').default(0).notNull(),
  filled_count: integer('filled_count').default(0).notNull(),
  count_variance: integer('count_variance').default(0).notNull(),
  cost_variance: real('cost_variance').default(0).notNull(),
  status: text('status').default('on_plan').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Ghost reqs + backfills
// ─────────────────────────────────────────────────────────────

export const ghost_reqs = pgTable('ghost_reqs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  req_id: text('req_id').notNull().references(() => requisitions.id),
  reason: text('reason').notNull(),
  severity: text('severity').default('medium').notNull(),
  days_overdue: integer('days_overdue').default(0).notNull(),
  status: text('status').default('open').notNull(),
  resolution: text('resolution').default('').notNull(),
  resolved_by: text('resolved_by'),
  resolved_at: timestamp('resolved_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const backfill_links = pgTable('backfill_links', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  filled_position_id: text('filled_position_id').references(() => filled_positions.id),
  req_id: text('req_id').references(() => requisitions.id),
  termination_id: text('termination_id').references(() => terminations.id),
  classification: text('classification').default('backfill').notNull(),
  confidence: real('confidence').default(0).notNull(),
  confirmed: boolean('confirmed').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Burn forecast + velocity
// ─────────────────────────────────────────────────────────────

export const burn_forecasts = pgTable('burn_forecasts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  plan_id: text('plan_id').references(() => headcount_plans.id),
  fiscal_year: integer('fiscal_year').notNull(),
  scenario: text('scenario').default('expected').notNull(),
  projected_year_end_cost: real('projected_year_end_cost').default(0).notNull(),
  budget_total: real('budget_total').default(0).notNull(),
  variance: real('variance').default(0).notNull(),
  by_period: jsonb('by_period').$type<Array<{ quarter: number; actual: number; projected: number; budget: number }>>().default([]),
  assumptions: jsonb('assumptions').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const velocity_metrics = pgTable('velocity_metrics', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  team_id: text('team_id').references(() => teams.id),
  level: text('level'),
  recruiter: text('recruiter'),
  avg_days_to_fill: real('avg_days_to_fill').default(0).notNull(),
  open_count: integer('open_count').default(0).notNull(),
  filled_count: integer('filled_count').default(0).notNull(),
  bottleneck_stage: text('bottleneck_stage').default('').notNull(),
  period_label: text('period_label').default('').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Variance packs
// ─────────────────────────────────────────────────────────────

export const variance_packs = pgTable('variance_packs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  fiscal_year: integer('fiscal_year').notNull(),
  period_label: text('period_label').notNull(),
  status: text('status').default('draft').notNull(),
  starting_budget: real('starting_budget').default(0).notNull(),
  ending_actual: real('ending_actual').default(0).notNull(),
  total_variance: real('total_variance').default(0).notNull(),
  people_signed_by: text('people_signed_by'),
  people_signed_at: timestamp('people_signed_at'),
  finance_signed_by: text('finance_signed_by'),
  finance_signed_at: timestamp('finance_signed_at'),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const variance_pack_lines = pgTable('variance_pack_lines', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  variance_pack_id: text('variance_pack_id').notNull().references(() => variance_packs.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  bucket: text('bucket').notNull(),
  label: text('label').notNull(),
  amount: real('amount').default(0).notNull(),
  sort_order: integer('sort_order').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Scenarios
// ─────────────────────────────────────────────────────────────

export const scenarios = pgTable('scenarios', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  plan_id: text('plan_id').references(() => headcount_plans.id),
  name: text('name').notNull(),
  description: text('description').default('').notNull(),
  is_frozen: boolean('is_frozen').default(false).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const scenario_overrides = pgTable('scenario_overrides', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  scenario_id: text('scenario_id').notNull().references(() => scenarios.id),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  plan_line_id: text('plan_line_id').references(() => plan_lines.id),
  override_count: integer('override_count'),
  override_start_quarter: integer('override_start_quarter'),
  override_base: real('override_base'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Thresholds + alerts + exceptions
// ─────────────────────────────────────────────────────────────

export const thresholds = pgTable('thresholds', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  name: text('name').notNull(),
  metric: text('metric').notNull(),
  comparator: text('comparator').default('gt').notNull(),
  value: real('value').default(0).notNull(),
  team_id: text('team_id').references(() => teams.id),
  is_active: boolean('is_active').default(true).notNull(),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const alerts = pgTable('alerts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  threshold_id: text('threshold_id').references(() => thresholds.id),
  title: text('title').notNull(),
  detail: text('detail').default('').notNull(),
  severity: text('severity').default('medium').notNull(),
  status: text('status').default('open').notNull(),
  assigned_to: text('assigned_to'),
  acknowledged_at: timestamp('acknowledged_at'),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const exceptions = pgTable('exceptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  req_id: text('req_id').references(() => requisitions.id),
  filled_position_id: text('filled_position_id').references(() => filled_positions.id),
  reason: text('reason').notNull(),
  status: text('status').default('pending').notNull(),
  requested_by: text('requested_by').notNull(),
  approver: text('approver'),
  decided_at: timestamp('decided_at'),
  decision_note: text('decision_note').default('').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Notifications + activity + snapshots + imports
// ─────────────────────────────────────────────────────────────

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body').default('').notNull(),
  link: text('link').default('').notNull(),
  is_read: boolean('is_read').default(false).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const activity_log = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  user_id: text('user_id').notNull(),
  action: text('action').notNull(),
  entity_type: text('entity_type').notNull(),
  entity_id: text('entity_id'),
  detail: jsonb('detail').$type<Record<string, unknown>>().default({}),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const snapshots = pgTable('snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  period_label: text('period_label').notNull(),
  kind: text('kind').default('period_close').notNull(),
  payload: jsonb('payload').$type<Record<string, unknown>>().default({}),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const imports = pgTable('imports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  workspace_id: text('workspace_id').notNull().references(() => workspaces.id),
  entity_type: text('entity_type').notNull(),
  status: text('status').default('dry_run').notNull(),
  row_count: integer('row_count').default(0).notNull(),
  error_count: integer('error_count').default(0).notNull(),
  errors: jsonb('errors').$type<Array<{ row: number; message: string }>>().default([]),
  created_by: text('created_by').notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

// ─────────────────────────────────────────────────────────────
// Billing (Stripe-optional) — note: 'plans' here is the billing
// plan catalog, distinct from the headcount_plans domain table.
// ─────────────────────────────────────────────────────────────

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  price_cents: integer('price_cents').default(0).notNull(),
  created_at: timestamp('created_at').defaultNow().notNull(),
})

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  user_id: text('user_id').notNull().unique(),
  plan_id: text('plan_id').notNull().references(() => plans.id),
  stripe_customer_id: text('stripe_customer_id'),
  stripe_subscription_id: text('stripe_subscription_id'),
  status: text('status').default('active').notNull(),
  current_period_end: timestamp('current_period_end'),
  created_at: timestamp('created_at').defaultNow().notNull(),
  updated_at: timestamp('updated_at').defaultNow().notNull(),
})
