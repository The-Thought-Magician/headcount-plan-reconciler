import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { alerts, workspace_members } from '../db/schema.js'
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

// Public: list generated alerts for a workspace (optional status filter)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const status = c.req.query('status')
  const conditions = [eq(alerts.workspace_id, workspaceId)]
  if (status) conditions.push(eq(alerts.status, status))
  const rows = await db
    .select()
    .from(alerts)
    .where(and(...conditions))
    .orderBy(desc(alerts.created_at))
  return c.json(rows)
})

// Auth: acknowledge an alert
router.post('/:id/ack', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(alerts)
    .set({ status: existing.status === 'resolved' ? 'resolved' : 'acknowledged', acknowledged_at: new Date() })
    .where(eq(alerts.id, id))
    .returning()
  return c.json(updated)
})

// Auth: resolve an alert
router.post('/:id/resolve', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(alerts)
    .set({ status: 'resolved' })
    .where(eq(alerts.id, id))
    .returning()
  return c.json(updated)
})

// Auth: assign an alert (optional convenience write)
const assignSchema = z.object({ assigned_to: z.string().nullable().optional() })
router.put('/:id', authMiddleware, zValidator('json', assignSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(alerts)
    .set({ assigned_to: body.assigned_to ?? null })
    .where(eq(alerts.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete an alert
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(alerts).where(eq(alerts.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(alerts).where(eq(alerts.id, id))
  return c.json({ success: true })
})

export default router
