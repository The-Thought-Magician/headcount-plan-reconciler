'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Team = { id: string; name: string; cost_center?: string | null }

type Kpis = {
  net_headcount?: number
  planned_headcount?: number
  filled_headcount?: number
  open_headcount?: number
  burn?: number
  budget?: number
  burn_variance?: number
  open_ghost_reqs?: number
  [k: string]: number | undefined
}
type TopVariance = {
  team_id?: string | null
  team_name?: string
  label?: string
  planned?: number
  actual?: number
  variance: number
  [k: string]: unknown
}
type TrendPoint = {
  period_label?: string
  label?: string
  planned?: number
  filled?: number
  open?: number
  net?: number
  burn?: number
  budget?: number
  [k: string]: unknown
}
type DashboardReport = {
  kpis: Kpis
  topVariances: TopVariance[]
  trend: TrendPoint[]
}

type TeamCell = {
  level?: string | number
  quarter?: number | string
  planned_count?: number
  open_count?: number
  filled_count?: number
  count_variance?: number
  cost_variance?: number
  status?: string
  [k: string]: unknown
}
type TeamCost = {
  budget?: number
  planned?: number
  actual?: number
  variance?: number
  [k: string]: unknown
}
type TeamReport = {
  team: Team & Record<string, unknown>
  cells: TeamCell[]
  cost: TeamCost
}

type TrendReport = {
  periods: TrendPoint[]
}

const WS_KEY = 'hpr_ws'

function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtNum(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  return Number(n).toLocaleString('en-US')
}
function periodLabel(p: TrendPoint) {
  return p.period_label ?? p.label ?? '—'
}

function statusTone(status?: string): 'green' | 'amber' | 'rose' | 'sky' | 'slate' {
  const s = (status ?? '').toLowerCase()
  if (s.includes('over')) return 'rose'
  if (s.includes('under')) return 'amber'
  if (s.includes('match') || s.includes('on') || s === 'ok') return 'green'
  if (s.includes('open')) return 'sky'
  return 'slate'
}

export default function ReportsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([])
  const [wsId, setWsId] = useState<string>('')

  const [teams, setTeams] = useState<Team[]>([])
  const [dashboard, setDashboard] = useState<DashboardReport | null>(null)
  const [trend, setTrend] = useState<TrendPoint[]>([])

  const [selectedTeam, setSelectedTeam] = useState<string>('')
  const [teamReport, setTeamReport] = useState<TeamReport | null>(null)
  const [teamLoading, setTeamLoading] = useState(false)
  const [teamSearch, setTeamSearch] = useState('')
  const [trendMetric, setTrendMetric] = useState<'headcount' | 'burn'>('headcount')

  const teamName = useCallback(
    (id: string | null | undefined) => (id ? teams.find((t) => t.id === id)?.name ?? 'Unknown team' : 'Unassigned'),
    [teams],
  )

  const loadWorkspaces = useCallback(async () => {
    const ws = (await api.listWorkspaces()) as { id: string; name: string }[]
    setWorkspaces(ws || [])
    if (!ws || ws.length === 0) {
      setWsId('')
      return ''
    }
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
    const chosen = stored && ws.some((w) => w.id === stored) ? stored : ws[0].id
    setWsId(chosen)
    return chosen
  }, [])

  const loadData = useCallback(async (workspaceId: string) => {
    if (!workspaceId) {
      setTeams([])
      setDashboard(null)
      setTrend([])
      return
    }
    const [d, t, tr] = await Promise.all([
      api.getDashboardReport(workspaceId) as Promise<DashboardReport>,
      api.listTeams(workspaceId) as Promise<Team[]>,
      api.getTrendReport(workspaceId) as Promise<TrendReport>,
    ])
    setDashboard(d || null)
    setTeams(t || [])
    setTrend((tr && tr.periods) || [])
  }, [])

  const loadTeamReport = useCallback(
    async (teamId: string, workspaceId: string) => {
      if (!teamId || !workspaceId) {
        setTeamReport(null)
        return
      }
      setTeamLoading(true)
      try {
        const r = (await api.getTeamReport(teamId, workspaceId)) as TeamReport
        setTeamReport(r || null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load team report')
        setTeamReport(null)
      } finally {
        setTeamLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const chosen = await loadWorkspaces()
        if (chosen) await loadData(chosen)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load reports')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadWorkspaces, loadData])

  const onSelectWorkspace = async (id: string) => {
    setWsId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, id)
    setSelectedTeam('')
    setTeamReport(null)
    setLoading(true)
    try {
      await loadData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }

  const onSelectTeam = async (id: string) => {
    setSelectedTeam(id)
    if (id) await loadTeamReport(id, wsId)
    else setTeamReport(null)
  }

  const kpis = dashboard?.kpis ?? {}
  const topVariances = dashboard?.topVariances ?? []

  const netHeadcount = kpis.net_headcount ?? kpis.net ?? undefined
  const plannedHc = kpis.planned_headcount ?? kpis.planned ?? undefined
  const filledHc = kpis.filled_headcount ?? kpis.filled ?? undefined
  const openHc = kpis.open_headcount ?? kpis.open ?? undefined
  const burn = kpis.burn ?? kpis.projected_year_end_cost ?? undefined
  const budget = kpis.budget ?? kpis.budget_total ?? undefined
  const burnVariance =
    kpis.burn_variance ?? (burn !== undefined && budget !== undefined ? burn - budget : undefined)
  const ghostReqs = kpis.open_ghost_reqs ?? kpis.ghost_reqs ?? undefined

  const filteredTeams = useMemo(() => {
    const q = teamSearch.trim().toLowerCase()
    if (!q) return teams
    return teams.filter(
      (t) => t.name.toLowerCase().includes(q) || (t.cost_center ?? '').toLowerCase().includes(q),
    )
  }, [teams, teamSearch])

  const trendMax = useMemo(() => {
    if (trend.length === 0) return 1
    const vals = trend.map((p) => {
      if (trendMetric === 'burn') return Math.max(Number(p.burn ?? 0), Number(p.budget ?? 0))
      return Math.max(Number(p.planned ?? 0), Number(p.filled ?? 0), Number(p.net ?? 0))
    })
    return Math.max(...vals, 1)
  }, [trend, trendMetric])

  if (loading) return <PageSpinner label="Loading reports..." />

  if (!loading && workspaces.length === 0) {
    return (
      <div className="space-y-6">
        <Header workspaces={workspaces} wsId={wsId} onSelectWorkspace={onSelectWorkspace} />
        <EmptyState
          title="No workspace yet"
          description="Create a workspace from the Workspaces page, then seed sample data to populate reconciliation and trend reports."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header workspaces={workspaces} wsId={wsId} onSelectWorkspace={onSelectWorkspace} />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Exec KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Net Headcount"
          value={fmtNum(netHeadcount)}
          tone="sky"
          hint={plannedHc !== undefined ? `${fmtNum(plannedHc)} planned` : undefined}
        />
        <Stat
          label="Filled / Open"
          value={`${fmtNum(filledHc)} / ${fmtNum(openHc)}`}
          tone="default"
          hint="filled positions vs open reqs"
        />
        <Stat
          label="Burn vs Budget"
          value={fmtMoney(burn)}
          tone={burnVariance !== undefined ? (burnVariance > 0 ? 'rose' : 'green') : 'default'}
          hint={
            burnVariance !== undefined
              ? `${burnVariance >= 0 ? '+' : ''}${fmtMoney(burnVariance)} vs ${fmtMoney(budget)}`
              : budget !== undefined
                ? `budget ${fmtMoney(budget)}`
                : undefined
          }
        />
        <Stat
          label="Open Ghost Reqs"
          value={fmtNum(ghostReqs)}
          tone={ghostReqs && ghostReqs > 0 ? 'amber' : 'green'}
          hint="reqs with no plan line / overdue"
        />
      </div>

      {/* Trend report */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Trend Over Periods</h2>
            <p className="mt-0.5 text-xs text-slate-500">Headcount and burn trajectory across fiscal periods.</p>
          </div>
          <div className="inline-flex rounded-lg border border-slate-700 bg-slate-900 p-0.5 text-xs">
            <button
              onClick={() => setTrendMetric('headcount')}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                trendMetric === 'headcount' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Headcount
            </button>
            <button
              onClick={() => setTrendMetric('burn')}
              className={`rounded-md px-3 py-1.5 font-medium transition-colors ${
                trendMetric === 'burn' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Burn
            </button>
          </div>
        </CardHeader>
        <CardBody>
          {trend.length === 0 ? (
            <p className="text-sm text-slate-500">No trend data yet. Run reconciliations and burn forecasts to populate this chart.</p>
          ) : (
            <div className="space-y-5">
              {/* SVG line/bar chart */}
              <div className="w-full overflow-x-auto">
                <div className="flex min-w-[480px] items-end gap-3" style={{ height: 200 }}>
                  {trend.map((p, i) => {
                    if (trendMetric === 'burn') {
                      const burnPct = Math.max(2, Math.round((Number(p.burn ?? 0) / trendMax) * 100))
                      const budgetPct = Math.max(2, Math.round((Number(p.budget ?? 0) / trendMax) * 100))
                      return (
                        <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                          <div className="flex w-full items-end justify-center gap-1" style={{ height: 160 }}>
                            <div
                              className="w-3 rounded-t bg-sky-500"
                              style={{ height: `${burnPct}%` }}
                              title={`Burn ${fmtMoney(p.burn ?? 0)}`}
                            />
                            <div
                              className="w-3 rounded-t bg-slate-600"
                              style={{ height: `${budgetPct}%` }}
                              title={`Budget ${fmtMoney(p.budget ?? 0)}`}
                            />
                          </div>
                          <span className="truncate text-[10px] text-slate-500">{periodLabel(p)}</span>
                        </div>
                      )
                    }
                    const plannedPct = Math.max(2, Math.round((Number(p.planned ?? 0) / trendMax) * 100))
                    const filledPct = Math.max(2, Math.round((Number(p.filled ?? 0) / trendMax) * 100))
                    return (
                      <div key={i} className="flex flex-1 flex-col items-center justify-end gap-1">
                        <div className="flex w-full items-end justify-center gap-1" style={{ height: 160 }}>
                          <div
                            className="w-3 rounded-t bg-indigo-400"
                            style={{ height: `${plannedPct}%` }}
                            title={`Planned ${fmtNum(p.planned ?? 0)}`}
                          />
                          <div
                            className="w-3 rounded-t bg-emerald-400"
                            style={{ height: `${filledPct}%` }}
                            title={`Filled ${fmtNum(p.filled ?? 0)}`}
                          />
                        </div>
                        <span className="truncate text-[10px] text-slate-500">{periodLabel(p)}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                {trendMetric === 'burn' ? (
                  <>
                    <LegendDot color="bg-sky-500" label="Burn" />
                    <LegendDot color="bg-slate-600" label="Budget" />
                  </>
                ) : (
                  <>
                    <LegendDot color="bg-indigo-400" label="Planned" />
                    <LegendDot color="bg-emerald-400" label="Filled" />
                  </>
                )}
              </div>
              {/* Trend table */}
              <Table>
                <THead>
                  <TR>
                    <TH>Period</TH>
                    <TH className="text-right">Planned</TH>
                    <TH className="text-right">Filled</TH>
                    <TH className="text-right">Open</TH>
                    <TH className="text-right">Net</TH>
                    <TH className="text-right">Burn</TH>
                    <TH className="text-right">Budget</TH>
                  </TR>
                </THead>
                <TBody>
                  {trend.map((p, i) => (
                    <TR key={i}>
                      <TD className="font-medium text-slate-200">{periodLabel(p)}</TD>
                      <TD className="text-right">{fmtNum(p.planned)}</TD>
                      <TD className="text-right">{fmtNum(p.filled)}</TD>
                      <TD className="text-right">{fmtNum(p.open)}</TD>
                      <TD className="text-right">{fmtNum(p.net)}</TD>
                      <TD className="text-right">{fmtMoney(p.burn)}</TD>
                      <TD className="text-right">{fmtMoney(p.budget)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Top variances */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-100">Top Variances</h2>
          <p className="mt-0.5 text-xs text-slate-500">Largest cost variances vs budget across the workspace.</p>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {topVariances.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No variances recorded"
                description="Variances appear once reconciliation runs compare plan, open, and filled against budget."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Team / Line</TH>
                  <TH className="text-right">Planned</TH>
                  <TH className="text-right">Actual</TH>
                  <TH className="text-right">Variance</TH>
                  <TH>Direction</TH>
                </TR>
              </THead>
              <TBody>
                {topVariances.map((v, i) => (
                  <TR key={i}>
                    <TD className="font-medium text-slate-200">
                      {v.team_name ?? v.label ?? teamName(v.team_id ?? null)}
                    </TD>
                    <TD className="text-right">{fmtMoney(v.planned)}</TD>
                    <TD className="text-right">{fmtMoney(v.actual)}</TD>
                    <TD className="text-right">
                      <span className={v.variance > 0 ? 'text-rose-300' : v.variance < 0 ? 'text-emerald-300' : 'text-slate-400'}>
                        {v.variance >= 0 ? '+' : ''}
                        {fmtMoney(v.variance)}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={v.variance > 0 ? 'rose' : v.variance < 0 ? 'green' : 'slate'}>
                        {v.variance > 0 ? 'Over budget' : v.variance < 0 ? 'Under budget' : 'On budget'}
                      </Badge>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Per-team reconciliation report */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Per-Team Reconciliation</h2>
            <p className="mt-0.5 text-xs text-slate-500">Drill into a team&apos;s plan / open / filled cells and cost.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={teamSearch}
              onChange={(e) => setTeamSearch(e.target.value)}
              placeholder="Search teams"
              className="w-44 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
            <select
              value={selectedTeam}
              onChange={(e) => onSelectTeam(e.target.value)}
              className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="">Select a team…</option>
              {filteredTeams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.cost_center ? ` · ${t.cost_center}` : ''}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {teams.length === 0 ? (
            <p className="text-sm text-slate-500">No teams in this workspace yet.</p>
          ) : !selectedTeam ? (
            <p className="text-sm text-slate-500">Select a team above to view its reconciliation report.</p>
          ) : teamLoading ? (
            <PageSpinner label="Loading team report..." />
          ) : !teamReport ? (
            <p className="text-sm text-slate-500">No report available for this team.</p>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Stat label="Budget" value={fmtMoney(teamReport.cost?.budget)} tone="sky" />
                <Stat label="Planned Cost" value={fmtMoney(teamReport.cost?.planned)} />
                <Stat label="Actual Cost" value={fmtMoney(teamReport.cost?.actual)} />
                <Stat
                  label="Cost Variance"
                  value={fmtMoney(teamReport.cost?.variance)}
                  tone={
                    teamReport.cost?.variance !== undefined
                      ? Number(teamReport.cost.variance) > 0
                        ? 'rose'
                        : Number(teamReport.cost.variance) < 0
                          ? 'green'
                          : 'default'
                      : 'default'
                  }
                />
              </div>

              {teamReport.cells && teamReport.cells.length > 0 ? (
                <Table>
                  <THead>
                    <TR>
                      <TH>Level</TH>
                      <TH className="text-right">Quarter</TH>
                      <TH className="text-right">Planned</TH>
                      <TH className="text-right">Open</TH>
                      <TH className="text-right">Filled</TH>
                      <TH className="text-right">Count Var</TH>
                      <TH className="text-right">Cost Var</TH>
                      <TH>Status</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {teamReport.cells.map((c, i) => {
                      const cv = Number(c.count_variance ?? 0)
                      const costv = Number(c.cost_variance ?? 0)
                      return (
                        <TR key={i}>
                          <TD className="font-medium text-slate-200">{c.level ?? '—'}</TD>
                          <TD className="text-right">{c.quarter ? `Q${c.quarter}` : '—'}</TD>
                          <TD className="text-right">{fmtNum(c.planned_count)}</TD>
                          <TD className="text-right">{fmtNum(c.open_count)}</TD>
                          <TD className="text-right">{fmtNum(c.filled_count)}</TD>
                          <TD className="text-right">
                            <span className={cv > 0 ? 'text-emerald-300' : cv < 0 ? 'text-rose-300' : 'text-slate-400'}>
                              {cv >= 0 ? '+' : ''}
                              {fmtNum(cv)}
                            </span>
                          </TD>
                          <TD className="text-right">
                            <span className={costv > 0 ? 'text-rose-300' : costv < 0 ? 'text-emerald-300' : 'text-slate-400'}>
                              {costv >= 0 ? '+' : ''}
                              {fmtMoney(costv)}
                            </span>
                          </TD>
                          <TD>
                            {c.status ? <Badge tone={statusTone(c.status)}>{c.status}</Badge> : <span className="text-slate-600">—</span>}
                          </TD>
                        </TR>
                      )
                    })}
                  </TBody>
                </Table>
              ) : (
                <EmptyState
                  title="No reconciliation cells"
                  description="Run a reconciliation for a plan covering this team to populate per-level, per-quarter cells."
                />
              )}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Header({
  workspaces,
  wsId,
  onSelectWorkspace,
}: {
  workspaces: { id: string; name: string }[]
  wsId: string
  onSelectWorkspace: (id: string) => void
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Reports</h1>
        <p className="mt-0.5 text-sm text-slate-500">Exec KPIs, per-team reconciliation, and headcount / burn trends.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {workspaces.length > 1 && (
          <select
            value={wsId}
            onChange={(e) => onSelectWorkspace(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  )
}
