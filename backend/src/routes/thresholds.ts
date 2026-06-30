import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  thresholds,
  alerts,
  reconciliations,
  burn_forecasts,
  ghost_reqs,
  workspace_members,
} from '../db/schema.js'
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

const COMPARATORS = ['gt', 'gte', 'lt', 'lte', 'eq'] as const
type Comparator = (typeof COMPARATORS)[number]

// Supported metrics evaluated against the latest reconciliation / forecast.
const METRICS = ['cost_variance', 'count_variance', 'forecast_variance', 'open_ghost_reqs'] as const

function compare(value: number, comparator: Comparator, target: number): boolean {
  switch (comparator) {
    case 'gt':
      return value > target
    case 'gte':
      return value >= target
    case 'lt':
      return value < target
    case 'lte':
      return value <= target
    case 'eq':
      return value === target
  }
}

// ── GET / — public — list thresholds for a workspace ─────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(thresholds)
    .where(eq(thresholds.workspace_id, workspaceId))
    .orderBy(desc(thresholds.created_at))
  return c.json(rows)
})

// ── POST / — auth — create threshold ─────────────────────────────────────────
const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  metric: z.enum(METRICS),
  comparator: z.enum(COMPARATORS).optional().default('gt'),
  value: z.number(),
  team_id: z.string().min(1).optional(),
  is_active: z.boolean().optional().default(true),
})

router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [t] = await db
    .insert(thresholds)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      metric: body.metric,
      comparator: body.comparator ?? 'gt',
      value: body.value,
      team_id: body.team_id ?? null,
      is_active: body.is_active ?? true,
      created_by: userId,
    })
    .returning()
  return c.json(t, 201)
})

// ── PUT /:id — auth — update value / active / comparator ─────────────────────
const updateSchema = z.object({
  name: z.string().min(1).optional(),
  metric: z.enum(METRICS).optional(),
  comparator: z.enum(COMPARATORS).optional(),
  value: z.number().optional(),
  team_id: z.string().min(1).nullable().optional(),
  is_active: z.boolean().optional(),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(thresholds).where(eq(thresholds.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db.update(thresholds).set(body).where(eq(thresholds.id, id)).returning()
  return c.json(updated)
})

// ── POST /evaluate — auth — evaluate active thresholds, create alerts ────────
const evaluateSchema = z.object({
  workspace_id: z.string().min(1),
})

router.post('/evaluate', authMiddleware, zValidator('json', evaluateSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const active = await db
    .select()
    .from(thresholds)
    .where(and(eq(thresholds.workspace_id, workspace_id), eq(thresholds.is_active, true)))

  // Latest reconciliation run for the workspace.
  const [latestRecon] = await db
    .select()
    .from(reconciliations)
    .where(eq(reconciliations.workspace_id, workspace_id))
    .orderBy(desc(reconciliations.created_at))
    .limit(1)

  // Latest burn forecast for the workspace.
  const [latestForecast] = await db
    .select()
    .from(burn_forecasts)
    .where(eq(burn_forecasts.workspace_id, workspace_id))
    .orderBy(desc(burn_forecasts.created_at))
    .limit(1)

  // Count of open ghost reqs.
  const openGhosts = await db
    .select()
    .from(ghost_reqs)
    .where(and(eq(ghost_reqs.workspace_id, workspace_id), eq(ghost_reqs.status, 'open')))
  const openGhostCount = openGhosts.length

  function metricValue(metric: string): number | null {
    switch (metric) {
      case 'cost_variance':
        return latestRecon ? latestRecon.cost_variance : null
      case 'count_variance':
        return latestRecon
          ? latestRecon.total_planned - (latestRecon.total_open + latestRecon.total_filled)
          : null
      case 'forecast_variance':
        return latestForecast ? latestForecast.variance : null
      case 'open_ghost_reqs':
        return openGhostCount
      default:
        return null
    }
  }

  const created: Array<typeof alerts.$inferSelect> = []
  for (const t of active) {
    const value = metricValue(t.metric)
    if (value === null) continue
    if (!compare(value, t.comparator as Comparator, t.value)) continue

    const breachAmount = value - t.value
    const severity = Math.abs(breachAmount) >= Math.abs(t.value) ? 'high' : 'medium'
    const [alert] = await db
      .insert(alerts)
      .values({
        workspace_id,
        threshold_id: t.id,
        title: `${t.name} breached`,
        detail: `${t.metric} = ${value} ${t.comparator} ${t.value} (breach ${breachAmount})`,
        severity,
        status: 'open',
      })
      .returning()
    created.push(alert)
  }

  return c.json(created, 201)
})

// ── DELETE /:id — auth ───────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(thresholds).where(eq(thresholds.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  // Detach any alerts that reference this threshold to keep FK integrity.
  await db.update(alerts).set({ threshold_id: null }).where(eq(alerts.threshold_id, id))
  await db.delete(thresholds).where(eq(thresholds.id, id))
  return c.json({ success: true })
})

export default router
