import { Hono } from 'hono'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { notifications } from '../db/schema.js'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// Whole router is auth-gated: notifications are per-user.
router.use('*', authMiddleware)

// List the caller's notifications (optionally scoped to a workspace).
router.get('/', async (c) => {
  const userId = getUserId(c)
  const workspaceId = c.req.query('workspace_id')
  const conditions = [eq(notifications.user_id, userId)]
  if (workspaceId) conditions.push(eq(notifications.workspace_id, workspaceId))
  const rows = await db
    .select()
    .from(notifications)
    .where(and(...conditions))
    .orderBy(desc(notifications.created_at))
  return c.json(rows)
})

// Mark a single notification read (must belong to the caller).
router.post('/:id/read', async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(notifications).where(eq(notifications.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.user_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(notifications)
    .set({ is_read: true })
    .where(eq(notifications.id, id))
    .returning()
  return c.json(updated)
})

// Mark all of the caller's notifications read.
router.post('/read-all', async (c) => {
  const userId = getUserId(c)
  const updated = await db
    .update(notifications)
    .set({ is_read: true })
    .where(and(eq(notifications.user_id, userId), eq(notifications.is_read, false)))
    .returning()
  return c.json({ success: true, count: updated.length })
})

export default router
