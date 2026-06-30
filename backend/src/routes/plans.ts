import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { headcount_plans, plan_lines, workspace_members } from '../db/schema.js'
import { eq, and, desc, max } from 'drizzle-orm'
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

const createSchema = z.object({
  workspace_id: z.string().min(1),
  name: z.string().min(1),
  fiscal_year: z.number().int(),
  version: z.number().int().min(1).optional(),
  status: z.enum(['draft', 'in_review', 'approved', 'archived']).optional(),
})

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  status: z.enum(['draft', 'in_review', 'approved', 'archived']).optional(),
})

const cloneSchema = z
  .object({
    name: z.string().min(1).optional(),
  })
  .optional()

// GET / — public — list plans for a workspace
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(headcount_plans)
    .where(eq(headcount_plans.workspace_id, workspaceId))
    .orderBy(desc(headcount_plans.fiscal_year), desc(headcount_plans.version))
  return c.json(rows)
})

// GET /:id — public — plan detail
router.get('/:id', async (c) => {
  const [row] = await db
    .select()
    .from(headcount_plans)
    .where(eq(headcount_plans.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// POST / — auth — create plan
router.post('/', authMiddleware, zValidator('json', createSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // auto-assign next version within (workspace, fiscal_year) when not supplied
  let version = body.version
  if (version === undefined) {
    const [m] = await db
      .select({ v: max(headcount_plans.version) })
      .from(headcount_plans)
      .where(
        and(
          eq(headcount_plans.workspace_id, body.workspace_id),
          eq(headcount_plans.fiscal_year, body.fiscal_year),
        ),
      )
    version = (m?.v ?? 0) + 1
  }

  const [row] = await db
    .insert(headcount_plans)
    .values({
      workspace_id: body.workspace_id,
      name: body.name,
      fiscal_year: body.fiscal_year,
      version,
      status: body.status ?? 'draft',
      created_by: userId,
    })
    .returning()
  return c.json(row, 201)
})

// PUT /:id — auth — update name/status
router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(headcount_plans).where(eq(headcount_plans.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const body = c.req.valid('json')
  const [updated] = await db
    .update(headcount_plans)
    .set({ ...body, updated_at: new Date() })
    .where(eq(headcount_plans.id, id))
    .returning()
  return c.json(updated)
})

// POST /:id/approve — auth — set status approved + approver/approved_at
router.post('/:id/approve', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(headcount_plans).where(eq(headcount_plans.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  const [updated] = await db
    .update(headcount_plans)
    .set({
      status: 'approved',
      approved_by: userId,
      approved_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(headcount_plans.id, id))
    .returning()
  return c.json(updated)
})

// POST /:id/clone — auth — clone plan + its lines as a new version
router.post('/:id/clone', authMiddleware, zValidator('json', cloneSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(headcount_plans).where(eq(headcount_plans.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')

  // next version within the same (workspace, fiscal_year)
  const [m] = await db
    .select({ v: max(headcount_plans.version) })
    .from(headcount_plans)
    .where(
      and(
        eq(headcount_plans.workspace_id, existing.workspace_id),
        eq(headcount_plans.fiscal_year, existing.fiscal_year),
      ),
    )
  const nextVersion = (m?.v ?? existing.version) + 1

  const [clone] = await db
    .insert(headcount_plans)
    .values({
      workspace_id: existing.workspace_id,
      name: body?.name ?? `${existing.name} (v${nextVersion})`,
      fiscal_year: existing.fiscal_year,
      version: nextVersion,
      status: 'draft',
      created_by: userId,
    })
    .returning()

  // copy all plan lines into the new plan
  const lines = await db.select().from(plan_lines).where(eq(plan_lines.plan_id, id))
  if (lines.length > 0) {
    await db.insert(plan_lines).values(
      lines.map((l) => ({
        plan_id: clone.id,
        workspace_id: l.workspace_id,
        team_id: l.team_id,
        level: l.level,
        role_title: l.role_title,
        quarter: l.quarter,
        count: l.count,
        budgeted_base: l.budgeted_base,
        budgeted_variable: l.budgeted_variable,
        burden_rate: l.burden_rate,
        planned_start_quarter: l.planned_start_quarter,
        hire_type: l.hire_type,
        justification: l.justification,
        annotations: l.annotations ?? [],
      })),
    )
  }

  return c.json(clone, 201)
})

// DELETE /:id — auth — delete plan (and its lines)
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(headcount_plans).where(eq(headcount_plans.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(plan_lines).where(eq(plan_lines.plan_id, id))
  await db.delete(headcount_plans).where(eq(headcount_plans.id, id))
  return c.json({ success: true })
})

export default router
