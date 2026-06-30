import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import { fiscal_periods, workspace_members } from '../db/schema.js'
import { eq, and, asc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

// ── ownership helper ──────────────────────────────────────────────
async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

// ── quarter date math ─────────────────────────────────────────────
// Builds the start/end Date for a fiscal quarter given the fiscal year and
// the workspace's fiscal-year-start month (1-12). Quarter is 1-4.
function quarterDates(
  fiscalYear: number,
  quarter: number,
  fiscalStartMonth: number,
): { start: Date; end: Date } {
  // month index (0-based) of the first month of the fiscal year
  const fyStart0 = (fiscalStartMonth - 1) % 12
  // each quarter spans 3 months
  const qStartMonthOffset = (quarter - 1) * 3
  const startMonthAbsolute = fyStart0 + qStartMonthOffset
  const startYear = fiscalYear + Math.floor(startMonthAbsolute / 12)
  const startMonth = startMonthAbsolute % 12
  const start = new Date(Date.UTC(startYear, startMonth, 1))
  // end = first day of the month 3 months later, minus 1ms
  const endMonthAbsolute = startMonthAbsolute + 3
  const endYear = fiscalYear + Math.floor(endMonthAbsolute / 12)
  const endMonth = endMonthAbsolute % 12
  const end = new Date(Date.UTC(endYear, endMonth, 1) - 1)
  return { start, end }
}

const periodSchema = z.object({
  workspace_id: z.string().min(1),
  fiscal_year: z.number().int(),
  quarter: z.number().int().min(1).max(4),
  label: z.string().min(1).optional(),
  start_date: z.string().datetime().optional(),
  end_date: z.string().datetime().optional(),
})

const generateSchema = z.object({
  workspace_id: z.string().min(1),
  fiscal_year: z.number().int(),
})

// GET / — public — list fiscal periods for a workspace
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(fiscal_periods)
    .where(eq(fiscal_periods.workspace_id, workspaceId))
    .orderBy(asc(fiscal_periods.fiscal_year), asc(fiscal_periods.quarter))
  return c.json(rows)
})

// POST / — auth — create a single period
router.post('/', authMiddleware, zValidator('json', periodSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const label = body.label ?? `FY${body.fiscal_year} Q${body.quarter}`
  const start = body.start_date ? new Date(body.start_date) : undefined
  const end = body.end_date ? new Date(body.end_date) : undefined

  const [row] = await db
    .insert(fiscal_periods)
    .values({
      workspace_id: body.workspace_id,
      fiscal_year: body.fiscal_year,
      quarter: body.quarter,
      label,
      start_date: start,
      end_date: end,
    })
    .returning()
  return c.json(row, 201)
})

// POST /generate — auth — generate the 4 quarters for a fiscal year
router.post('/generate', authMiddleware, zValidator('json', generateSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, fiscal_year } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  // resolve the workspace's fiscal-year-start month for accurate dates
  const ws = await db.query.workspaces.findFirst({
    where: (w, { eq: e }) => e(w.id, workspace_id),
  })
  const fiscalStartMonth = ws?.fiscal_year_start_month ?? 1

  // which quarters already exist (UNIQUE(workspace_id, fiscal_year, quarter))
  const existing = await db
    .select()
    .from(fiscal_periods)
    .where(and(eq(fiscal_periods.workspace_id, workspace_id), eq(fiscal_periods.fiscal_year, fiscal_year)))
  const existingQuarters = new Set(existing.map((p) => p.quarter))

  const created = []
  for (let q = 1; q <= 4; q++) {
    if (existingQuarters.has(q)) continue
    const { start, end } = quarterDates(fiscal_year, q, fiscalStartMonth)
    const [row] = await db
      .insert(fiscal_periods)
      .values({
        workspace_id,
        fiscal_year,
        quarter: q,
        label: `FY${fiscal_year} Q${q}`,
        start_date: start,
        end_date: end,
      })
      .returning()
    created.push(row)
  }

  // return the full set for the fiscal year (existing + newly created), sorted
  const all = await db
    .select()
    .from(fiscal_periods)
    .where(and(eq(fiscal_periods.workspace_id, workspace_id), eq(fiscal_periods.fiscal_year, fiscal_year)))
    .orderBy(asc(fiscal_periods.quarter))
  return c.json(all, 201)
})

// DELETE /:id — auth — delete a period
router.delete('/:id', authMiddleware, async (c) => {
  const userId = getUserId(c)
  const id = c.req.param('id')
  const [existing] = await db.select().from(fiscal_periods).where(eq(fiscal_periods.id, id))
  if (!existing) return c.json({ error: 'Not found' }, 404)
  if (!(await isMember(existing.workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)
  await db.delete(fiscal_periods).where(eq(fiscal_periods.id, id))
  return c.json({ success: true })
})

export default router
