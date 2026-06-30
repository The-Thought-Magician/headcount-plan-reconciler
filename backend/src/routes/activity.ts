import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { activity_log, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
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

// Public: paginated activity feed for a workspace.
// GET /?workspace_id=...&limit=...&offset=...
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)

  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10)
  const offsetRaw = parseInt(c.req.query('offset') ?? '0', 10)
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0

  const rows = await db
    .select()
    .from(activity_log)
    .where(eq(activity_log.workspace_id, workspaceId))
    .orderBy(desc(activity_log.created_at))
    .limit(limit)
    .offset(offset)

  return c.json(rows)
})

const activitySchema = z.object({
  workspace_id: z.string().min(1),
  action: z.string().min(1),
  entity_type: z.string().min(1),
  entity_id: z.string().optional().nullable(),
  detail: z.record(z.unknown()).optional().default({}),
})

// Auth: record an activity entry. Caller must be a workspace member.
router.post('/', authMiddleware, zValidator('json', activitySchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  const [row] = await db
    .insert(activity_log)
    .values({
      workspace_id: body.workspace_id,
      user_id: userId,
      action: body.action,
      entity_type: body.entity_type,
      entity_id: body.entity_id ?? null,
      detail: body.detail ?? {},
    })
    .returning()
  return c.json(row, 201)
})

export default router
