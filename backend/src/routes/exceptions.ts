import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import { exceptions, workspace_members } from '../db/schema.js'
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

// Public: list out-of-plan exception requests for a workspace (optional status filter)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const status = c.req.query('status')
  const conditions = [eq(exceptions.workspace_id, workspaceId)]
  if (status) conditions.push(eq(exceptions.status, status))
  const rows = await db
    .select()
    .from(exceptions)
    .where(and(...conditions))
    .orderBy(desc(exceptions.created_at))
  return c.json(rows)
})

// Auth: request an exception
const createSchema = z.object({
  workspace_id: z.string().min(1),
  req_id: z.string().min(1).optional().nullable(),
  filled_position_id: z.string().min(1).optional().nullable(),
  reason: z.string().min(1),
})
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [created] = await db
    .insert(exceptions)
    .values({
      workspace_id: body.workspace_id,
      req_id: body.req_id ?? null,
      filled_position_id: body.filled_position_id ?? null,
      reason: body.reason,
      status: 'pending',
      requested_by: userId,
    })
    .returning()
  return c.json(created, 201)
})

// Auth: approve / deny an exception
const decideSchema = z.object({
  status: z.enum(['approved', 'denied']),
  decision_note: z.string().optional().default(''),
})
router.post('/:id/decide', authMiddleware, zValidator('json', decideSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(exceptions).where(eq(exceptions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(exceptions)
    .set({
      status: body.status,
      decision_note: body.decision_note ?? '',
      approver: userId,
      decided_at: new Date(),
    })
    .where(eq(exceptions.id, id))
    .returning()
  return c.json(updated)
})

// Auth: delete an exception
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(exceptions).where(eq(exceptions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(exceptions).where(eq(exceptions.id, id))
  return c.json({ success: true })
})

export default router
