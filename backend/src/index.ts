import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { db } from './db/index.js'
import { migrate } from './db/migrate.js'
import {
  plans,
  workspaces,
  workspace_members,
  teams,
} from './db/schema.js'
import { eq } from 'drizzle-orm'

import workspacesRoutes from './routes/workspaces.js'
import membersRoutes from './routes/members.js'
import teamsRoutes from './routes/teams.js'
import periodsRoutes from './routes/periods.js'
import plansRoutes from './routes/plans.js'
import planLinesRoutes from './routes/plan-lines.js'
import requisitionsRoutes from './routes/requisitions.js'
import filledPositionsRoutes from './routes/filled-positions.js'
import terminationsRoutes from './routes/terminations.js'
import budgetRoutes from './routes/budget.js'
import reconciliationRoutes from './routes/reconciliation.js'
import ghostReqsRoutes from './routes/ghost-reqs.js'
import backfillsRoutes from './routes/backfills.js'
import burnForecastRoutes from './routes/burn-forecast.js'
import velocityRoutes from './routes/velocity.js'
import variancePacksRoutes from './routes/variance-packs.js'
import scenariosRoutes from './routes/scenarios.js'
import thresholdsRoutes from './routes/thresholds.js'
import alertsRoutes from './routes/alerts.js'
import exceptionsRoutes from './routes/exceptions.js'
import notificationsRoutes from './routes/notifications.js'
import activityRoutes from './routes/activity.js'
import snapshotsRoutes from './routes/snapshots.js'
import importsRoutes from './routes/imports.js'
import seedRoutes from './routes/seed.js'
import reportsRoutes from './routes/reports.js'
import billingRoutes from './routes/billing.js'

const app = new Hono()

const allowedOrigins = [
  process.env.FRONTEND_URL ?? 'http://localhost:3000',
  'https://headcount-plan-reconciler.vercel.app',
]

app.use(
  '*',
  cors({
    origin: (origin) => (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
    credentials: true,
  }),
)

const api = new Hono()
api.route('/workspaces', workspacesRoutes)
api.route('/members', membersRoutes)
api.route('/teams', teamsRoutes)
api.route('/periods', periodsRoutes)
api.route('/plans', plansRoutes)
api.route('/plan-lines', planLinesRoutes)
api.route('/requisitions', requisitionsRoutes)
api.route('/filled-positions', filledPositionsRoutes)
api.route('/terminations', terminationsRoutes)
api.route('/budget', budgetRoutes)
api.route('/reconciliation', reconciliationRoutes)
api.route('/ghost-reqs', ghostReqsRoutes)
api.route('/backfills', backfillsRoutes)
api.route('/burn-forecast', burnForecastRoutes)
api.route('/velocity', velocityRoutes)
api.route('/variance-packs', variancePacksRoutes)
api.route('/scenarios', scenariosRoutes)
api.route('/thresholds', thresholdsRoutes)
api.route('/alerts', alertsRoutes)
api.route('/exceptions', exceptionsRoutes)
api.route('/notifications', notificationsRoutes)
api.route('/activity', activityRoutes)
api.route('/snapshots', snapshotsRoutes)
api.route('/imports', importsRoutes)
api.route('/seed', seedRoutes)
api.route('/reports', reportsRoutes)
api.route('/billing', billingRoutes)

app.route('/api/v1', api)
app.get('/health', (c) => c.json({ ok: true }))

// ----------------------------------------------------------------------------
// seedIfEmpty — idempotent (count-then-insert). Seeds billing plans
// ('free'/'pro') and a small demo workspace so a fresh deploy has data.
// ----------------------------------------------------------------------------
async function seedIfEmpty() {
  // Billing plans
  const existingPlans = await db.select().from(plans).limit(1)
  if (existingPlans.length === 0) {
    await db.insert(plans).values([
      { id: 'free', name: 'Free', price_cents: 0 },
      { id: 'pro', name: 'Pro', price_cents: 9900 },
    ])
    console.log('Seeded billing plans')
  }

  // Demo workspace + members + teams
  const DEMO_WORKSPACE_ID = 'demo-workspace'
  const DEMO_OWNER_ID = 'demo-user'
  const existingDemo = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, DEMO_WORKSPACE_ID))
    .limit(1)
  if (existingDemo.length === 0) {
    await db.insert(workspaces).values({
      id: DEMO_WORKSPACE_ID,
      name: 'Demo Company',
      owner_id: DEMO_OWNER_ID,
      fiscal_year_start_month: 1,
      currency: 'USD',
      default_burden_rate: 0.25,
      planning_granularity: 'team_level_quarter',
    })
    await db.insert(workspace_members).values({
      workspace_id: DEMO_WORKSPACE_ID,
      user_id: DEMO_OWNER_ID,
      role: 'owner',
    })
    await db.insert(teams).values([
      { workspace_id: DEMO_WORKSPACE_ID, name: 'Engineering', cost_center: 'CC-100', owner_user_id: DEMO_OWNER_ID },
      { workspace_id: DEMO_WORKSPACE_ID, name: 'Sales', cost_center: 'CC-200', owner_user_id: DEMO_OWNER_ID },
      { workspace_id: DEMO_WORKSPACE_ID, name: 'Marketing', cost_center: 'CC-300', owner_user_id: DEMO_OWNER_ID },
    ])
    console.log('Seeded demo workspace')
  }
}

// ----------------------------------------------------------------------------
// CRITICAL boot order: bind the port FIRST so the platform health check sees a
// live service immediately, THEN run migrate() and seedIfEmpty() (both
// idempotent), each wrapped in its own try/catch. NEVER await migrate() or
// seedIfEmpty() before serve() — a slow/cold DB would block the port binding
// and cause a Render deploy timeout.
// ----------------------------------------------------------------------------
const port = parseInt(process.env.PORT ?? '3001')
serve({ fetch: app.fetch, port }, () => console.log(`Server running on port ${port}`))

void (async () => {
  try {
    await migrate()
  } catch (e) {
    console.error('Migrate error:', e)
  }
  try {
    await seedIfEmpty()
  } catch (e) {
    console.error('Seed error:', e)
  }
})()

export default app
