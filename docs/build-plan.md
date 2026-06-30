# HeadcountPlanReconciler — Build Contract (Single Source of Truth)

Every other agent MUST follow this document exactly. Filenames, mount paths, api method names, and page files declared here are **binding**. Stack per `_template-report.md`: Hono backend mounted under `/api/v1` via a child `api` router; Next.js 16 + `@neondatabase/auth@0.4.2-beta`; `proxy.ts` only; backend trusts `X-User-Id` via `getUserId(c)`; public reads / auth-gated writes with zod + ownership checks; frontend calls `fetch('/api/proxy/<path>')` mapping 1:1 to `/api/v1/<path>`.

Ownership rule: every mutating endpoint resolves `getUserId(c)`, verifies the user is a member of the target `workspace_id` (via `workspace_members`), and 403s otherwise. Public GETs require no auth but still scope by `workspace_id` query param where applicable.

---

## (a) Tables (columns)

| Table | Key columns |
|-------|-------------|
| `workspaces` | id, name, owner_id, fiscal_year_start_month, currency, default_burden_rate, planning_granularity, created_at, updated_at |
| `workspace_members` | id, workspace_id→workspaces, user_id, role, created_at; UNIQUE(workspace_id,user_id) |
| `teams` | id, workspace_id→workspaces, name, parent_id, cost_center, owner_user_id, created_at |
| `fiscal_periods` | id, workspace_id→workspaces, fiscal_year, quarter, label, start_date, end_date, created_at; UNIQUE(workspace_id,fiscal_year,quarter) |
| `headcount_plans` | id, workspace_id→workspaces, name, fiscal_year, version, status, approved_by, approved_at, created_by, created_at, updated_at |
| `plan_lines` | id, plan_id→headcount_plans, workspace_id→workspaces, team_id→teams, level, role_title, quarter, count, budgeted_base, budgeted_variable, burden_rate, planned_start_quarter, hire_type, justification, annotations(jsonb), created_at |
| `requisitions` | id, workspace_id→workspaces, team_id→teams, plan_line_id→plan_lines, title, level, status, target_start, fill_by, opened_at, recruiter, hiring_manager, hire_type, budgeted_base, created_at |
| `req_events` | id, req_id→requisitions, workspace_id→workspaces, from_status, to_status, note, created_by, created_at |
| `filled_positions` | id, workspace_id→workspaces, team_id→teams, req_id→requisitions, plan_line_id→plan_lines, person_name, title, level, actual_start, actual_base, actual_variable, burden_rate, hire_type, backfill_of, created_at |
| `terminations` | id, workspace_id→workspaces, team_id→teams, person_name, level, title, term_date, reason, base, created_at |
| `budget_baselines` | id, workspace_id→workspaces, team_id→teams, fiscal_year, quarter, budgeted_cost, headcount_cap, source, revisions(jsonb), created_at; UNIQUE(workspace_id,team_id,fiscal_year,quarter) |
| `reconciliations` | id, workspace_id→workspaces, plan_id→headcount_plans, fiscal_year, quarter, status, total_planned, total_open, total_filled, cost_variance, summary(jsonb), created_by, created_at |
| `reconciliation_cells` | id, reconciliation_id→reconciliations, workspace_id→workspaces, team_id→teams, level, quarter, planned_count, open_count, filled_count, count_variance, cost_variance, status, created_at |
| `ghost_reqs` | id, workspace_id→workspaces, req_id→requisitions, reason, severity, days_overdue, status, resolution, resolved_by, resolved_at, created_at |
| `backfill_links` | id, workspace_id→workspaces, filled_position_id→filled_positions, req_id→requisitions, termination_id→terminations, classification, confidence, confirmed, created_at |
| `burn_forecasts` | id, workspace_id→workspaces, plan_id→headcount_plans, fiscal_year, scenario, projected_year_end_cost, budget_total, variance, by_period(jsonb), assumptions(jsonb), created_by, created_at |
| `velocity_metrics` | id, workspace_id→workspaces, team_id→teams, level, recruiter, avg_days_to_fill, open_count, filled_count, bottleneck_stage, period_label, created_at |
| `variance_packs` | id, workspace_id→workspaces, fiscal_year, period_label, status, starting_budget, ending_actual, total_variance, people_signed_by, people_signed_at, finance_signed_by, finance_signed_at, created_by, created_at |
| `variance_pack_lines` | id, variance_pack_id→variance_packs, workspace_id→workspaces, bucket, label, amount, sort_order, created_at |
| `scenarios` | id, workspace_id→workspaces, plan_id→headcount_plans, name, description, is_frozen, created_by, created_at |
| `scenario_overrides` | id, scenario_id→scenarios, workspace_id→workspaces, plan_line_id→plan_lines, override_count, override_start_quarter, override_base, created_at |
| `thresholds` | id, workspace_id→workspaces, name, metric, comparator, value, team_id→teams, is_active, created_by, created_at |
| `alerts` | id, workspace_id→workspaces, threshold_id→thresholds, title, detail, severity, status, assigned_to, acknowledged_at, created_at |
| `exceptions` | id, workspace_id→workspaces, req_id→requisitions, filled_position_id→filled_positions, reason, status, requested_by, approver, decided_at, decision_note, created_at |
| `notifications` | id, workspace_id→workspaces, user_id, type, title, body, link, is_read, created_at |
| `activity_log` | id, workspace_id→workspaces, user_id, action, entity_type, entity_id, detail(jsonb), created_at |
| `snapshots` | id, workspace_id→workspaces, period_label, kind, payload(jsonb), created_by, created_at |
| `imports` | id, workspace_id→workspaces, entity_type, status, row_count, error_count, errors(jsonb), created_by, created_at |
| `plans` (billing) | id(text 'free'/'pro'), name, price_cents, created_at |
| `subscriptions` | id, user_id(unique), plan_id→plans, stripe_customer_id, stripe_subscription_id, status, current_period_end, created_at, updated_at |

---

## (b) Backend route files

All mounted in `index.ts` via `api.route('/<mount>', router)`, then `app.route('/api/v1', api)`. Each file does `export default router`. Response shapes: lists return arrays of rows; single returns the row; mutations return the row(s) with 201 on create.

### 1. `workspaces.ts` → mount `workspaces`
- `GET /` — public — list workspaces the caller belongs to (filter by member; pass `?user_id` from header) → `Workspace[]`
- `GET /:id` — public — workspace detail → `Workspace`
- `POST /` — auth — create workspace (also inserts owner membership) → `Workspace` 201
- `PUT /:id` — auth(owner) — update settings → `Workspace`
- `DELETE /:id` — auth(owner) — delete → `{ success }`

### 2. `members.ts` → mount `members`
- `GET /` — public — `?workspace_id` list members → `Member[]`
- `POST /` — auth — add member by user_id+role → `Member` 201
- `PUT /:id` — auth — change role → `Member`
- `DELETE /:id` — auth — remove member → `{ success }`

### 3. `teams.ts` → mount `teams`
- `GET /` — public — `?workspace_id` list teams (org tree) → `Team[]`
- `GET /:id` — public — team detail → `Team`
- `POST /` — auth — create team → `Team` 201
- `PUT /:id` — auth — update (name/parent/cost_center/owner) → `Team`
- `DELETE /:id` — auth — delete → `{ success }`

### 4. `periods.ts` → mount `periods`
- `GET /` — public — `?workspace_id` list fiscal periods → `Period[]`
- `POST /` — auth — create period → `Period` 201
- `POST /generate` — auth — generate 4 quarters for `{ workspace_id, fiscal_year }` → `Period[]` 201
- `DELETE /:id` — auth — delete → `{ success }`

### 5. `plans.ts` → mount `plans` (headcount plans)
- `GET /` — public — `?workspace_id` list plans → `Plan[]`
- `GET /:id` — public — plan detail → `Plan`
- `POST /` — auth — create plan → `Plan` 201
- `PUT /:id` — auth — update (name/status) → `Plan`
- `POST /:id/approve` — auth — set status approved + approver/approved_at → `Plan`
- `POST /:id/clone` — auth — clone plan + its lines as new version → `Plan` 201
- `DELETE /:id` — auth — delete → `{ success }`

### 6. `plan-lines.ts` → mount `plan-lines`
- `GET /` — public — `?plan_id` or `?workspace_id` list lines → `PlanLine[]`
- `GET /:id` — public — line detail → `PlanLine`
- `POST /` — auth — create line → `PlanLine` 201
- `POST /bulk` — auth — create many `{ lines: [...] }` → `PlanLine[]` 201
- `PUT /:id` — auth — update line → `PlanLine`
- `POST /:id/annotate` — auth — append annotation → `PlanLine`
- `DELETE /:id` — auth — delete → `{ success }`

### 7. `requisitions.ts` → mount `requisitions`
- `GET /` — public — `?workspace_id` (filter status/team) list reqs → `Req[]`
- `GET /:id` — public — req detail (+ events) → `Req & { events }`
- `POST /` — auth — create req (records opened event) → `Req` 201
- `PUT /:id` — auth — update fields → `Req`
- `POST /:id/status` — auth — transition status, append req_event → `Req`
- `POST /:id/link-plan` — auth — set plan_line_id → `Req`
- `POST /bulk` — auth — bulk import `{ reqs: [...] }` → `Req[]` 201
- `DELETE /:id` — auth — delete → `{ success }`

### 8. `filled-positions.ts` → mount `filled-positions`
- `GET /` — public — `?workspace_id` list hires → `Filled[]`
- `GET /:id` — public — detail → `Filled`
- `POST /` — auth — create hire → `Filled` 201
- `PUT /:id` — auth — update → `Filled`
- `POST /bulk` — auth — bulk import → `Filled[]` 201
- `DELETE /:id` — auth — delete → `{ success }`

### 9. `terminations.ts` → mount `terminations`
- `GET /` — public — `?workspace_id` list → `Term[]`
- `POST /` — auth — create → `Term` 201
- `POST /bulk` — auth — bulk import → `Term[]` 201
- `DELETE /:id` — auth — delete → `{ success }`

### 10. `budget.ts` → mount `budget`
- `GET /` — public — `?workspace_id` list baselines → `Budget[]`
- `GET /summary` — public — `?workspace_id&fiscal_year` budget-vs-plan-vs-actual → `{ budget, plan, actual, byTeam[] }`
- `POST /` — auth — upsert baseline (onConflict team+fy+q) → `Budget` 201
- `POST /:id/revise` — auth — append revision + update cost → `Budget`
- `DELETE /:id` — auth — delete → `{ success }`

### 11. `reconciliation.ts` → mount `reconciliation`
- `GET /` — public — `?workspace_id` list reconciliation runs → `Recon[]`
- `GET /:id` — public — run + cells → `Recon & { cells }`
- `POST /run` — auth — compute three-way match for `{ workspace_id, plan_id, fiscal_year, quarter }`, persist run + cells → `Recon & { cells }` 201
- `GET /:id/cells` — public — cells for a run → `Cell[]`
- `POST /:id/snapshot` — auth — freeze run (status=closed) → `Recon`
- `DELETE /:id` — auth — delete → `{ success }`

### 12. `ghost-reqs.ts` → mount `ghost-reqs`
- `GET /` — public — `?workspace_id` list findings → `Ghost[]`
- `POST /scan` — auth — scan reqs (no plan line / past fill_by / abandoned), upsert findings → `Ghost[]` 201
- `POST /:id/resolve` — auth — set resolution + status + resolved_by/at → `Ghost`
- `DELETE /:id` — auth — delete → `{ success }`

### 13. `backfills.ts` → mount `backfills`
- `GET /` — public — `?workspace_id` list backfill links → `Backfill[]`
- `GET /net-headcount` — public — `?workspace_id` growth − terms → `{ growth, backfill, terminations, net }`
- `POST /suggest` — auth — auto-match terms↔hires/reqs in same team/level → `Backfill[]` 201
- `POST /:id/confirm` — auth — confirm classification → `Backfill`
- `PUT /:id` — auth — set classification → `Backfill`
- `DELETE /:id` — auth — delete → `{ success }`

### 14. `burn-forecast.ts` → mount `burn-forecast`
- `GET /` — public — `?workspace_id` list forecast runs → `Forecast[]`
- `GET /:id` — public — forecast detail → `Forecast`
- `POST /run` — auth — compute phased burn for `{ workspace_id, plan_id, fiscal_year, scenario }` → `Forecast` 201
- `DELETE /:id` — auth — delete → `{ success }`

### 15. `velocity.ts` → mount `velocity`
- `GET /` — public — `?workspace_id` list velocity metrics → `Velocity[]`
- `GET /bottlenecks` — public — `?workspace_id` bottleneck attribution rollup → `{ byTeam[], byRecruiter[], byStage[] }`
- `POST /compute` — auth — recompute time-to-fill metrics → `Velocity[]` 201

### 16. `variance-packs.ts` → mount `variance-packs`
- `GET /` — public — `?workspace_id` list packs → `Pack[]`
- `GET /:id` — public — pack + lines (bridge) → `Pack & { lines }`
- `POST /generate` — auth — build bridge for `{ workspace_id, fiscal_year, period_label }` → `Pack & { lines }` 201
- `POST /:id/sign` — auth — record people/finance sign-off `{ role }` → `Pack`
- `DELETE /:id` — auth — delete → `{ success }`

### 17. `scenarios.ts` → mount `scenarios`
- `GET /` — public — `?workspace_id` list scenarios → `Scenario[]`
- `GET /:id` — public — scenario + overrides + computed diff vs base → `Scenario & { overrides, diff }`
- `POST /` — auth — create scenario → `Scenario` 201
- `POST /:id/overrides` — auth — set override `{ plan_line_id, ... }` → `Override` 201
- `POST /:id/freeze` — auth — toggle is_frozen → `Scenario`
- `DELETE /:id` — auth — delete → `{ success }`

### 18. `thresholds.ts` → mount `thresholds`
- `GET /` — public — `?workspace_id` list thresholds → `Threshold[]`
- `POST /` — auth — create → `Threshold` 201
- `PUT /:id` — auth — update (value/active) → `Threshold`
- `POST /evaluate` — auth — evaluate active thresholds vs latest recon/forecast, create alerts → `Alert[]` 201
- `DELETE /:id` — auth — delete → `{ success }`

### 19. `alerts.ts` → mount `alerts`
- `GET /` — public — `?workspace_id` list alerts → `Alert[]`
- `POST /:id/ack` — auth — acknowledge (acknowledged_at) → `Alert`
- `POST /:id/resolve` — auth — set status resolved → `Alert`
- `DELETE /:id` — auth — delete → `{ success }`

### 20. `exceptions.ts` → mount `exceptions`
- `GET /` — public — `?workspace_id` list exception requests → `Exception[]`
- `POST /` — auth — request exception → `Exception` 201
- `POST /:id/decide` — auth — approve/deny `{ status, decision_note }` + approver/decided_at → `Exception`
- `DELETE /:id` — auth — delete → `{ success }`

### 21. `notifications.ts` → mount `notifications`
- `GET /` — auth — `?workspace_id?` list caller's notifications → `Notification[]`
- `POST /:id/read` — auth — mark read → `Notification`
- `POST /read-all` — auth — mark all read → `{ success, count }`

### 22. `activity.ts` → mount `activity`
- `GET /` — public — `?workspace_id` paginated activity feed → `Activity[]`
- `POST /` — auth — record activity entry → `Activity` 201

### 23. `snapshots.ts` → mount `snapshots`
- `GET /` — public — `?workspace_id` list snapshots → `Snapshot[]`
- `GET /:id` — public — snapshot payload → `Snapshot`
- `POST /` — auth — create period-close snapshot (captures plan/reqs/hires/recon) → `Snapshot` 201
- `GET /compare` — public — `?a&b` diff two snapshots → `{ a, b, diff }`

### 24. `imports.ts` → mount `imports`
- `GET /` — public — `?workspace_id` list import jobs → `Import[]`
- `POST /dry-run` — auth — validate payload `{ entity_type, rows }`, return errors, no commit → `Import`
- `POST /commit` — auth — commit a validated import → `Import & { inserted }` 201

### 25. `seed.ts` → mount `seed`
- `POST /sample` — auth — populate a realistic sample company for caller `{ workspace_id? }` (teams, periods, plan+lines, reqs, hires, terms, budget) → `{ workspace_id, counts }` 201
- `POST /reset` — auth — clear caller's workspace data → `{ success }`

### 26. `reports.ts` → mount `reports`
- `GET /dashboard` — public — `?workspace_id` exec KPIs (net headcount vs plan, burn vs budget, open ghost reqs, top variances) → `{ kpis, topVariances[], trend[] }`
- `GET /team/:teamId` — public — `?workspace_id` per-team reconciliation report → `{ team, cells, cost }`
- `GET /trend` — public — `?workspace_id` headcount/burn trend over periods → `{ periods[] }`

### 27. `billing.ts` → mount `billing`
- `GET /plan` — public — caller subscription + plan + stripeEnabled (auto-creates free sub) → `{ subscription, plan, stripeEnabled }`
- `POST /checkout` — auth — Stripe checkout or 503 → `{ url }`|503
- `POST /portal` — auth — Stripe portal or 503 → `{ url }`|503
- `POST /webhook` — public — Stripe webhook or 503 → `{ received }`|503

---

## (c) `web/lib/api.ts` methods

All `fetch('/api/proxy/<path>')`; mutations send `Content-Type: application/json` + `JSON.stringify`. Export `default`.

| Method | Path (`/api/proxy/...`) | Verb |
|--------|--------------------------|------|
| listWorkspaces | workspaces | GET |
| getWorkspace | workspaces/:id | GET |
| createWorkspace | workspaces | POST |
| updateWorkspace | workspaces/:id | PUT |
| deleteWorkspace | workspaces/:id | DELETE |
| listMembers | members?workspace_id | GET |
| addMember | members | POST |
| updateMember | members/:id | PUT |
| removeMember | members/:id | DELETE |
| listTeams | teams?workspace_id | GET |
| getTeam | teams/:id | GET |
| createTeam | teams | POST |
| updateTeam | teams/:id | PUT |
| deleteTeam | teams/:id | DELETE |
| listPeriods | periods?workspace_id | GET |
| createPeriod | periods | POST |
| generatePeriods | periods/generate | POST |
| deletePeriod | periods/:id | DELETE |
| listPlans | plans?workspace_id | GET |
| getPlan | plans/:id | GET |
| createPlan | plans | POST |
| updatePlan | plans/:id | PUT |
| approvePlan | plans/:id/approve | POST |
| clonePlan | plans/:id/clone | POST |
| deletePlan | plans/:id | DELETE |
| listPlanLines | plan-lines?plan_id | GET |
| getPlanLine | plan-lines/:id | GET |
| createPlanLine | plan-lines | POST |
| bulkPlanLines | plan-lines/bulk | POST |
| updatePlanLine | plan-lines/:id | PUT |
| annotatePlanLine | plan-lines/:id/annotate | POST |
| deletePlanLine | plan-lines/:id | DELETE |
| listReqs | requisitions?workspace_id | GET |
| getReq | requisitions/:id | GET |
| createReq | requisitions | POST |
| updateReq | requisitions/:id | PUT |
| setReqStatus | requisitions/:id/status | POST |
| linkReqPlan | requisitions/:id/link-plan | POST |
| bulkReqs | requisitions/bulk | POST |
| deleteReq | requisitions/:id | DELETE |
| listFilled | filled-positions?workspace_id | GET |
| getFilled | filled-positions/:id | GET |
| createFilled | filled-positions | POST |
| updateFilled | filled-positions/:id | PUT |
| bulkFilled | filled-positions/bulk | POST |
| deleteFilled | filled-positions/:id | DELETE |
| listTerminations | terminations?workspace_id | GET |
| createTermination | terminations | POST |
| bulkTerminations | terminations/bulk | POST |
| deleteTermination | terminations/:id | DELETE |
| listBudget | budget?workspace_id | GET |
| getBudgetSummary | budget/summary?workspace_id | GET |
| upsertBudget | budget | POST |
| reviseBudget | budget/:id/revise | POST |
| deleteBudget | budget/:id | DELETE |
| listReconciliations | reconciliation?workspace_id | GET |
| getReconciliation | reconciliation/:id | GET |
| runReconciliation | reconciliation/run | POST |
| getReconciliationCells | reconciliation/:id/cells | GET |
| snapshotReconciliation | reconciliation/:id/snapshot | POST |
| deleteReconciliation | reconciliation/:id | DELETE |
| listGhostReqs | ghost-reqs?workspace_id | GET |
| scanGhostReqs | ghost-reqs/scan | POST |
| resolveGhostReq | ghost-reqs/:id/resolve | POST |
| deleteGhostReq | ghost-reqs/:id | DELETE |
| listBackfills | backfills?workspace_id | GET |
| getNetHeadcount | backfills/net-headcount?workspace_id | GET |
| suggestBackfills | backfills/suggest | POST |
| confirmBackfill | backfills/:id/confirm | POST |
| updateBackfill | backfills/:id | PUT |
| deleteBackfill | backfills/:id | DELETE |
| listBurnForecasts | burn-forecast?workspace_id | GET |
| getBurnForecast | burn-forecast/:id | GET |
| runBurnForecast | burn-forecast/run | POST |
| deleteBurnForecast | burn-forecast/:id | DELETE |
| listVelocity | velocity?workspace_id | GET |
| getBottlenecks | velocity/bottlenecks?workspace_id | GET |
| computeVelocity | velocity/compute | POST |
| listVariancePacks | variance-packs?workspace_id | GET |
| getVariancePack | variance-packs/:id | GET |
| generateVariancePack | variance-packs/generate | POST |
| signVariancePack | variance-packs/:id/sign | POST |
| deleteVariancePack | variance-packs/:id | DELETE |
| listScenarios | scenarios?workspace_id | GET |
| getScenario | scenarios/:id | GET |
| createScenario | scenarios | POST |
| setScenarioOverride | scenarios/:id/overrides | POST |
| freezeScenario | scenarios/:id/freeze | POST |
| deleteScenario | scenarios/:id | DELETE |
| listThresholds | thresholds?workspace_id | GET |
| createThreshold | thresholds | POST |
| updateThreshold | thresholds/:id | PUT |
| evaluateThresholds | thresholds/evaluate | POST |
| deleteThreshold | thresholds/:id | DELETE |
| listAlerts | alerts?workspace_id | GET |
| ackAlert | alerts/:id/ack | POST |
| resolveAlert | alerts/:id/resolve | POST |
| deleteAlert | alerts/:id | DELETE |
| listExceptions | exceptions?workspace_id | GET |
| createException | exceptions | POST |
| decideException | exceptions/:id/decide | POST |
| deleteException | exceptions/:id | DELETE |
| listNotifications | notifications | GET |
| markNotificationRead | notifications/:id/read | POST |
| markAllNotificationsRead | notifications/read-all | POST |
| listActivity | activity?workspace_id | GET |
| recordActivity | activity | POST |
| listSnapshots | snapshots?workspace_id | GET |
| getSnapshot | snapshots/:id | GET |
| createSnapshot | snapshots | POST |
| compareSnapshots | snapshots/compare?a&b | GET |
| listImports | imports?workspace_id | GET |
| dryRunImport | imports/dry-run | POST |
| commitImport | imports/commit | POST |
| seedSample | seed/sample | POST |
| resetWorkspace | seed/reset | POST |
| getDashboardReport | reports/dashboard?workspace_id | GET |
| getTeamReport | reports/team/:teamId?workspace_id | GET |
| getTrendReport | reports/trend?workspace_id | GET |
| getBillingPlan | billing/plan | GET |
| startCheckout | billing/checkout | POST |
| openBillingPortal | billing/portal | POST |

Every api method above is implemented by exactly one route endpoint in section (b) and consumed by at least one page in section (d).

---

## (d) Pages

Public pages (static or auth-form; no DashboardLayout):

| URL | File (`web/`) | Kind | Uses | Renders |
|-----|---------------|------|------|---------|
| `/` | `app/page.tsx` | public | (none — static) | Landing: hero, three-way match explainer, feature grid, CTAs |
| `/auth/sign-in` | `app/auth/sign-in/page.tsx` | public | (authClient) | Email/password sign-in |
| `/auth/sign-up` | `app/auth/sign-up/page.tsx` | public | (authClient) | Email/password sign-up |
| `/pricing` | `app/pricing/page.tsx` | public | getBillingPlan | Free plan card, optional pro (503-aware) |

Dashboard pages (wrapped by `app/dashboard/layout.tsx` → `DashboardLayout`; client-guarded):

| URL | File (`web/`) | Kind | Uses | Renders |
|-----|---------------|------|------|---------|
| `/dashboard` | `app/dashboard/page.tsx` | dashboard | getDashboardReport, listWorkspaces, getNetHeadcount, listGhostReqs, seedSample | Exec KPIs, net headcount vs plan, burn vs budget, ghost-req count, top variances, "seed sample" CTA |
| `/dashboard/workspaces` | `app/dashboard/workspaces/page.tsx` | dashboard | listWorkspaces, createWorkspace, updateWorkspace, deleteWorkspace, listMembers, addMember, updateMember, removeMember | Workspace list/create/settings + member management |
| `/dashboard/teams` | `app/dashboard/teams/page.tsx` | dashboard | listTeams, createTeam, updateTeam, deleteTeam | Org tree of teams, cost centers, owners |
| `/dashboard/periods` | `app/dashboard/periods/page.tsx` | dashboard | listPeriods, createPeriod, generatePeriods, deletePeriod | Fiscal periods grid, generate-quarters |
| `/dashboard/plan` | `app/dashboard/plan/page.tsx` | dashboard | listPlans, createPlan, updatePlan, approvePlan, clonePlan, deletePlan | Plan list, versions, approval workflow |
| `/dashboard/plan/[id]` | `app/dashboard/plan/[id]/page.tsx` | dashboard | getPlan, listPlanLines, createPlanLine, bulkPlanLines, updatePlanLine, annotatePlanLine, deletePlanLine, listTeams | Plan-line editor by team/level/quarter, budgeted cost |
| `/dashboard/requisitions` | `app/dashboard/requisitions/page.tsx` | dashboard | listReqs, getReq, createReq, updateReq, setReqStatus, linkReqPlan, bulkReqs, deleteReq, listTeams, listPlanLines | Req table, status timeline, link-to-plan, bulk import |
| `/dashboard/filled` | `app/dashboard/filled/page.tsx` | dashboard | listFilled, createFilled, updateFilled, bulkFilled, deleteFilled, listReqs, listTeams | Hires ledger, link to req/plan |
| `/dashboard/terminations` | `app/dashboard/terminations/page.tsx` | dashboard | listTerminations, createTermination, bulkTerminations, deleteTermination, listTeams | Departures ledger |
| `/dashboard/budget` | `app/dashboard/budget/page.tsx` | dashboard | listBudget, getBudgetSummary, upsertBudget, reviseBudget, deleteBudget, listTeams | Comp budget baseline, budget vs plan vs actual, revisions |
| `/dashboard/reconciliation` | `app/dashboard/reconciliation/page.tsx` | dashboard | listReconciliations, getReconciliation, runReconciliation, getReconciliationCells, snapshotReconciliation, deleteReconciliation, listPlans | Three-way match grid (plan/open/filled), over/under flags, drill-down |
| `/dashboard/ghost-reqs` | `app/dashboard/ghost-reqs/page.tsx` | dashboard | listGhostReqs, scanGhostReqs, resolveGhostReq, deleteGhostReq | Ghost-req triage queue, scan, resolve |
| `/dashboard/backfills` | `app/dashboard/backfills/page.tsx` | dashboard | listBackfills, getNetHeadcount, suggestBackfills, confirmBackfill, updateBackfill, deleteBackfill | Backfill-vs-growth classifier, net headcount |
| `/dashboard/burn-forecast` | `app/dashboard/burn-forecast/page.tsx` | dashboard | listBurnForecasts, getBurnForecast, runBurnForecast, deleteBurnForecast, listPlans | Phased burn-to-year-end chart, scenarios, variance vs budget |
| `/dashboard/velocity` | `app/dashboard/velocity/page.tsx` | dashboard | listVelocity, getBottlenecks, computeVelocity | Time-to-fill, bottleneck attribution |
| `/dashboard/variance-packs` | `app/dashboard/variance-packs/page.tsx` | dashboard | listVariancePacks, generateVariancePack, deleteVariancePack | Variance pack list, generate |
| `/dashboard/variance-packs/[id]` | `app/dashboard/variance-packs/[id]/page.tsx` | dashboard | getVariancePack, signVariancePack | Bridge/waterfall table, dual sign-off |
| `/dashboard/scenarios` | `app/dashboard/scenarios/page.tsx` | dashboard | listScenarios, getScenario, createScenario, setScenarioOverride, freezeScenario, deleteScenario, listPlanLines | Scenario list + what-if overrides + diff |
| `/dashboard/alerts` | `app/dashboard/alerts/page.tsx` | dashboard | listThresholds, createThreshold, updateThreshold, evaluateThresholds, deleteThreshold, listAlerts, ackAlert, resolveAlert, deleteAlert | Thresholds config + generated alerts queue |
| `/dashboard/exceptions` | `app/dashboard/exceptions/page.tsx` | dashboard | listExceptions, createException, decideException, deleteException, listReqs | Out-of-plan exception requests + approvals |
| `/dashboard/notifications` | `app/dashboard/notifications/page.tsx` | dashboard | listNotifications, markNotificationRead, markAllNotificationsRead | Notification inbox |
| `/dashboard/activity` | `app/dashboard/activity/page.tsx` | dashboard | listActivity | Workspace activity feed |
| `/dashboard/snapshots` | `app/dashboard/snapshots/page.tsx` | dashboard | listSnapshots, getSnapshot, createSnapshot, compareSnapshots | Period-close snapshots + compare |
| `/dashboard/imports` | `app/dashboard/imports/page.tsx` | dashboard | listImports, dryRunImport, commitImport, seedSample, resetWorkspace | CSV import dry-run/commit, sample seeder, reset |
| `/dashboard/reports` | `app/dashboard/reports/page.tsx` | dashboard | getDashboardReport, getTeamReport, getTrendReport, listTeams | Per-team reconciliation, trend reports |
| `/dashboard/settings` | `app/dashboard/settings/page.tsx` | dashboard | getWorkspace, updateWorkspace, getBillingPlan, startCheckout, openBillingPortal, recordActivity | Workspace settings, billing |

Plus 2 route handlers: `app/api/auth/[...path]/route.ts`, `app/api/proxy/[...path]/route.ts`.

Total: 4 public + 26 dashboard = 30 page.tsx files (28 distinct dashboard routes incl. 2 dynamic).

---

## (e) DashboardLayout sidebar nav

`web/components/DashboardLayout.tsx` — `'use client'`, `<aside>` sidebar, active state via `usePathname()`, mobile drawer. Grouped sections:

- **Overview**
  - Dashboard → `/dashboard`
  - Reports → `/dashboard/reports`
- **Plan**
  - Headcount Plans → `/dashboard/plan`
  - Scenarios → `/dashboard/scenarios`
  - Budget Baseline → `/dashboard/budget`
- **Pipeline**
  - Requisitions → `/dashboard/requisitions`
  - Filled Positions → `/dashboard/filled`
  - Terminations → `/dashboard/terminations`
- **Reconcile**
  - Three-Way Reconciliation → `/dashboard/reconciliation`
  - Ghost Reqs → `/dashboard/ghost-reqs`
  - Backfill Classifier → `/dashboard/backfills`
  - Variance Packs → `/dashboard/variance-packs`
- **Forecast & Velocity**
  - Burn Forecast → `/dashboard/burn-forecast`
  - Hiring Velocity → `/dashboard/velocity`
- **Governance**
  - Alerts & Thresholds → `/dashboard/alerts`
  - Exceptions → `/dashboard/exceptions`
  - Snapshots → `/dashboard/snapshots`
  - Activity → `/dashboard/activity`
- **Setup**
  - Workspaces → `/dashboard/workspaces`
  - Teams → `/dashboard/teams`
  - Fiscal Periods → `/dashboard/periods`
  - Imports & Seed → `/dashboard/imports`
  - Notifications → `/dashboard/notifications`
  - Settings → `/dashboard/settings`

Billing seed: `plans` table seeded with `('free','Free',0)` and `('pro','Pro',9900)`; new users auto-get a free subscription on first `billing/plan` call.
