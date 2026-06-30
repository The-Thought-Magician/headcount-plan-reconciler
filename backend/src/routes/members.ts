import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspace_members, workspaces } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const addSchema = z.object({
  workspace_id: z.string().min(1),
  user_id: z.string().min(1),
  role: z.string().min(1).optional(),
})

const updateSchema = z.object({
  role: z.string().min(1),
})

// Helper: is `userId` a member of `workspaceId`?
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, workspaceId),
        eq(workspace_members.user_id, userId),
      ),
    )
  return !!m
}

// GET / — public — ?workspace_id list members
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.workspace_id, workspaceId))
    .orderBy(desc(workspace_members.created_at))
  return c.json(rows)
})

// POST / — auth — add member by user_id + role
router.post('/', authMiddleware, zValidator('json', addSchema), async (c) => {
  const callerId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, body.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (!(await isMember(body.workspace_id, callerId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  // Prevent duplicate membership (UNIQUE(workspace_id, user_id)).
  const [existing] = await db
    .select()
    .from(workspace_members)
    .where(
      and(
        eq(workspace_members.workspace_id, body.workspace_id),
        eq(workspace_members.user_id, body.user_id),
      ),
    )
  if (existing) return c.json({ error: 'User is already a member' }, 409)
  const [member] = await db
    .insert(workspace_members)
    .values({
      workspace_id: body.workspace_id,
      user_id: body.user_id,
      ...(body.role !== undefined ? { role: body.role } : {}),
    })
    .returning()
  return c.json(member, 201)
})

// PUT /:id — auth — change role
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const callerId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, callerId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')
  const [updated] = await db
    .update(workspace_members)
    .set({ role: body.role })
    .where(eq(workspace_members.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth — remove member
router.delete('/:id', authMiddleware, async (c) => {
  const callerId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(workspace_members)
    .where(eq(workspace_members.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, callerId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  await db.delete(workspace_members).where(eq(workspace_members.id, id))
  return c.json({ success: true })
})

export default router
