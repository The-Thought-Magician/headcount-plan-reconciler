import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { terminations, workspace_members } from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
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

function toDate(v: unknown): Date | null | undefined {
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  const t = Date.parse(String(v))
  return Number.isNaN(t) ? null : new Date(t)
}

const termBody = z.object({
  workspace_id: z.string().min(1),
  team_id: z.string().nullable().optional(),
  person_name: z.string().min(1),
  level: z.string().min(1),
  title: z.string().min(1),
  term_date: z.string().nullable().optional(),
  reason: z.string().optional(),
  base: z.number().optional(),
})

const bulkBody = z.object({
  workspace_id: z.string().min(1),
  terminations: z.array(termBody.omit({ workspace_id: true })).min(1),
})

// GET / — public list ?workspace_id (optional team filter)
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const teamId = c.req.query('team_id')
  const conds = [eq(terminations.workspace_id, workspaceId)]
  if (teamId) conds.push(eq(terminations.team_id, teamId))
  const rows = await db
    .select()
    .from(terminations)
    .where(and(...conds))
    .orderBy(desc(terminations.term_date))
  return c.json(rows)
})

// POST / — auth create
router.post('/', authMiddleware, zValidator('json', termBody), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const [r] = await db
    .insert(terminations)
    .values({
      workspace_id: body.workspace_id,
      team_id: body.team_id ?? null,
      person_name: body.person_name,
      level: body.level,
      title: body.title,
      term_date: toDate(body.term_date) ?? null,
      reason: body.reason ?? '',
      base: body.base ?? 0,
    })
    .returning()
  return c.json(r, 201)
})

// POST /bulk — auth bulk import
router.post('/bulk', authMiddleware, zValidator('json', bulkBody), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, terminations: rows } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const values = rows.map((t) => ({
    workspace_id,
    team_id: t.team_id ?? null,
    person_name: t.person_name,
    level: t.level,
    title: t.title,
    term_date: toDate(t.term_date) ?? null,
    reason: t.reason ?? '',
    base: t.base ?? 0,
  }))
  const inserted = await db.insert(terminations).values(values).returning()
  return c.json(inserted, 201)
})

// DELETE /:id — auth delete
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(terminations)
    .where(eq(terminations.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  await db.delete(terminations).where(eq(terminations.id, id))
  return c.json({ success: true })
})

export default router
