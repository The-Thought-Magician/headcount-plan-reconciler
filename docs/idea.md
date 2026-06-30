# HeadcountPlanReconciler

> Reconcile your approved headcount plan against actual hires, backfills, and open reqs — catching overruns and ghost reqs before Finance does.

---

## Overview

HeadcountPlanReconciler is a HR-Finance reconciliation platform that performs a **three-way match** between the approved headcount plan, the open requisitions in the pipeline, and the actually-filled roles. Personnel cost is the single largest line item on most company P&Ls, and the approved plan drifts every quarter as managers open unbudgeted reqs, backfills get reclassified as growth, and reqs sit open long past their fill-by date. Today this reconciliation is a manual, error-prone monthly ritual in spreadsheets that misses six-figure overruns.

The platform ingests (uploads, connects, or generates) headcount plan lines, requisitions, filled positions, and the comp/budget baseline, then runs **deterministic analysis** to flag over/under-hires, ghost reqs, misclassified backfills, personnel-cost burn drift, and hiring-velocity bottlenecks. It produces a **Finance-ready monthly variance pack** that reconciles cleanly to the comp budget, so the Head of People Ops and the CFO can sign the same number.

Everything is **free for signed-in users**. Stripe billing is wired but optional (returns 503 when unconfigured). A built-in sample-data seeder makes the product fully demoable on first login.

---

## Problem

- **Personnel cost is the largest line item** and the approved plan drifts every quarter. Nobody owns the drift until Finance closes the books.
- **Reconciliation is a manual monthly ritual.** People Ops exports the plan from the planning tool, the recruiter exports open reqs from the ATS, Finance exports actuals from payroll/HRIS, and someone VLOOKUPs them together at 11pm before the monthly business review.
- **Unbudgeted hires slip through.** A manager opens a req that has no corresponding approved plan line; it gets filled; it shows up in payroll three months later as a surprise.
- **Ghost reqs accumulate.** Reqs stay open with no plan line and blow past their fill-by date, distorting velocity metrics and forecast.
- **Backfills get miscounted as growth** (or vice versa), so "net new headcount" — the number the board cares about — is wrong.
- **Burn forecasts ignore start-date phasing.** A role budgeted for the full year but starting in Q3 costs a quarter of the annual figure; naive forecasts overstate spend.
- **There is no defensible variance pack.** When the CFO asks "why are we $1.4M over plan on comp?", People Ops cannot produce a line-by-line reconciliation tying every dollar of variance to a specific req, hire, or plan line.

---

## Target Users

- **Head of People Operations / Workforce Planning** at a 200–5000 person company who co-owns the headcount budget with the CFO.
- **HR-Finance lead / Finance Business Partner for People** who runs the monthly plan-vs-actual reconciliation and owns the comp line of the budget.
- **Talent Acquisition leaders** who need to defend req volume against the approved plan and explain velocity bottlenecks.
- **FP&A analysts** who consume the variance pack and roll it into the company forecast.

Buyer: the Head of People Ops / Workforce Planning or the HR-Finance lead. Demand is calendar-driven (monthly close, quarterly re-plan, annual budget) over a large base of funded companies.

---

## Why This Is NOT an Existing Project

The nearest neighbors and why this is distinct:

- **project-budget-tracker / budget-vs-actual (general finance):** Those track arbitrary budget lines vs actual spend. HeadcountPlanReconciler is purpose-built for the **headcount domain**: it models reqs, levels, backfill-vs-growth, fill-by dates, start-date phasing, and a three-way (plan / open-req / filled) match that generic budget tools cannot express.
- **applicant-tracking-system (req workflow):** ATS owns the recruiting funnel (sourcing → interview → offer). It does **not** reconcile reqs against an approved finance plan or against payroll actuals, and has no concept of plan variance or comp-budget burn. We consume req data; we are not a recruiting workflow.
- **deferred-revenue-waterfall (rev rec):** A waterfall/phasing engine on the revenue side. We borrow the phasing idea (start-date phasing of personnel cost) but apply it to headcount cost on the expense side with a three-way reconciliation, which is a different data model and different outputs.
- **comp-band-equity-auditor (sibling):** Governs pay-band placement and pay equity. It answers "is this person paid fairly within band?" — not "did we hire to plan and what is the variance?".
- **manager-span-layer-optimizer (sibling):** Governs org structure (spans and layers). It answers "is this org shaped right?" — not "did we hire to the approved plan and what does it cost vs budget?".

HeadcountPlanReconciler is the **HR-Finance three-way headcount match**: plan ↔ open req ↔ filled, reconciled to the comp budget, with ghost-req detection, backfill classification, burn forecast, velocity attribution, and a Finance-ready variance pack. No sibling does plan-vs-actual headcount burn.

---

## Major Features

### 1. Workspace & Organization Setup
- Multi-workspace model (a workspace = one company's planning environment).
- Workspace settings: fiscal-year start month, currency, default employer-burden rate, planning granularity (team/level/quarter).
- Member roles within a workspace (owner, editor, viewer) tracked on the membership record.
- Org-tree of teams/departments with parent references for rollups.
- Fiscal calendar definition (periods, quarters) used by every report.

### 2. Headcount Plan Builder
- Create a versioned **headcount plan** per fiscal year.
- **Plan lines** keyed by team, level, quarter, with: count, budgeted base salary, budgeted variable, employer burden, planned start quarter, role title, hire type (growth/backfill), and a free-text justification.
- Bulk add lines, clone lines across quarters, clone a whole plan into a new version.
- Plan approval workflow: draft → submitted → approved, with approver and approved-at stamps.
- Plan-line annotations and justification history.
- Budgeted fully-loaded cost auto-computed (base + variable + burden).

### 3. Requisition Intake & Management
- **Requisitions** with team, level, title, target start, fill-by date, status (open/filled/closed/cancelled), recruiter, hiring manager, opened-at.
- Link a req to a plan line (or leave unlinked → ghost-req candidate).
- Req aging (days open) and SLA against fill-by.
- Req status timeline (state transitions with timestamps).
- Bulk import reqs (CSV-style payload) and manual entry.

### 4. Filled-Position / Actuals Ledger
- **Filled positions** (hires) with team, level, title, actual start date, actual base/variable, link to req, link to plan line, backfill-of (the person/role they replaced).
- Actual fully-loaded cost computation with start-date phasing.
- Terminations ledger (departures) feeding net-headcount math.
- Reconcile each hire to a req and a plan line; flag orphan hires (no req, no plan).

### 5. Three-Way Reconciliation Engine
- The core: for each (team, level, quarter) cell, compute **Planned count vs Open-req count vs Filled count**.
- Flag **over-hire** (filled + open > planned) and **under-hire** (filled < planned and no open reqs).
- Variance in count and in fully-loaded cost per cell.
- Drill-down from a cell to the underlying plan lines, reqs, and hires.
- Reconciliation status per cell: on-plan / over / under / at-risk.
- Snapshot the reconciliation at period close for an auditable record.

### 6. Ghost-Req Detector
- Detect reqs with **no linked plan line** (unapproved/unbudgeted).
- Detect reqs **open past their fill-by date** (stale).
- Detect reqs **open with no recruiter activity** (abandoned candidates).
- Severity scoring and a triage queue.
- Resolve a ghost req (link to plan, close, or approve-as-exception with note).

### 7. Backfill-vs-Growth Classifier
- Classify every hire/req as **backfill** (replaces a departure) or **growth** (true net new).
- Auto-suggest backfill links by matching terminations to opens in the same team/level within a window.
- True **net headcount expansion** = growth hires − terminations (excluding backfills).
- Misclassification flags (a "growth" req that actually matches a recent departure).
- Backfill confirmation workflow.

### 8. Personnel-Cost Burn Forecast
- Forecast personnel cost to fiscal year-end using **start-date phasing** (a role starting mid-year costs only the remaining periods).
- Combine actuals-to-date + scheduled starts + open-req expected starts + remaining-plan.
- Scenario phasing: optimistic / expected / conservative start-date assumptions.
- Burn-vs-budget chart by period with projected year-end landing.
- Employer-burden and variable-comp factored in.

### 9. Hiring-Velocity Tracker
- Time-to-fill per req (opened → filled), aggregated by team/level/recruiter.
- **Bottleneck attribution**: where reqs sit longest (stage-level aging).
- Velocity trend over periods.
- Forecast fill dates for open reqs from historical velocity.
- Capacity vs demand: open reqs per recruiter against historical throughput.

### 10. Finance-Ready Variance Pack
- A monthly **variance pack**: plan vs actual reconciled to the comp budget, line-by-line.
- Bridge/waterfall: starting budget → +growth → +backfill → +unbudgeted → −underspend → ending actual.
- Export-ready (structured JSON the frontend renders as printable tables).
- Sign-off workflow (People Ops signs, Finance counter-signs) with timestamps.
- Locked snapshot per period for audit.

### 11. Budget Baseline Management
- Import the **comp budget** baseline by team/period from Finance.
- Reconcile plan total against budget total (plan should not exceed budget).
- Budget vs plan vs actual three-line summary.
- Budget revisions log.

### 12. Scenario Planning & What-If
- Create **scenarios** that override start dates, counts, or salaries.
- Compare a scenario's burn and net-headcount against the base plan.
- Freeze/unfreeze a scenario as the new working plan.
- Scenario diff view.

### 13. Variance Alerts & Thresholds
- Configurable **thresholds** (e.g. alert when a team is >5% over plan cost, or net adds exceed plan by N).
- Generated **alerts** when a reconciliation run breaches a threshold.
- Alert severity, acknowledge/resolve, assignment.
- Alert digest per period.

### 14. Approvals & Exceptions
- **Exception requests** for hires/reqs outside plan (request → approve/deny with rationale).
- Approval chain (requester → approver).
- Exception register feeding the variance pack ("approved exceptions" bucket).

### 15. Departments & Cost Centers
- Cost-center mapping (team → GL cost center) for Finance rollup.
- Rollup reconciliation by cost center.
- Cost-center owner assignment.

### 16. Notifications & Activity Feed
- Per-user **notifications** (ghost req found, threshold breached, sign-off requested).
- Mark-read / mark-all-read.
- Workspace **activity log** (who changed what plan line / req / hire).

### 17. Reporting & Dashboards
- Executive dashboard: net headcount vs plan, burn vs budget, open ghost reqs, top variances.
- Per-team reconciliation report.
- Trend reports over periods.
- Saved report views.

### 18. Data Import / Connectors / Sample Seeder
- CSV-style bulk import for plan lines, reqs, hires, terminations, budget.
- Connector stubs (HRIS/ATS) returning structured payloads (deterministic; no external calls required).
- **Sample-data seeder**: one click populates a realistic company so the product is demoable immediately.
- Import validation and dry-run preview.

### 19. Audit & Snapshots
- Period-close **snapshots** of plan, reqs, hires, and reconciliation.
- Immutable audit records for sign-offs and approvals.
- Snapshot comparison (this close vs last close).

### 20. Settings, Profile & Billing
- Workspace settings (fiscal year, currency, burden rate, thresholds defaults).
- User profile.
- **Billing**: plan view (free), Stripe checkout/portal optional (503 when unconfigured).

### 21. Search & Global Lookup
- Cross-entity search (find a req, hire, plan line, team by keyword).
- Quick filters by team/level/quarter/status.

### 22. Onboarding & Demo Tour
- First-run checklist (create workspace → seed sample → run first reconciliation → review variance pack).
- Demo tour highlighting the three-way match.

---

## Data Model (Tables)

- `workspaces` — company planning environments.
- `workspace_members` — user ↔ workspace membership with role.
- `teams` — departments/teams within a workspace, with parent for org tree and cost-center.
- `fiscal_periods` — periods/quarters per workspace fiscal year.
- `plans` (domain: headcount_plans) — versioned headcount plans per workspace/FY. (Note: the billing `plans` table is separate; the headcount plan table is named `headcount_plans`.)
- `plan_lines` — budgeted lines by team/level/quarter.
- `requisitions` — open/filled/closed reqs.
- `req_events` — req status-transition timeline.
- `filled_positions` — hires/actuals.
- `terminations` — departures.
- `budget_baselines` — Finance comp budget by team/period.
- `reconciliations` — reconciliation runs (header).
- `reconciliation_cells` — per (team,level,period) three-way results.
- `ghost_reqs` — flagged ghost-req findings.
- `backfill_links` — backfill ↔ termination matches.
- `burn_forecasts` — forecast runs with phasing assumptions.
- `velocity_metrics` — computed time-to-fill / bottleneck records.
- `variance_packs` — monthly variance pack headers + sign-off.
- `variance_pack_lines` — bridge/line items.
- `scenarios` — what-if scenarios.
- `scenario_overrides` — per-line overrides in a scenario.
- `thresholds` — variance alert thresholds.
- `alerts` — generated alerts.
- `exceptions` — out-of-plan exception requests/approvals.
- `notifications` — per-user notifications.
- `activity_log` — workspace activity.
- `snapshots` — period-close snapshots.
- `imports` — import jobs (dry-run + committed).
- `plans` (billing) — Stripe plan catalog (free/pro).
- `subscriptions` — per-user subscription.

## API Surface (high level)

REST under `/api/v1`, public reads / auth-gated writes, ownership by workspace membership. Domains: workspaces, members, teams, periods, headcount-plans, plan-lines, requisitions, filled-positions, terminations, budget, reconciliation, ghost-reqs, backfills, burn-forecast, velocity, variance-packs, scenarios, thresholds, alerts, exceptions, notifications, activity, snapshots, imports, reports, billing, seed/sample-data.

## Frontend Pages (~24)

Public: landing, sign-in, sign-up, pricing.
Dashboard: dashboard home, workspaces, teams, fiscal periods, headcount plan + plan editor, requisitions, filled positions, terminations, budget baseline, reconciliation (three-way), ghost reqs, backfill classifier, burn forecast, velocity, variance packs, scenarios, thresholds/alerts, exceptions, notifications, activity, snapshots, imports, reports, settings.
