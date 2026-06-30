import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { ghost_reqs, workspace_members, requisitions } from '../db/schema.js'
import { eq, and } from 'drizzle-orm'
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

const scanSchema = z.object({
  workspace_id: z.string().min(1),
})

const resolveSchema = z.object({
  resolution: z.string().min(1),
  status: z.string().optional().default('resolved'),
})

const DAY_MS = 86_400_000

// ── GET / — public — list findings for a workspace ──────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const rows = await db
    .select()
    .from(ghost_reqs)
    .where(eq(ghost_reqs.workspace_id, workspaceId))
    .orderBy(ghost_reqs.created_at)
  return c.json(rows)
})

// ── POST /scan — auth — detect ghost reqs, upsert findings ──────────────────
router.post('/scan', authMiddleware, zValidator('json', scanSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const reqs = await db
    .select()
    .from(requisitions)
    .where(eq(requisitions.workspace_id, workspace_id))

  // Existing open findings, keyed by req_id so a re-scan refreshes rather than duplicates.
  const existing = await db
    .select()
    .from(ghost_reqs)
    .where(eq(ghost_reqs.workspace_id, workspace_id))
  const existingByReq = new Map<string, typeof existing[number]>()
  for (const g of existing) {
    if (g.status === 'open') existingByReq.set(g.req_id, g)
  }

  const now = Date.now()
  const closedStatuses = new Set(['filled', 'closed', 'cancelled', 'canceled'])
  const findings: Array<{ req_id: string; reason: string; severity: string; days_overdue: number }> = []

  for (const r of reqs) {
    if (closedStatuses.has(r.status)) continue

    // 1. No plan line — req exists but is not tied to any approved plan line.
    if (!r.plan_line_id) {
      findings.push({
        req_id: r.id,
        reason: 'no_plan',
        severity: 'high',
        days_overdue: 0,
      })
      continue
    }

    // 2. Past fill-by — open beyond its fill_by date.
    if (r.fill_by) {
      const fillByMs = new Date(r.fill_by as unknown as string | Date).getTime()
      if (!Number.isNaN(fillByMs) && fillByMs < now) {
        const daysOverdue = Math.floor((now - fillByMs) / DAY_MS)
        findings.push({
          req_id: r.id,
          reason: 'past_fill_by',
          severity: daysOverdue > 60 ? 'high' : daysOverdue > 30 ? 'medium' : 'low',
          days_overdue: daysOverdue,
        })
        continue
      }
    }

    // 3. Abandoned — open a long time (>90d since opened) with no fill_by set.
    const openedMs = new Date(r.opened_at as unknown as string | Date).getTime()
    if (!Number.isNaN(openedMs)) {
      const ageDays = Math.floor((now - openedMs) / DAY_MS)
      if (ageDays > 90) {
        findings.push({
          req_id: r.id,
          reason: 'abandoned',
          severity: ageDays > 180 ? 'high' : 'medium',
          days_overdue: ageDays,
        })
      }
    }
  }

  const results: typeof ghost_reqs.$inferSelect[] = []
  const seen = new Set<string>()
  for (const f of findings) {
    seen.add(f.req_id)
    const prior = existingByReq.get(f.req_id)
    if (prior) {
      const [updated] = await db
        .update(ghost_reqs)
        .set({ reason: f.reason, severity: f.severity, days_overdue: f.days_overdue })
        .where(eq(ghost_reqs.id, prior.id))
        .returning()
      results.push(updated)
    } else {
      const [created] = await db
        .insert(ghost_reqs)
        .values({
          workspace_id,
          req_id: f.req_id,
          reason: f.reason,
          severity: f.severity,
          days_overdue: f.days_overdue,
          status: 'open',
        })
        .returning()
      results.push(created)
    }
  }

  // Auto-resolve open findings whose req no longer trips any detector.
  for (const [reqId, prior] of existingByReq) {
    if (!seen.has(reqId)) {
      await db
        .update(ghost_reqs)
        .set({
          status: 'resolved',
          resolution: 'auto: req no longer flagged',
          resolved_by: userId,
          resolved_at: new Date(),
        })
        .where(eq(ghost_reqs.id, prior.id))
    }
  }

  return c.json(results, 201)
})

// ── POST /:id/resolve — auth ────────────────────────────────────────────────
router.post('/:id/resolve', authMiddleware, zValidator('json', resolveSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const body = c.req.valid('json')
  const [existing] = await db.select().from(ghost_reqs).where(eq(ghost_reqs.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(ghost_reqs)
    .set({
      resolution: body.resolution,
      status: body.status,
      resolved_by: userId,
      resolved_at: new Date(),
    })
    .where(eq(ghost_reqs.id, id))
    .returning()
  return c.json(updated)
})

// ── DELETE /:id — auth ──────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(ghost_reqs).where(eq(ghost_reqs.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(ghost_reqs).where(eq(ghost_reqs.id, id))
  return c.json({ success: true })
})

export default router
