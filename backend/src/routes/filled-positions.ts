import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  filled_positions,
  workspace_members,
  requisitions,
  plan_lines,
} from '../db/schema.js'
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

const filledBody = z.object({
  workspace_id: z.string().min(1),
  team_id: z.string().nullable().optional(),
  req_id: z.string().nullable().optional(),
  plan_line_id: z.string().nullable().optional(),
  person_name: z.string().min(1),
  title: z.string().min(1),
  level: z.string().min(1),
  actual_start: z.string().nullable().optional(),
  actual_base: z.number().optional(),
  actual_variable: z.number().optional(),
  burden_rate: z.number().optional(),
  hire_type: z.string().optional(),
  backfill_of: z.string().nullable().optional(),
})

const filledUpdate = filledBody.partial().omit({ workspace_id: true })

const bulkBody = z.object({
  workspace_id: z.string().min(1),
  filled: z.array(filledBody.omit({ workspace_id: true })).min(1),
})

// Validate optional req/plan-line FKs belong to the same workspace.
async function checkLinks(
  workspaceId: string,
  reqId?: string | null,
  planLineId?: string | null,
): Promise<string | null> {
  if (reqId) {
    const [r] = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.id, reqId))
    if (!r) return 'req not found'
    if (r.workspace_id !== workspaceId) return 'req not in this workspace'
  }
  if (planLineId) {
    const [pl] = await db
      .select()
      .from(plan_lines)
      .where(eq(plan_lines.id, planLineId))
    if (!pl) return 'plan_line not found'
    if (pl.workspace_id !== workspaceId) return 'plan_line not in this workspace'
  }
  return null
}

// GET / — public list ?workspace_id
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const teamId = c.req.query('team_id')
  const reqId = c.req.query('req_id')
  const conds = [eq(filled_positions.workspace_id, workspaceId)]
  if (teamId) conds.push(eq(filled_positions.team_id, teamId))
  if (reqId) conds.push(eq(filled_positions.req_id, reqId))
  const rows = await db
    .select()
    .from(filled_positions)
    .where(and(...conds))
    .orderBy(desc(filled_positions.created_at))
  return c.json(rows)
})

// GET /:id — public detail
router.get('/:id', async (c) => {
  const [r] = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.id, c.req.param('id')))
  if (!r) return c.json({ error: 'Not found' }, 404)
  return c.json(r)
})

// POST / — auth create
router.post('/', authMiddleware, zValidator('json', filledBody), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  const linkErr = await checkLinks(body.workspace_id, body.req_id, body.plan_line_id)
  if (linkErr) return c.json({ error: linkErr }, 400)

  const [r] = await db
    .insert(filled_positions)
    .values({
      workspace_id: body.workspace_id,
      team_id: body.team_id ?? null,
      req_id: body.req_id ?? null,
      plan_line_id: body.plan_line_id ?? null,
      person_name: body.person_name,
      title: body.title,
      level: body.level,
      actual_start: toDate(body.actual_start) ?? null,
      actual_base: body.actual_base ?? 0,
      actual_variable: body.actual_variable ?? 0,
      burden_rate: body.burden_rate ?? 0.25,
      hire_type: body.hire_type ?? 'growth',
      backfill_of: body.backfill_of ?? null,
    })
    .returning()
  return c.json(r, 201)
})

// PUT /:id — auth update
router.put('/:id', authMiddleware, zValidator('json', filledUpdate), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const linkErr = await checkLinks(
    existing.workspace_id,
    body.req_id ?? undefined,
    body.plan_line_id ?? undefined,
  )
  if (linkErr) return c.json({ error: linkErr }, 400)

  const patch: Record<string, unknown> = {}
  if (body.team_id !== undefined) patch.team_id = body.team_id
  if (body.req_id !== undefined) patch.req_id = body.req_id
  if (body.plan_line_id !== undefined) patch.plan_line_id = body.plan_line_id
  if (body.person_name !== undefined) patch.person_name = body.person_name
  if (body.title !== undefined) patch.title = body.title
  if (body.level !== undefined) patch.level = body.level
  if (body.actual_start !== undefined) patch.actual_start = toDate(body.actual_start)
  if (body.actual_base !== undefined) patch.actual_base = body.actual_base
  if (body.actual_variable !== undefined) patch.actual_variable = body.actual_variable
  if (body.burden_rate !== undefined) patch.burden_rate = body.burden_rate
  if (body.hire_type !== undefined) patch.hire_type = body.hire_type
  if (body.backfill_of !== undefined) patch.backfill_of = body.backfill_of

  if (Object.keys(patch).length === 0) return c.json(existing)
  const [updated] = await db
    .update(filled_positions)
    .set(patch)
    .where(eq(filled_positions.id, id))
    .returning()
  return c.json(updated)
})

// POST /bulk — auth bulk import
router.post('/bulk', authMiddleware, zValidator('json', bulkBody), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, filled } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)

  for (const f of filled) {
    const linkErr = await checkLinks(workspace_id, f.req_id, f.plan_line_id)
    if (linkErr) return c.json({ error: linkErr }, 400)
  }

  const values = filled.map((f) => ({
    workspace_id,
    team_id: f.team_id ?? null,
    req_id: f.req_id ?? null,
    plan_line_id: f.plan_line_id ?? null,
    person_name: f.person_name,
    title: f.title,
    level: f.level,
    actual_start: toDate(f.actual_start) ?? null,
    actual_base: f.actual_base ?? 0,
    actual_variable: f.actual_variable ?? 0,
    burden_rate: f.burden_rate ?? 0.25,
    hire_type: f.hire_type ?? 'growth',
    backfill_of: f.backfill_of ?? null,
  }))
  const inserted = await db.insert(filled_positions).values(values).returning()
  return c.json(inserted, 201)
})

// DELETE /:id — auth delete
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId)))
    return c.json({ error: 'Forbidden' }, 403)
  await db.delete(filled_positions).where(eq(filled_positions.id, id))
  return c.json({ success: true })
})

export default router
