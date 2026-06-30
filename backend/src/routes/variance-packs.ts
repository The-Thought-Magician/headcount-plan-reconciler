import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { eq, and, desc } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
  variance_packs,
  variance_pack_lines,
  workspace_members,
  budget_baselines,
  plan_lines,
  filled_positions,
  requisitions,
  terminations,
} from '../db/schema.js'
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

// ── GET / — public — list packs for a workspace ──────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(variance_packs)
    .where(eq(variance_packs.workspace_id, workspaceId))
    .orderBy(desc(variance_packs.created_at))
  return c.json(rows)
})

// ── GET /:id — public — pack + bridge lines ──────────────────────────────────
router.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [pack] = await db.select().from(variance_packs).where(eq(variance_packs.id, id))
  if (!pack) return c.json({ error: 'Not found' }, 404)
  const lines = await db
    .select()
    .from(variance_pack_lines)
    .where(eq(variance_pack_lines.variance_pack_id, id))
    .orderBy(variance_pack_lines.sort_order)
  return c.json({ ...pack, lines })
})

// ── POST /generate — auth — build the bridge for a fiscal-year / period ──────
const generateSchema = z.object({
  workspace_id: z.string().min(1),
  fiscal_year: z.number().int(),
  period_label: z.string().min(1),
})

router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, fiscal_year, period_label } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // Starting budget: sum of finance baselines for the fiscal year.
  const baselines = await db
    .select()
    .from(budget_baselines)
    .where(and(eq(budget_baselines.workspace_id, workspace_id), eq(budget_baselines.fiscal_year, fiscal_year)))
  const startingBudget = baselines.reduce((s, b) => s + (b.budgeted_cost ?? 0), 0)

  // Planned cost for the year (loaded comp = base + variable, burdened).
  const planLineRows = await db
    .select()
    .from(plan_lines)
    .where(eq(plan_lines.workspace_id, workspace_id))
  const plannedCost = planLineRows.reduce((s, l) => {
    const loaded = (l.budgeted_base + l.budgeted_variable) * (1 + (l.burden_rate ?? 0))
    return s + loaded * (l.count ?? 1)
  }, 0)

  // Actual cost from filled positions (loaded).
  const filledRows = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.workspace_id, workspace_id))
  const actualFilledCost = filledRows.reduce((s, f) => {
    const loaded = (f.actual_base + f.actual_variable) * (1 + (f.burden_rate ?? 0))
    return s + loaded
  }, 0)

  // Open-req committed cost (budgeted base, burdened with workspace default-ish 0.25 fallback).
  const reqRows = await db
    .select()
    .from(requisitions)
    .where(and(eq(requisitions.workspace_id, workspace_id), eq(requisitions.status, 'open')))
  const openReqCost = reqRows.reduce((s, r) => s + r.budgeted_base * 1.25, 0)

  // Savings from terminations (annualized base removed).
  const termRows = await db
    .select()
    .from(terminations)
    .where(eq(terminations.workspace_id, workspace_id))
  const terminationSavings = termRows.reduce((s, t) => s + (t.base ?? 0), 0)

  // Plan-vs-budget variance (over/under plan against finance baseline).
  const planVariance = plannedCost - startingBudget
  // Hiring delta: actuals + open commitments vs plan.
  const hiringDelta = actualFilledCost + openReqCost - plannedCost

  const endingActual = startingBudget + planVariance + hiringDelta - terminationSavings
  const totalVariance = endingActual - startingBudget

  const [pack] = await db
    .insert(variance_packs)
    .values({
      workspace_id,
      fiscal_year,
      period_label,
      status: 'draft',
      starting_budget: startingBudget,
      ending_actual: endingActual,
      total_variance: totalVariance,
      created_by: userId,
    })
    .returning()

  const bridgeLines = [
    { bucket: 'baseline', label: 'Starting finance budget', amount: startingBudget, sort_order: 0 },
    { bucket: 'plan', label: 'Plan vs budget', amount: planVariance, sort_order: 1 },
    { bucket: 'hiring', label: 'Hiring (actuals + open reqs) vs plan', amount: hiringDelta, sort_order: 2 },
    { bucket: 'terminations', label: 'Termination savings', amount: -terminationSavings, sort_order: 3 },
    { bucket: 'ending', label: 'Ending projected actual', amount: endingActual, sort_order: 4 },
  ]

  const lines = await db
    .insert(variance_pack_lines)
    .values(
      bridgeLines.map((l) => ({
        variance_pack_id: pack.id,
        workspace_id,
        bucket: l.bucket,
        label: l.label,
        amount: l.amount,
        sort_order: l.sort_order,
      })),
    )
    .returning()

  return c.json({ ...pack, lines }, 201)
})

// ── POST /:id/sign — auth — record people / finance sign-off ─────────────────
const signSchema = z.object({
  role: z.enum(['people', 'finance']),
})

router.post('/:id/sign', authMiddleware, zValidator('json', signSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const { role } = c.req.valid('json')
  const [pack] = await db.select().from(variance_packs).where(eq(variance_packs.id, id))
  if (!pack) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(pack.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const now = new Date()
  const patch: Record<string, unknown> =
    role === 'people'
      ? { people_signed_by: userId, people_signed_at: now }
      : { finance_signed_by: userId, finance_signed_at: now }

  // Determine fully-signed state after applying this signature.
  const peopleSigned = role === 'people' ? true : !!pack.people_signed_at
  const financeSigned = role === 'finance' ? true : !!pack.finance_signed_at
  patch.status = peopleSigned && financeSigned ? 'signed' : 'pending'

  const [updated] = await db
    .update(variance_packs)
    .set(patch)
    .where(eq(variance_packs.id, id))
    .returning()
  return c.json(updated)
})

// ── DELETE /:id — auth ───────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [pack] = await db.select().from(variance_packs).where(eq(variance_packs.id, id))
  if (!pack) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(pack.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(variance_pack_lines).where(eq(variance_pack_lines.variance_pack_id, id))
  await db.delete(variance_packs).where(eq(variance_packs.id, id))
  return c.json({ success: true })
})

export default router
