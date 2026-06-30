// HeadcountPlanReconciler — frontend API client.
// Every method maps 1:1 to a backend endpoint via the same-origin proxy:
//   fetch('/api/proxy/<path>')  ->  /api/v1/<path>  (proxy injects X-User-Id)

async function http(path: string, init?: RequestInit) {
  const res = await fetch(`/api/proxy/${path}`, init)
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`
    throw new Error(msg)
  }
  return data
}

function get(path: string) {
  return http(path)
}
function send(path: string, method: string, body?: unknown) {
  return http(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}
const post = (path: string, body?: unknown) => send(path, 'POST', body)
const put = (path: string, body?: unknown) => send(path, 'PUT', body)
const del = (path: string) => send(path, 'DELETE')

function qs(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

const api = {
  // Workspaces
  listWorkspaces: () => get('workspaces'),
  getWorkspace: (id: string) => get(`workspaces/${id}`),
  createWorkspace: (data: unknown) => post('workspaces', data),
  updateWorkspace: (id: string, data: unknown) => put(`workspaces/${id}`, data),
  deleteWorkspace: (id: string) => del(`workspaces/${id}`),

  // Members
  listMembers: (workspaceId: string) => get(`members${qs({ workspace_id: workspaceId })}`),
  addMember: (data: unknown) => post('members', data),
  updateMember: (id: string, data: unknown) => put(`members/${id}`, data),
  removeMember: (id: string) => del(`members/${id}`),

  // Teams
  listTeams: (workspaceId: string) => get(`teams${qs({ workspace_id: workspaceId })}`),
  getTeam: (id: string) => get(`teams/${id}`),
  createTeam: (data: unknown) => post('teams', data),
  updateTeam: (id: string, data: unknown) => put(`teams/${id}`, data),
  deleteTeam: (id: string) => del(`teams/${id}`),

  // Fiscal periods
  listPeriods: (workspaceId: string) => get(`periods${qs({ workspace_id: workspaceId })}`),
  createPeriod: (data: unknown) => post('periods', data),
  generatePeriods: (data: unknown) => post('periods/generate', data),
  deletePeriod: (id: string) => del(`periods/${id}`),

  // Headcount plans
  listPlans: (workspaceId: string) => get(`plans${qs({ workspace_id: workspaceId })}`),
  getPlan: (id: string) => get(`plans/${id}`),
  createPlan: (data: unknown) => post('plans', data),
  updatePlan: (id: string, data: unknown) => put(`plans/${id}`, data),
  approvePlan: (id: string, data?: unknown) => post(`plans/${id}/approve`, data),
  clonePlan: (id: string, data?: unknown) => post(`plans/${id}/clone`, data),
  deletePlan: (id: string) => del(`plans/${id}`),

  // Plan lines
  listPlanLines: (params: { plan_id?: string; workspace_id?: string }) => get(`plan-lines${qs(params)}`),
  getPlanLine: (id: string) => get(`plan-lines/${id}`),
  createPlanLine: (data: unknown) => post('plan-lines', data),
  bulkPlanLines: (data: unknown) => post('plan-lines/bulk', data),
  updatePlanLine: (id: string, data: unknown) => put(`plan-lines/${id}`, data),
  annotatePlanLine: (id: string, data: unknown) => post(`plan-lines/${id}/annotate`, data),
  deletePlanLine: (id: string) => del(`plan-lines/${id}`),

  // Requisitions
  listReqs: (workspaceId: string, params: { status?: string; team_id?: string } = {}) =>
    get(`requisitions${qs({ workspace_id: workspaceId, ...params })}`),
  getReq: (id: string) => get(`requisitions/${id}`),
  createReq: (data: unknown) => post('requisitions', data),
  updateReq: (id: string, data: unknown) => put(`requisitions/${id}`, data),
  setReqStatus: (id: string, data: unknown) => post(`requisitions/${id}/status`, data),
  linkReqPlan: (id: string, data: unknown) => post(`requisitions/${id}/link-plan`, data),
  bulkReqs: (data: unknown) => post('requisitions/bulk', data),
  deleteReq: (id: string) => del(`requisitions/${id}`),

  // Filled positions
  listFilled: (workspaceId: string) => get(`filled-positions${qs({ workspace_id: workspaceId })}`),
  getFilled: (id: string) => get(`filled-positions/${id}`),
  createFilled: (data: unknown) => post('filled-positions', data),
  updateFilled: (id: string, data: unknown) => put(`filled-positions/${id}`, data),
  bulkFilled: (data: unknown) => post('filled-positions/bulk', data),
  deleteFilled: (id: string) => del(`filled-positions/${id}`),

  // Terminations
  listTerminations: (workspaceId: string) => get(`terminations${qs({ workspace_id: workspaceId })}`),
  createTermination: (data: unknown) => post('terminations', data),
  bulkTerminations: (data: unknown) => post('terminations/bulk', data),
  deleteTermination: (id: string) => del(`terminations/${id}`),

  // Budget baseline
  listBudget: (workspaceId: string) => get(`budget${qs({ workspace_id: workspaceId })}`),
  getBudgetSummary: (workspaceId: string, fiscalYear?: number | string) =>
    get(`budget/summary${qs({ workspace_id: workspaceId, fiscal_year: fiscalYear })}`),
  upsertBudget: (data: unknown) => post('budget', data),
  reviseBudget: (id: string, data: unknown) => post(`budget/${id}/revise`, data),
  deleteBudget: (id: string) => del(`budget/${id}`),

  // Reconciliation
  listReconciliations: (workspaceId: string) => get(`reconciliation${qs({ workspace_id: workspaceId })}`),
  getReconciliation: (id: string) => get(`reconciliation/${id}`),
  runReconciliation: (data: unknown) => post('reconciliation/run', data),
  getReconciliationCells: (id: string) => get(`reconciliation/${id}/cells`),
  snapshotReconciliation: (id: string, data?: unknown) => post(`reconciliation/${id}/snapshot`, data),
  deleteReconciliation: (id: string) => del(`reconciliation/${id}`),

  // Ghost reqs
  listGhostReqs: (workspaceId: string) => get(`ghost-reqs${qs({ workspace_id: workspaceId })}`),
  scanGhostReqs: (data: unknown) => post('ghost-reqs/scan', data),
  resolveGhostReq: (id: string, data: unknown) => post(`ghost-reqs/${id}/resolve`, data),
  deleteGhostReq: (id: string) => del(`ghost-reqs/${id}`),

  // Backfills
  listBackfills: (workspaceId: string) => get(`backfills${qs({ workspace_id: workspaceId })}`),
  getNetHeadcount: (workspaceId: string) => get(`backfills/net-headcount${qs({ workspace_id: workspaceId })}`),
  suggestBackfills: (data: unknown) => post('backfills/suggest', data),
  confirmBackfill: (id: string, data?: unknown) => post(`backfills/${id}/confirm`, data),
  updateBackfill: (id: string, data: unknown) => put(`backfills/${id}`, data),
  deleteBackfill: (id: string) => del(`backfills/${id}`),

  // Burn forecast
  listBurnForecasts: (workspaceId: string) => get(`burn-forecast${qs({ workspace_id: workspaceId })}`),
  getBurnForecast: (id: string) => get(`burn-forecast/${id}`),
  runBurnForecast: (data: unknown) => post('burn-forecast/run', data),
  deleteBurnForecast: (id: string) => del(`burn-forecast/${id}`),

  // Velocity
  listVelocity: (workspaceId: string) => get(`velocity${qs({ workspace_id: workspaceId })}`),
  getBottlenecks: (workspaceId: string) => get(`velocity/bottlenecks${qs({ workspace_id: workspaceId })}`),
  computeVelocity: (data: unknown) => post('velocity/compute', data),

  // Variance packs
  listVariancePacks: (workspaceId: string) => get(`variance-packs${qs({ workspace_id: workspaceId })}`),
  getVariancePack: (id: string) => get(`variance-packs/${id}`),
  generateVariancePack: (data: unknown) => post('variance-packs/generate', data),
  signVariancePack: (id: string, data: unknown) => post(`variance-packs/${id}/sign`, data),
  deleteVariancePack: (id: string) => del(`variance-packs/${id}`),

  // Scenarios
  listScenarios: (workspaceId: string) => get(`scenarios${qs({ workspace_id: workspaceId })}`),
  getScenario: (id: string) => get(`scenarios/${id}`),
  createScenario: (data: unknown) => post('scenarios', data),
  setScenarioOverride: (id: string, data: unknown) => post(`scenarios/${id}/overrides`, data),
  freezeScenario: (id: string, data?: unknown) => post(`scenarios/${id}/freeze`, data),
  deleteScenario: (id: string) => del(`scenarios/${id}`),

  // Thresholds
  listThresholds: (workspaceId: string) => get(`thresholds${qs({ workspace_id: workspaceId })}`),
  createThreshold: (data: unknown) => post('thresholds', data),
  updateThreshold: (id: string, data: unknown) => put(`thresholds/${id}`, data),
  evaluateThresholds: (data: unknown) => post('thresholds/evaluate', data),
  deleteThreshold: (id: string) => del(`thresholds/${id}`),

  // Alerts
  listAlerts: (workspaceId: string) => get(`alerts${qs({ workspace_id: workspaceId })}`),
  ackAlert: (id: string, data?: unknown) => post(`alerts/${id}/ack`, data),
  resolveAlert: (id: string, data?: unknown) => post(`alerts/${id}/resolve`, data),
  deleteAlert: (id: string) => del(`alerts/${id}`),

  // Exceptions
  listExceptions: (workspaceId: string) => get(`exceptions${qs({ workspace_id: workspaceId })}`),
  createException: (data: unknown) => post('exceptions', data),
  decideException: (id: string, data: unknown) => post(`exceptions/${id}/decide`, data),
  deleteException: (id: string) => del(`exceptions/${id}`),

  // Notifications
  listNotifications: () => get('notifications'),
  markNotificationRead: (id: string) => post(`notifications/${id}/read`),
  markAllNotificationsRead: () => post('notifications/read-all'),

  // Activity
  listActivity: (workspaceId: string) => get(`activity${qs({ workspace_id: workspaceId })}`),
  recordActivity: (data: unknown) => post('activity', data),

  // Snapshots
  listSnapshots: (workspaceId: string) => get(`snapshots${qs({ workspace_id: workspaceId })}`),
  getSnapshot: (id: string) => get(`snapshots/${id}`),
  createSnapshot: (data: unknown) => post('snapshots', data),
  compareSnapshots: (a: string, b: string) => get(`snapshots/compare${qs({ a, b })}`),

  // Imports & seed
  listImports: (workspaceId: string) => get(`imports${qs({ workspace_id: workspaceId })}`),
  dryRunImport: (data: unknown) => post('imports/dry-run', data),
  commitImport: (data: unknown) => post('imports/commit', data),
  seedSample: (data?: unknown) => post('seed/sample', data),
  resetWorkspace: (data?: unknown) => post('seed/reset', data),

  // Reports
  getDashboardReport: (workspaceId: string) => get(`reports/dashboard${qs({ workspace_id: workspaceId })}`),
  getTeamReport: (teamId: string, workspaceId: string) =>
    get(`reports/team/${teamId}${qs({ workspace_id: workspaceId })}`),
  getTrendReport: (workspaceId: string) => get(`reports/trend${qs({ workspace_id: workspaceId })}`),

  // Billing
  getBillingPlan: () => get('billing/plan'),
  startCheckout: (data?: unknown) => post('billing/checkout', data),
  openBillingPortal: (data?: unknown) => post('billing/portal', data),
}

export default api
