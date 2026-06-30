import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { teams, workspaces, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  parent_id: z.string().min(1).nullable().optional(),
  cost_center: z.string().min(1).nullable().optional(),
  owner_user_id: z.string().min(1).nullable().optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  parent_id: z.string().min(1).nullable().optional(),
  cost_center: z.string().min(1).nullable().optional(),
  owner_user_id: z.string().min(1).nullable().optional(),
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

// GET / — public — ?workspace_id list teams (org tree)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(teams)
    .where(eq(teams.workspace_id, workspaceId))
    .orderBy(desc(teams.created_at))
  return c.json(rows)
})

// GET /:id — public — team detail
router.get('/:id', async (c) => {
  const [team] = await db.select().from(teams).where(eq(teams.id, c.req.param('id')))
  if (!team) return c.json({ error: 'Not found' }, 404)
  return c.json(team)
})

// POST / — auth — create team
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const callerId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, body.workspace_id))
  if (!ws) return c.json({ error: 'Workspace not found' }, 404)
  if (!(await isMember(body.workspace_id, callerId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  // If a parent is given, it must belong to the same workspace.
  if (body.parent_id) {
    const [parent] = await db.select().from(teams).where(eq(teams.id, body.parent_id))
    if (!parent || parent.workspace_id !== body.workspace_id) {
      return c.json({ error: 'Invalid parent_id' }, 400)
    }
  }
  const [team] = await db
    .insert(teams)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      parent_id: body.parent_id ?? null,
      cost_center: body.cost_center ?? null,
      owner_user_id: body.owner_user_id ?? null,
    })
    .returning()
  return c.json(team, 201)
})

// PUT /:id — auth — update name/parent/cost_center/owner
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const callerId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(teams).where(eq(teams.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, callerId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const body = c.req.valid('json')
  // A team cannot be its own parent; a given parent must be in the same workspace.
  if (body.parent_id) {
    if (body.parent_id === id) return c.json({ error: 'A team cannot be its own parent' }, 400)
    const [parent] = await db.select().from(teams).where(eq(teams.id, body.parent_id))
    if (!parent || parent.workspace_id !== existing.workspace_id) {
      return c.json({ error: 'Invalid parent_id' }, 400)
    }
  }
  const patch: Record<string, unknown> = {}
  if (body.name !== undefined) patch.name = body.name
  if (body.parent_id !== undefined) patch.parent_id = body.parent_id
  if (body.cost_center !== undefined) patch.cost_center = body.cost_center
  if (body.owner_user_id !== undefined) patch.owner_user_id = body.owner_user_id
  const [updated] = await db.update(teams).set(patch).where(eq(teams.id, id)).returning()
  return c.json(updated)
})

// DELETE /:id — auth — delete (reparents children to this team's parent)
router.delete('/:id', authMiddleware, async (c) => {
  const callerId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(teams).where(eq(teams.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, callerId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  // Re-attach any direct children to the deleted team's parent to keep the tree valid.
  await db
    .update(teams)
    .set({ parent_id: existing.parent_id ?? null })
    .where(eq(teams.parent_id, id))
  await db.delete(teams).where(eq(teams.id, id))
  return c.json({ success: true })
})

export default router
