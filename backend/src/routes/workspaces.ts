import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { workspaces, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

const createSchema = z.object({
  name: z.string().min(1),
  fiscal_year_start_month: z.number().int().min(1).max(12).optional(),
  currency: z.string().min(1).optional(),
  default_burden_rate: z.number().optional(),
  planning_granularity: z.string().min(1).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  fiscal_year_start_month: z.number().int().min(1).max(12).optional(),
  currency: z.string().min(1).optional(),
  default_burden_rate: z.number().optional(),
  planning_granularity: z.string().min(1).optional(),
})

// GET / — public — list workspaces the caller belongs to.
// Caller identity comes from the X-User-Id header (forwarded by the proxy) or
// an explicit ?user_id query param. Returns [] when no identity is supplied.
router.get('/', async (c) => {
  const userId =
    c.req.query('user_id') ??
    c.req.header('X-User-Id') ??
    c.req.header('x-user-id') ??
    ''
  if (!userId) return c.json([])
  const rows = await db
    .select({ workspace: workspaces })
    .from(workspace_members)
    .innerJoin(workspaces, eq(workspace_members.workspace_id, workspaces.id))
    .where(eq(workspace_members.user_id, userId))
    .orderBy(desc(workspaces.created_at))
  return c.json(rows.map((r) => r.workspace))
})

// GET /:id — public — workspace detail
router.get('/:id', async (c) => {
  const [ws] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, c.req.param('id')))
  if (!ws) return c.json({ error: 'Not found' }, 404)
  return c.json(ws)
})

// POST / — auth — create workspace + insert owner membership
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  const [ws] = await db
    .insert(workspaces)
    .values({
      name: body.name,
      owner_id: userId,
      ...(body.fiscal_year_start_month !== undefined
        ? { fiscal_year_start_month: body.fiscal_year_start_month }
        : {}),
      ...(body.currency !== undefined ? { currency: body.currency } : {}),
      ...(body.default_burden_rate !== undefined
        ? { default_burden_rate: body.default_burden_rate }
        : {}),
      ...(body.planning_granularity !== undefined
        ? { planning_granularity: body.planning_granularity }
        : {}),
    })
    .returning()
  await db.insert(workspace_members).values({
    workspace_id: ws.id,
    user_id: userId,
    role: 'owner',
  })
  return c.json(ws, 201)
})

// PUT /:id — auth(owner) — update settings
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(workspaces)
    .set({ ...body, updated_at: new Date() })
    .where(eq(workspaces.id, id))
    .returning()
  return c.json(updated)
})

// DELETE /:id — auth(owner) — delete workspace (and its memberships)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(workspaces).where(eq(workspaces.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (existing.owner_id !== userId) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(workspace_members).where(eq(workspace_members.workspace_id, id))
  await db.delete(workspaces).where(eq(workspaces.id, id))
  return c.json({ success: true })
})

export default router
