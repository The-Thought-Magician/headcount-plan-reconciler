import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  requisitions,
  req_events,
  workspace_members,
  plan_lines,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ─────────────────────────────────────────────────────────────
// helpers
// ─────────────────────────────────────────────────────────────

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

const reqBody = z.object({
  workspace_id: z.string().min(1),
  team_id: z.string().nullable().optional(),
  plan_line_id: z.string().nullable().optional(),
  title: z.string().min(1),
  level: z.string().min(1),
  status: z.string().optional(),
  target_start: z.string().nullable().optional(),
  fill_by: z.string().nullable().optional(),
  recruiter: z.string().nullable().optional(),
  hiring_manager: z.string().nullable().optional(),
  hire_type: z.string().optional(),
  budgeted_base: z.number().optional(),
})

const reqUpdate = reqBody.partial().omit({ workspace_id: true })

const statusBody = z.object({
  status: z.string().min(1),
  note: z.string().optional(),
})

const linkPlanBody = z.object({
  plan_line_id: z.string().nullable(),
})

const bulkBody = z.object({
  workspace_id: z.string().min(1),
  reqs: z.array(reqBody.omit({ workspace_id: true })).min(1),
})

// ─────────────────────────────────────────────────────────────
// GET / — public list, ?workspace_id (filter status/team)
// ─────────────────────────────────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const status = c.req.query('status')
  const teamId = c.req.query('team_id')
  const conds = [eq(requisitions.workspace_id, workspaceId)]
  if (status) conds.push(eq(requisitions.status, status))
  if (teamId) conds.push(eq(requisitions.team_id, teamId))
  const rows = await db
    .select()
    .from(requisitions)
    .where(and(...conds))
    .orderBy(desc(requisitions.opened_at))
  return c.json(rows)
})

// ─────────────────────────────────────────────────────────────
// GET /:id — public detail + events
// ─────────────────────────────────────────────────────────────
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [r] = await db.select().from(requisitions).where(eq(requisitions.id, id))
  if (!r) return c.json({ error: 'Not found' }, 404)
  const events = await db
    .select()
    .from(req_events)
    .where(eq(req_events.req_id, id))
    .orderBy(req_events.created_at)
  return c.json({ ...r, events })
})

// ─────────────────────────────────────────────────────────────
// POST / — auth create (records opened event)
// ─────────────────────────────────────────────────────────────
router.post('/', authMiddleware, zValidator('json', reqBody), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const status = body.status ?? 'open'
  const [r] = await db
    .insert(requisitions)
    .values({
      workspace_id: body.workspace_id,
      team_id: body.team_id ?? null,
      plan_line_id: body.plan_line_id ?? null,
      title: body.title,
      level: body.level,
      status,
      target_start: toDate(body.target_start) ?? null,
      fill_by: toDate(body.fill_by) ?? null,
      recruiter: body.recruiter ?? null,
      hiring_manager: body.hiring_manager ?? null,
      hire_type: body.hire_type ?? 'growth',
      budgeted_base: body.budgeted_base ?? 0,
    })
    .returning()

  await db.insert(req_events).values({
    req_id: r.id,
    workspace_id: r.workspace_id,
    from_status: null,
    to_status: status,
    note: 'Requisition opened',
    created_by: userId,
  })

  return c.json(r, 201)
})

// ─────────────────────────────────────────────────────────────
// PUT /:id — auth update fields
// ─────────────────────────────────────────────────────────────
router.put('/:id', authMiddleware, zValidator('json', reqUpdate), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(requisitions)
    .where(eq(requisitions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const patch: Record<string, unknown> = {}
  if (body.team_id !== undefined) patch.team_id = body.team_id
  if (body.plan_line_id !== undefined) patch.plan_line_id = body.plan_line_id
  if (body.title !== undefined) patch.title = body.title
  if (body.level !== undefined) patch.level = body.level
  if (body.status !== undefined) patch.status = body.status
  if (body.target_start !== undefined) patch.target_start = toDate(body.target_start)
  if (body.fill_by !== undefined) patch.fill_by = toDate(body.fill_by)
  if (body.recruiter !== undefined) patch.recruiter = body.recruiter
  if (body.hiring_manager !== undefined) patch.hiring_manager = body.hiring_manager
  if (body.hire_type !== undefined) patch.hire_type = body.hire_type
  if (body.budgeted_base !== undefined) patch.budgeted_base = body.budgeted_base

  if (Object.keys(patch).length === 0) return c.json(existing)
  const [updated] = await db
    .update(requisitions)
    .set(patch)
    .where(eq(requisitions.id, id))
    .returning()
  return c.json(updated)
})

// ─────────────────────────────────────────────────────────────
// POST /:id/status — auth transition + append req_event
// ─────────────────────────────────────────────────────────────
router.post(
  '/:id/status',
  authMiddleware,
  zValidator('json', statusBody),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (!(await isMember(existing.workspace_id, userId)))
      return c.json({ error: 'Forbidden' }, 403)

    const { status, note } = c.req.valid('json')
    const [updated] = await db
      .update(requisitions)
      .set({ status })
      .where(eq(requisitions.id, id))
      .returning()

    await db.insert(req_events).values({
      req_id: id,
      workspace_id: existing.workspace_id,
      from_status: existing.status,
      to_status: status,
      note: note ?? '',
      created_by: userId,
    })

    return c.json(updated)
  },
)

// ─────────────────────────────────────────────────────────────
// POST /:id/link-plan — auth set plan_line_id
// ─────────────────────────────────────────────────────────────
router.post(
  '/:id/link-plan',
  authMiddleware,
  zValidator('json', linkPlanBody),
  async (c) => {
    const userId = getUserId(c)
    const id = c.req.param('id')
    const [existing] = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, id))
    if (!existing) return c.json({ error: 'Not found' }, 404)
    if (!(await isMember(existing.workspace_id, userId)))
      return c.json({ error: 'Forbidden' }, 403)

    const { plan_line_id } = c.req.valid('json')
    if (plan_line_id) {
      const [pl] = await db
        .select()
        .from(plan_lines)
        .where(eq(plan_lines.id, plan_line_id))
      if (!pl) return c.json({ error: 'plan_line not found' }, 404)
      if (pl.workspace_id !== existing.workspace_id)
        return c.json({ error: 'plan_line not in this workspace' }, 400)
    }

    const [updated] = await db
      .update(requisitions)
      .set({ plan_line_id })
      .where(eq(requisitions.id, id))
      .returning()
    return c.json(updated)
  },
)

// ─────────────────────────────────────────────────────────────
// POST /bulk — auth bulk import
// ─────────────────────────────────────────────────────────────
router.post('/bulk', authMiddleware, zValidator('json', bulkBody), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, reqs } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const values = reqs.map((r) => ({
    workspace_id,
    team_id: r.team_id ?? null,
    plan_line_id: r.plan_line_id ?? null,
    title: r.title,
    level: r.level,
    status: r.status ?? 'open',
    target_start: toDate(r.target_start) ?? null,
    fill_by: toDate(r.fill_by) ?? null,
    recruiter: r.recruiter ?? null,
    hiring_manager: r.hiring_manager ?? null,
    hire_type: r.hire_type ?? 'growth',
    budgeted_base: r.budgeted_base ?? 0,
  }))

  const inserted = await db.insert(requisitions).values(values).returning()

  if (inserted.length) {
    await db.insert(req_events).values(
      inserted.map((r) => ({
        req_id: r.id,
        workspace_id,
        from_status: null,
        to_status: r.status,
        note: 'Imported',
        created_by: userId,
      })),
    )
  }

  return c.json(inserted, 201)
})

// ─────────────────────────────────────────────────────────────
// DELETE /:id — auth delete (+ events)
// ─────────────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(requisitions)
    .where(eq(requisitions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  await db.delete(req_events).where(eq(req_events.req_id, id))
  await db.delete(requisitions).where(eq(requisitions.id, id))
  return c.json({ success: true })
})

export default router
