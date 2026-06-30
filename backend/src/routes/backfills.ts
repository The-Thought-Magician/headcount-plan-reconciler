import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  backfill_links,
  workspace_members,
  filled_positions,
  requisitions,
  terminations,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── helpers ───────────────────────────────────────────────────────────────
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// ── GET / — public — list backfill links for a workspace ────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const rows = await db
    .select()
    .from(backfill_links)
    .where(eq(backfill_links.workspace_id, workspaceId))
    .orderBy(desc(backfill_links.created_at))
  return c.json(rows)
})

// ── GET /net-headcount — public — growth − terminations ─────────────────────
// growth      = confirmed/classified "growth" hires (net adds)
// backfill    = hires classified as backfilling a departure (replacement, not net add)
// terminations= total departures recorded
// net         = growth hires − terminations (true net headcount movement)
router.get('/net-headcount', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)

  const hires = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.workspace_id, workspaceId))
  const terms = await db
    .select()
    .from(terminations)
    .where(eq(terminations.workspace_id, workspaceId))
  const links = await db
    .select()
    .from(backfill_links)
    .where(eq(backfill_links.workspace_id, workspaceId))

  // A hire is counted as a backfill if either:
  //  - it has backfill_of set / hire_type === 'backfill', OR
  //  - a confirmed backfill_link classifies its filled_position as 'backfill'.
  const backfillFilledIds = new Set<string>()
  for (const l of links) {
    if (l.classification === 'backfill' && l.confirmed && l.filled_position_id) {
      backfillFilledIds.add(l.filled_position_id)
    }
  }

  let backfill = 0
  let growth = 0
  for (const h of hires) {
    const isBackfill =
      backfillFilledIds.has(h.id) || h.hire_type === 'backfill' || !!h.backfill_of
    if (isBackfill) backfill++
    else growth++
  }

  const terminationCount = terms.length
  // Net headcount change = total hires (growth + backfill) − terminations.
  const net = growth + backfill - terminationCount

  return c.json({
    growth,
    backfill,
    terminations: terminationCount,
    net,
    totalHires: hires.length,
  })
})

// ── POST /suggest — auth — auto-match terms ↔ hires/reqs in same team/level ──
const suggestSchema = z.object({
  workspace_id: z.string().min(1),
})

router.post('/suggest', authMiddleware, zValidator('json', suggestSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const hires = await db
    .select()
    .from(filled_positions)
    .where(eq(filled_positions.workspace_id, workspace_id))
  const terms = await db
    .select()
    .from(terminations)
    .where(eq(terminations.workspace_id, workspace_id))
  const reqs = await db
    .select()
    .from(requisitions)
    .where(eq(requisitions.workspace_id, workspace_id))
  const existing = await db
    .select()
    .from(backfill_links)
    .where(eq(backfill_links.workspace_id, workspace_id))

  // Avoid re-suggesting links we already have for the same filled position.
  const linkedFilled = new Set(existing.map((l) => l.filled_position_id).filter(Boolean))

  // Track which terminations are already consumed by a suggestion this run.
  const usedTermIds = new Set<string>()
  for (const l of existing) if (l.termination_id) usedTermIds.add(l.termination_id)

  const created: typeof backfill_links.$inferSelect[] = []

  for (const hire of hires) {
    if (linkedFilled.has(hire.id)) continue

    // Find a same-team, same-level termination that happened before the hire start
    // and is not yet consumed — the strongest backfill signal.
    let bestTerm: (typeof terms)[number] | undefined
    let bestScore = 0
    for (const t of terms) {
      if (usedTermIds.has(t.id)) continue
      let score = 0
      if (t.team_id && hire.team_id && t.team_id === hire.team_id) score += 0.5
      if (t.level && hire.level && t.level === hire.level) score += 0.3
      // Departure precedes the hire's start → consistent with a replacement.
      const termMs = t.term_date ? new Date(t.term_date).getTime() : null
      const startMs = hire.actual_start ? new Date(hire.actual_start).getTime() : null
      if (termMs !== null && startMs !== null && termMs <= startMs) score += 0.2
      if (score > bestScore) {
        bestScore = score
        bestTerm = t
      }
    }

    // The hire's own requisition (if any) is recorded for context.
    const reqId =
      hire.req_id && reqs.some((r) => r.id === hire.req_id) ? hire.req_id : null

    // Only suggest a backfill link when there is a plausible matched departure
    // (same team + at least one other corroborating signal). Otherwise classify
    // as growth with a link that records the hire for auditability.
    let classification: string
    let confidence: number
    let terminationId: string | null
    if (bestTerm && bestScore >= 0.5) {
      classification = 'backfill'
      confidence = Math.min(1, bestScore)
      terminationId = bestTerm.id
      usedTermIds.add(bestTerm.id)
    } else {
      classification = 'growth'
      confidence = 0.4
      terminationId = null
    }

    const [link] = await db
      .insert(backfill_links)
      .values({
        workspace_id,
        filled_position_id: hire.id,
        req_id: reqId,
        termination_id: terminationId,
        classification,
        confidence,
        confirmed: false,
      })
      .returning()
    created.push(link)
  }

  return c.json(created, 201)
})

// ── POST /:id/confirm — auth — confirm classification ───────────────────────
router.post('/:id/confirm', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(backfill_links).where(eq(backfill_links.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const [updated] = await db
    .update(backfill_links)
    .set({ confirmed: true })
    .where(eq(backfill_links.id, id))
    .returning()

  // Keep the filled_position hire_type consistent with a confirmed backfill.
  if (updated.classification === 'backfill' && updated.filled_position_id) {
    await db
      .update(filled_positions)
      .set({ hire_type: 'backfill' })
      .where(eq(filled_positions.id, updated.filled_position_id))
  }

  return c.json(updated)
})

// ── PUT /:id — auth — set classification ────────────────────────────────────
const updateSchema = z.object({
  classification: z.enum(['backfill', 'growth']).optional(),
  confidence: z.number().min(0).max(1).optional(),
  req_id: z.string().nullable().optional(),
  termination_id: z.string().nullable().optional(),
  confirmed: z.boolean().optional(),
})

router.put('/:id', authMiddleware, zValidator('json', updateSchema), async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(backfill_links).where(eq(backfill_links.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const body = c.req.valid('json')
  const [updated] = await db
    .update(backfill_links)
    .set(body)
    .where(eq(backfill_links.id, id))
    .returning()
  return c.json(updated)
})

// ── DELETE /:id — auth ──────────────────────────────────────────────────────
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(backfill_links).where(eq(backfill_links.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(backfill_links).where(eq(backfill_links.id, id))
  return c.json({ success: true })
})

export default router
