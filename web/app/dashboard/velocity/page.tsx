'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'hpr.activeWorkspace'

type Workspace = { id: string; name: string }

type Velocity = {
  id: string
  workspace_id: string
  team_id: string | null
  level: string | null
  recruiter: string | null
  avg_days_to_fill: number | null
  open_count: number | null
  filled_count: number | null
  bottleneck_stage: string | null
  period_label: string | null
  created_at: string
}

type Attr = { label?: string; name?: string; key?: string; value?: number; count?: number; avg_days_to_fill?: number }

type Bottlenecks = {
  byTeam?: Attr[]
  byRecruiter?: Attr[]
  byStage?: Attr[]
}

function daysTone(d: number | null) {
  if (d === null || d === undefined) return 'slate' as const
  if (d <= 30) return 'green' as const
  if (d <= 60) return 'amber' as const
  return 'rose' as const
}

function attrLabel(a: Attr, i: number) {
  return a.label ?? a.name ?? a.key ?? `#${i + 1}`
}
function attrValue(a: Attr) {
  return Number(a.value ?? a.count ?? a.avg_days_to_fill ?? 0)
}

export default function VelocityPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [metrics, setMetrics] = useState<Velocity[]>([])
  const [bottlenecks, setBottlenecks] = useState<Bottlenecks | null>(null)

  const [search, setSearch] = useState('')
  const [groupBy, setGroupBy] = useState<'team' | 'recruiter' | 'level'>('team')

  const loadWorkspaces = useCallback(async () => {
    const ws: Workspace[] = await api.listWorkspaces()
    setWorkspaces(ws)
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
    const chosen = (stored && ws.find((w) => w.id === stored)?.id) || ws[0]?.id || ''
    setWsId(chosen)
    return chosen
  }, [])

  const loadData = useCallback(async (id: string) => {
    if (!id) {
      setMetrics([])
      setBottlenecks(null)
      return
    }
    const [vm, bn] = await Promise.all([api.listVelocity(id), api.getBottlenecks(id)])
    setMetrics(Array.isArray(vm) ? vm : [])
    setBottlenecks(bn ?? null)
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const id = await loadWorkspaces()
        if (!mounted) return
        await loadData(id)
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load velocity metrics')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadWorkspaces, loadData])

  const switchWorkspace = async (id: string) => {
    setWsId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, id)
    try {
      setLoading(true)
      setError(null)
      await loadData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load velocity metrics')
    } finally {
      setLoading(false)
    }
  }

  const compute = async () => {
    if (!wsId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.computeVelocity({ workspace_id: wsId })
      const count = Array.isArray(res) ? res.length : 0
      setNotice(`Recomputed ${count} velocity metric${count === 1 ? '' : 's'}.`)
      await loadData(wsId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compute failed')
    } finally {
      setBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return metrics
    return metrics.filter((m) =>
      [m.team_id, m.level, m.recruiter, m.bottleneck_stage, m.period_label].join(' ').toLowerCase().includes(q),
    )
  }, [metrics, search])

  const summary = useMemo(() => {
    const filledMetrics = metrics.filter((m) => m.avg_days_to_fill !== null && m.avg_days_to_fill !== undefined)
    const totalOpen = metrics.reduce((s, m) => s + (m.open_count ?? 0), 0)
    const totalFilled = metrics.reduce((s, m) => s + (m.filled_count ?? 0), 0)
    const avgFill =
      filledMetrics.length > 0
        ? filledMetrics.reduce((s, m) => s + (m.avg_days_to_fill ?? 0), 0) / filledMetrics.length
        : null
    const worst = filledMetrics.reduce<Velocity | null>(
      (acc, m) => (acc === null || (m.avg_days_to_fill ?? 0) > (acc.avg_days_to_fill ?? 0) ? m : acc),
      null,
    )
    // most common bottleneck stage
    const stageCounts = new Map<string, number>()
    for (const m of metrics) {
      if (m.bottleneck_stage) stageCounts.set(m.bottleneck_stage, (stageCounts.get(m.bottleneck_stage) ?? 0) + 1)
    }
    let topStage: string | null = null
    let topStageN = 0
    for (const [k, v] of stageCounts) {
      if (v > topStageN) {
        topStage = k
        topStageN = v
      }
    }
    return { totalOpen, totalFilled, avgFill, worst, topStage }
  }, [metrics])

  const activeAttr: Attr[] = useMemo(() => {
    if (!bottlenecks) return []
    if (groupBy === 'recruiter') return bottlenecks.byRecruiter ?? []
    if (groupBy === 'level') return bottlenecks.byStage ?? []
    return bottlenecks.byTeam ?? []
  }, [bottlenecks, groupBy])

  if (loading) return <PageSpinner label="Loading hiring velocity..." />

  if (!wsId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create a workspace and load requisition/hire data, then compute hiring velocity."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header
        right={
          <div className="flex items-center gap-2">
            {workspaces.length > 1 && (
              <select
                value={wsId}
                onChange={(e) => switchWorkspace(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
            <Button size="sm" onClick={compute} disabled={busy}>
              {busy ? 'Computing...' : 'Recompute velocity'}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300">{notice}</div>
      )}

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Avg days to fill"
          value={summary.avgFill !== null ? Math.round(summary.avgFill) : '—'}
          tone={daysTone(summary.avgFill)}
          hint="Across measured segments"
        />
        <Stat label="Open reqs" value={summary.totalOpen} tone="amber" />
        <Stat label="Filled" value={summary.totalFilled} tone="green" />
        <Stat
          label="Top bottleneck"
          value={summary.topStage ? <Badge tone="rose">{summary.topStage}</Badge> : '—'}
          hint={summary.worst ? `Slowest: ${summary.worst.avg_days_to_fill}d` : undefined}
        />
      </div>

      {/* Bottleneck attribution */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Bottleneck attribution</h2>
            <p className="text-xs text-zinc-500">Where time-to-fill concentrates across segments.</p>
          </div>
          <div className="inline-flex rounded-lg border border-zinc-700 bg-zinc-900 p-0.5 text-xs">
            {(['team', 'recruiter', 'level'] as const).map((g) => (
              <button
                key={g}
                onClick={() => setGroupBy(g)}
                className={`rounded-md px-3 py-1.5 capitalize transition-colors ${
                  groupBy === g ? 'bg-teal-500/15 text-teal-300' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {g === 'level' ? 'stage' : g}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardBody>
          {activeAttr.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-500">
              No attribution data yet. Recompute velocity after adding requisitions and hires.
            </p>
          ) : (
            <AttributionBars data={activeAttr} />
          )}
        </CardBody>
      </Card>

      {/* Detailed metrics table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Velocity metrics</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search team / recruiter / level / stage..."
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500 sm:w-72"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={metrics.length === 0 ? 'No velocity metrics yet' : 'No rows match your search'}
                description={
                  metrics.length === 0
                    ? 'Recompute time-to-fill from your requisition and hire pipeline.'
                    : 'Try a different search term.'
                }
                action={
                  metrics.length === 0 ? (
                    <Button size="sm" onClick={compute} disabled={busy}>
                      Recompute velocity
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH>Team</TH>
                  <TH>Level</TH>
                  <TH>Recruiter</TH>
                  <TH className="text-right">Avg days to fill</TH>
                  <TH className="text-right">Open</TH>
                  <TH className="text-right">Filled</TH>
                  <TH>Bottleneck</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((m) => (
                  <TR key={m.id}>
                    <TD>{m.period_label ?? '—'}</TD>
                    <TD className="font-mono text-xs text-zinc-400">{m.team_id ? m.team_id.slice(0, 8) : '—'}</TD>
                    <TD>{m.level ?? '—'}</TD>
                    <TD>{m.recruiter ?? '—'}</TD>
                    <TD className="text-right">
                      <Badge tone={daysTone(m.avg_days_to_fill)}>
                        {m.avg_days_to_fill !== null && m.avg_days_to_fill !== undefined
                          ? `${Math.round(m.avg_days_to_fill)}d`
                          : '—'}
                      </Badge>
                    </TD>
                    <TD className="text-right text-amber-300">{m.open_count ?? 0}</TD>
                    <TD className="text-right text-emerald-300">{m.filled_count ?? 0}</TD>
                    <TD>
                      {m.bottleneck_stage ? (
                        <span className="text-zinc-300">{m.bottleneck_stage}</span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Hiring Velocity</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Time-to-fill and bottleneck attribution across teams, recruiters, and pipeline stages.
        </p>
      </div>
      {right}
    </div>
  )
}

function AttributionBars({ data }: { data: Attr[] }) {
  const rows = data
    .map((a, i) => ({ label: attrLabel(a, i), value: attrValue(a) }))
    .sort((x, y) => y.value - x.value)
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <div className="space-y-2.5">
      {rows.map((r) => {
        const pct = (r.value / max) * 100
        const tone = pct >= 75 ? 'bg-rose-500/70' : pct >= 45 ? 'bg-amber-500/70' : 'bg-teal-500/70'
        return (
          <div key={r.label} className="flex items-center gap-3">
            <div className="w-32 shrink-0 truncate text-sm text-zinc-300" title={r.label}>
              {r.label}
            </div>
            <div className="h-5 flex-1 overflow-hidden rounded-md bg-zinc-800">
              <div className={`flex h-full items-center justify-end rounded-md ${tone} px-2`} style={{ width: `${Math.max(pct, 6)}%` }}>
                <span className="text-[11px] font-medium text-zinc-950">{Math.round(r.value)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
