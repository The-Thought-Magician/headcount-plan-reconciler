import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  velocity_metrics,
  workspace_members,
  requisitions,
  req_events,
  filled_positions,
  teams,
} from '../db/schema.js'
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

const DAY_MS = 86_400_000

// Pipeline stages, in order. Time spent in each stage is the gap between the
// req_event that entered the stage and the next req_event.
const STAGE_ORDER = ['open', 'sourcing', 'interviewing', 'offer', 'filled', 'closed']

// ── GET / — public — list velocity metrics ─────────────────────────────────
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)
  const rows = await db
    .select()
    .from(velocity_metrics)
    .where(eq(velocity_metrics.workspace_id, workspaceId))
    .orderBy(desc(velocity_metrics.created_at))
  return c.json(rows)
})

// ── GET /bottlenecks — public — bottleneck attribution rollup ───────────────
// Rolls up time-to-fill and attributes the dominant bottleneck stage along
// three axes: by team, by recruiter, and by pipeline stage.
router.get('/bottlenecks', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id required' }, 400)

  const reqs = await db
    .select()
    .from(requisitions)
    .where(eq(requisitions.workspace_id, workspaceId))
  const events = await db
    .select()
    .from(req_events)
    .where(eq(req_events.workspace_id, workspaceId))
  const teamRows = await db.select().from(teams).where(eq(teams.workspace_id, workspaceId))
  const teamName = new Map(teamRows.map((t) => [t.id, t.name]))

  // Group events by req, chronologically.
  const eventsByReq = new Map<string, typeof events>()
  for (const e of events) {
    const arr = eventsByReq.get(e.req_id) ?? []
    arr.push(e)
    eventsByReq.set(e.req_id, arr)
  }
  for (const arr of eventsByReq.values()) {
    arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }

  // Per-stage total time and count across all reqs (for byStage rollup).
  const stageTotals = new Map<string, { totalDays: number; count: number }>()
  // Per-team and per-recruiter accumulators of fill durations + dominant stage.
  type Acc = {
    fillDays: number[]
    openCount: number
    filledCount: number
    stageDays: Map<string, number>
  }
  const byTeamAcc = new Map<string, Acc>()
  const byRecruiterAcc = new Map<string, Acc>()

  const ensure = (m: Map<string, Acc>, k: string): Acc => {
    let a = m.get(k)
    if (!a) {
      a = { fillDays: [], openCount: 0, filledCount: 0, stageDays: new Map() }
      m.set(k, a)
    }
    return a
  }

  for (const r of reqs) {
    const teamKey = r.team_id ?? 'unassigned'
    const recruiterKey = r.recruiter ?? 'unassigned'
    const teamAcc = ensure(byTeamAcc, teamKey)
    const recAcc = ensure(byRecruiterAcc, recruiterKey)

    const isFilled = r.status === 'filled' || r.status === 'closed'
    if (isFilled) {
      teamAcc.filledCount++
      recAcc.filledCount++
    } else {
      teamAcc.openCount++
      recAcc.openCount++
    }

    const evs = eventsByReq.get(r.id) ?? []
    // Stage durations from consecutive events.
    for (let i = 0; i < evs.length; i++) {
      const stage = evs[i].to_status
      const start = new Date(evs[i].created_at).getTime()
      const end = i + 1 < evs.length ? new Date(evs[i + 1].created_at).getTime() : null
      if (end === null) continue
      const days = Math.max(0, (end - start) / DAY_MS)
      const st = stageTotals.get(stage) ?? { totalDays: 0, count: 0 }
      st.totalDays += days
      st.count++
      stageTotals.set(stage, st)
      teamAcc.stageDays.set(stage, (teamAcc.stageDays.get(stage) ?? 0) + days)
      recAcc.stageDays.set(stage, (recAcc.stageDays.get(stage) ?? 0) + days)
    }

    // Overall fill duration = opened_at → fill event (or req.created_at fallback).
    if (isFilled) {
      const openedMs = r.opened_at ? new Date(r.opened_at).getTime() : new Date(r.created_at).getTime()
      const fillEvent = evs.find((e) => e.to_status === 'filled' || e.to_status === 'closed')
      const filledMs = fillEvent
        ? new Date(fillEvent.created_at).getTime()
        : evs.length
          ? new Date(evs[evs.length - 1].created_at).getTime()
          : null
      if (filledMs !== null && filledMs >= openedMs) {
        const days = (filledMs - openedMs) / DAY_MS
        teamAcc.fillDays.push(days)
        recAcc.fillDays.push(days)
      }
    }
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const dominantStage = (m: Map<string, number>): string => {
    let best = ''
    let bestDays = -1
    for (const [stage, days] of m) {
      if (days > bestDays) {
        bestDays = days
        best = stage
      }
    }
    return best
  }

  const byTeam = [...byTeamAcc.entries()].map(([teamId, a]) => ({
    team_id: teamId === 'unassigned' ? null : teamId,
    team_name: teamId === 'unassigned' ? 'Unassigned' : teamName.get(teamId) ?? teamId,
    avg_days_to_fill: Math.round(avg(a.fillDays) * 10) / 10,
    open_count: a.openCount,
    filled_count: a.filledCount,
    bottleneck_stage: dominantStage(a.stageDays),
  }))

  const byRecruiter = [...byRecruiterAcc.entries()].map(([recruiter, a]) => ({
    recruiter: recruiter === 'unassigned' ? null : recruiter,
    avg_days_to_fill: Math.round(avg(a.fillDays) * 10) / 10,
    open_count: a.openCount,
    filled_count: a.filledCount,
    bottleneck_stage: dominantStage(a.stageDays),
  }))

  const byStage = STAGE_ORDER.filter((s) => stageTotals.has(s))
    .map((s) => {
      const st = stageTotals.get(s)!
      return {
        stage: s,
        avg_days: Math.round((st.count ? st.totalDays / st.count : 0) * 10) / 10,
        observations: st.count,
        total_days: Math.round(st.totalDays * 10) / 10,
      }
    })
    .sort((a, b) => b.avg_days - a.avg_days)

  return c.json({ byTeam, byRecruiter, byStage })
})

// ── POST /compute — auth — recompute time-to-fill metrics, persist rows ─────
const computeSchema = z.object({
  workspace_id: z.string().min(1),
  period_label: z.string().optional().default(''),
})

router.post('/compute', authMiddleware, zValidator('json', computeSchema), async (c) => {
  const userId = getUserId(c)
  const { workspace_id, period_label } = c.req.valid('json')
  if (!(await isMember(workspace_id, userId))) return c.json({ error: 'Forbidden' }, 403)

  const reqs = await db
    .select()
    .from(requisitions)
    .where(eq(requisitions.workspace_id, workspace_id))
  const events = await db
    .select()
    .from(req_events)
    .where(eq(req_events.workspace_id, workspace_id))

  const eventsByReq = new Map<string, typeof events>()
  for (const e of events) {
    const arr = eventsByReq.get(e.req_id) ?? []
    arr.push(e)
    eventsByReq.set(e.req_id, arr)
  }
  for (const arr of eventsByReq.values()) {
    arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  }

  // Group reqs by (team_id, level) — the granularity velocity_metrics stores.
  type Group = {
    team_id: string | null
    level: string | null
    recruiter: string | null
    fillDays: number[]
    open: number
    filled: number
    stageDays: Map<string, number>
  }
  const groups = new Map<string, Group>()
  const keyOf = (teamId: string | null, level: string | null) =>
    `${teamId ?? '∅'}::${level ?? '∅'}`

  for (const r of reqs) {
    const k = keyOf(r.team_id ?? null, r.level ?? null)
    let g = groups.get(k)
    if (!g) {
      g = {
        team_id: r.team_id ?? null,
        level: r.level ?? null,
        recruiter: r.recruiter ?? null,
        fillDays: [],
        open: 0,
        filled: 0,
        stageDays: new Map(),
      }
      groups.set(k, g)
    }

    const isFilled = r.status === 'filled' || r.status === 'closed'
    if (isFilled) g.filled++
    else g.open++

    const evs = eventsByReq.get(r.id) ?? []
    for (let i = 0; i + 1 < evs.length; i++) {
      const stage = evs[i].to_status
      const days = Math.max(
        0,
        (new Date(evs[i + 1].created_at).getTime() - new Date(evs[i].created_at).getTime()) / DAY_MS,
      )
      g.stageDays.set(stage, (g.stageDays.get(stage) ?? 0) + days)
    }

    if (isFilled) {
      const openedMs = r.opened_at ? new Date(r.opened_at).getTime() : new Date(r.created_at).getTime()
      const fillEvent = evs.find((e) => e.to_status === 'filled' || e.to_status === 'closed')
      const filledMs = fillEvent
        ? new Date(fillEvent.created_at).getTime()
        : evs.length
          ? new Date(evs[evs.length - 1].created_at).getTime()
          : null
      if (filledMs !== null && filledMs >= openedMs) {
        g.fillDays.push((filledMs - openedMs) / DAY_MS)
      }
    }
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
  const dominantStage = (m: Map<string, number>): string => {
    let best = ''
    let bestDays = -1
    for (const [stage, days] of m) {
      if (days > bestDays) {
        bestDays = days
        best = stage
      }
    }
    return best
  }

  // Replace prior metrics for this workspace so the table reflects the latest run.
  await db.delete(velocity_metrics).where(eq(velocity_metrics.workspace_id, workspace_id))

  const created: typeof velocity_metrics.$inferSelect[] = []
  for (const g of groups.values()) {
    const [row] = await db
      .insert(velocity_metrics)
      .values({
        workspace_id,
        team_id: g.team_id,
        level: g.level,
        recruiter: g.recruiter,
        avg_days_to_fill: Math.round(avg(g.fillDays) * 10) / 10,
        open_count: g.open,
        filled_count: g.filled,
        bottleneck_stage: dominantStage(g.stageDays),
        period_label,
      })
      .returning()
    created.push(row)
  }

  return c.json(created, 201)
})

export default router
