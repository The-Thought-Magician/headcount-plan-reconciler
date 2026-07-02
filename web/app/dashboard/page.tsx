'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'hpr.workspace_id'

type Workspace = { id: string; name: string; currency?: string; fiscal_year_start_month?: number }

type DashboardReport = {
  kpis?: Record<string, number | string | null>
  topVariances?: Array<{
    team_id?: string
    team_name?: string
    label?: string
    level?: string
    quarter?: string
    count_variance?: number
    cost_variance?: number
    status?: string
  }>
  trend?: Array<{ period_label?: string; label?: string; planned?: number; filled?: number; cost?: number; burn?: number }>
}

type NetHeadcount = { growth?: number; backfill?: number; terminations?: number; net?: number }

type GhostReq = { id: string; status?: string; severity?: string; reason?: string; days_overdue?: number }

function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'string' ? parseFloat(v) : (v as number)
  return Number.isFinite(n) ? (n as number) : fallback
}

function money(v: unknown): string {
  const n = num(v)
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}k`
  return `$${n.toLocaleString()}`
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n.toLocaleString()}`
}

export default function DashboardPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [report, setReport] = useState<DashboardReport | null>(null)
  const [net, setNet] = useState<NetHeadcount | null>(null)
  const [ghosts, setGhosts] = useState<GhostReq[]>([])
  const [seeding, setSeeding] = useState(false)

  const loadReport = useCallback(async (wsId: string) => {
    setError('')
    try {
      const [rep, nh, gr] = await Promise.all([
        api.getDashboardReport(wsId),
        api.getNetHeadcount(wsId),
        api.listGhostReqs(wsId),
      ])
      setReport(rep || {})
      setNet(nh || {})
      setGhosts(Array.isArray(gr) ? gr : [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load dashboard')
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoading(true)
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        if (!mounted) return
        const list = Array.isArray(ws) ? ws : []
        setWorkspaces(list)
        if (list.length) {
          const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
          const active = list.find((w) => w.id === stored) ?? list[0]
          setWorkspaceId(active.id)
          if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, active.id)
          await loadReport(active.id)
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load workspaces')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadReport])

  const onSelectWorkspace = async (id: string) => {
    setWorkspaceId(id)
    if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, id)
    setLoading(true)
    await loadReport(id)
    setLoading(false)
  }

  const onSeed = async () => {
    setSeeding(true)
    setError('')
    try {
      const res = await api.seedSample(workspaceId ? { workspace_id: workspaceId } : undefined)
      const newWsId = (res && (res.workspace_id as string)) || workspaceId
      const ws: Workspace[] = await api.listWorkspaces()
      const list = Array.isArray(ws) ? ws : []
      setWorkspaces(list)
      const active = list.find((w) => w.id === newWsId) ?? list[0]
      if (active) {
        setWorkspaceId(active.id)
        if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, active.id)
        await loadReport(active.id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to seed sample data')
    } finally {
      setSeeding(false)
    }
  }

  if (loading) return <PageSpinner label="Loading dashboard..." />

  if (!workspaces.length) {
    return (
      <div className="space-y-6">
        <Header
          workspaces={workspaces}
          workspaceId={workspaceId}
          onSelect={onSelectWorkspace}
        />
        {error && <ErrorBanner message={error} />}
        <EmptyState
          title="No workspace yet"
          description="Spin up a realistic sample company (teams, plan, requisitions, hires, terminations, budget) to explore the reconciler, or create a workspace from the Workspaces page."
          action={
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button onClick={onSeed} disabled={seeding}>
                {seeding ? 'Seeding sample...' : 'Seed sample company'}
              </Button>
              <Link href="/dashboard/workspaces">
                <Button variant="secondary">Create workspace</Button>
              </Link>
            </div>
          }
        />
      </div>
    )
  }

  const kpis = report?.kpis ?? {}
  const plannedHc = num(kpis.planned_headcount ?? kpis.plannedHeadcount ?? kpis.total_planned)
  const actualHc = num(kpis.actual_headcount ?? kpis.filled_headcount ?? kpis.actualHeadcount ?? kpis.total_filled)
  const hcVariance = actualHc - plannedHc
  const budgetTotal = num(kpis.budget_total ?? kpis.budgetTotal ?? kpis.budget)
  const burnTotal = num(kpis.burn_total ?? kpis.projected_burn ?? kpis.burnTotal ?? kpis.actual_cost ?? kpis.burn)
  const budgetVariance = burnTotal - budgetTotal
  const openGhosts = ghosts.filter((g) => (g.status ?? 'open') === 'open').length
  const variances = (report?.topVariances ?? []).slice(0, 8)
  const trend = report?.trend ?? []

  const hcPct = budgetTotal || plannedHc ? Math.min(100, plannedHc ? (actualHc / plannedHc) * 100 : 0) : 0
  const burnPct = budgetTotal ? Math.min(140, (burnTotal / budgetTotal) * 100) : 0

  return (
    <div className="space-y-6">
      <Header workspaces={workspaces} workspaceId={workspaceId} onSelect={onSelectWorkspace} seedSlot={
        <Button variant="secondary" size="sm" onClick={onSeed} disabled={seeding}>
          {seeding ? 'Seeding...' : 'Seed sample'}
        </Button>
      } />

      {error && <ErrorBanner message={error} />}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Planned headcount"
          value={plannedHc.toLocaleString()}
          hint={`Actual filled ${actualHc.toLocaleString()}`}
          tone="sky"
        />
        <Stat
          label="Net vs plan"
          value={signed(hcVariance)}
          hint={hcVariance < 0 ? 'Under plan' : hcVariance > 0 ? 'Over plan' : 'On plan'}
          tone={hcVariance < 0 ? 'amber' : hcVariance > 0 ? 'rose' : 'green'}
        />
        <Stat
          label="Burn vs budget"
          value={money(burnTotal)}
          hint={`Budget ${money(budgetTotal)} · ${budgetVariance > 0 ? '+' : ''}${money(budgetVariance)}`}
          tone={budgetVariance > 0 ? 'rose' : 'green'}
        />
        <Stat
          label="Open ghost reqs"
          value={openGhosts.toLocaleString()}
          hint={`${ghosts.length} total findings`}
          tone={openGhosts > 0 ? 'amber' : 'green'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Net headcount vs plan</h2>
            <Link href="/dashboard/backfills" className="text-xs text-teal-400 hover:text-teal-300">
              Backfill classifier
            </Link>
          </CardHeader>
          <CardBody className="space-y-4">
            <Bar label="Actual filled" value={actualHc} max={Math.max(plannedHc, actualHc, 1)} tone="bg-teal-500" suffix=" HC" />
            <Bar label="Planned" value={plannedHc} max={Math.max(plannedHc, actualHc, 1)} tone="bg-zinc-600" suffix=" HC" />
            <div className="grid grid-cols-3 gap-3 border-t border-zinc-800 pt-4">
              <MiniStat label="Growth" value={signed(num(net?.growth))} tone="text-teal-300" />
              <MiniStat label="Backfill" value={num(net?.backfill).toLocaleString()} tone="text-zinc-300" />
              <MiniStat label="Terms" value={signed(-Math.abs(num(net?.terminations)))} tone="text-rose-300" />
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Net headcount change</div>
              <div className="mt-1 text-2xl font-semibold text-zinc-100">{signed(num(net?.net))}</div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-zinc-100">Burn vs budget</h2>
            <Link href="/dashboard/burn-forecast" className="text-xs text-teal-400 hover:text-teal-300">
              Burn forecast
            </Link>
          </CardHeader>
          <CardBody className="space-y-4">
            <Bar label="Projected burn" value={burnTotal} max={Math.max(budgetTotal, burnTotal, 1)} tone={budgetVariance > 0 ? 'bg-rose-500' : 'bg-emerald-500'} suffix="" money />
            <Bar label="Budget" value={budgetTotal} max={Math.max(budgetTotal, burnTotal, 1)} tone="bg-zinc-600" suffix="" money />
            <div className="flex items-center justify-between border-t border-zinc-800 pt-4 text-sm">
              <span className="text-zinc-400">Variance</span>
              <Badge tone={budgetVariance > 0 ? 'rose' : 'green'}>
                {budgetVariance > 0 ? 'Over budget' : 'Within budget'} · {budgetVariance > 0 ? '+' : ''}
                {money(budgetVariance)}
              </Badge>
            </div>
            <div className="text-xs text-zinc-500">
              Plan attainment {hcPct.toFixed(0)}% · Budget utilization {burnPct.toFixed(0)}%
            </div>
          </CardBody>
        </Card>
      </div>

      {trend.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">Headcount &amp; burn trend</h2>
          </CardHeader>
          <CardBody>
            <TrendChart trend={trend} />
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Top variances</h2>
          <Link href="/dashboard/reconciliation" className="text-xs text-teal-400 hover:text-teal-300">
            Three-way reconciliation
          </Link>
        </CardHeader>
        <CardBody className="!px-0 !py-0">
          {variances.length === 0 ? (
            <div className="px-5 py-10">
              <EmptyState
                title="No variances detected"
                description="Run a reconciliation to surface count and cost variances by team and level."
                action={
                  <Link href="/dashboard/reconciliation">
                    <Button size="sm">Open reconciliation</Button>
                  </Link>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH className="pl-5">Team</TH>
                  <TH>Level</TH>
                  <TH>Quarter</TH>
                  <TH className="text-right">Count var</TH>
                  <TH className="pr-5 text-right">Cost var</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {variances.map((v, i) => {
                  const cv = num(v.count_variance)
                  const cost = num(v.cost_variance)
                  return (
                    <TR key={`${v.team_id ?? v.label ?? i}-${i}`}>
                      <TD className="pl-5 font-medium text-zinc-200">{v.team_name ?? v.label ?? '—'}</TD>
                      <TD>{v.level ?? '—'}</TD>
                      <TD>{v.quarter ?? '—'}</TD>
                      <TD className={`text-right ${cv < 0 ? 'text-amber-300' : cv > 0 ? 'text-rose-300' : 'text-zinc-400'}`}>
                        {signed(cv)}
                      </TD>
                      <TD className={`pr-5 text-right ${cost > 0 ? 'text-rose-300' : cost < 0 ? 'text-emerald-300' : 'text-zinc-400'}`}>
                        {cost > 0 ? '+' : ''}
                        {money(cost)}
                      </TD>
                      <TD>
                        <Badge tone={varianceTone(v.status, cv, cost)}>{v.status ?? statusFromVar(cv, cost)}</Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Ghost requisitions</h2>
          <Link href="/dashboard/ghost-reqs" className="text-xs text-teal-400 hover:text-teal-300">
            Triage queue
          </Link>
        </CardHeader>
        <CardBody>
          {ghosts.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No ghost requisitions found. Scan from the triage queue to detect reqs with no plan line, past fill-by date, or
              abandoned status.
            </p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
                const count = ghosts.filter((g) => (g.severity ?? '').toLowerCase() === sev).length
                if (!count) return null
                return (
                  <div key={sev} className="rounded-lg border border-zinc-800 bg-zinc-950/40 px-4 py-3">
                    <div className="text-xs uppercase tracking-wide text-zinc-500">{sev}</div>
                    <div className="mt-0.5 text-lg font-semibold text-zinc-100">{count}</div>
                  </div>
                )
              })}
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                <div className="text-xs uppercase tracking-wide text-amber-300/80">Open</div>
                <div className="mt-0.5 text-lg font-semibold text-amber-200">{openGhosts}</div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function statusFromVar(cv: number, cost: number): string {
  if (cv < 0 || cost > 0) return 'over'
  if (cv > 0) return 'under'
  return 'on-plan'
}

function varianceTone(status: string | undefined, cv: number, cost: number): 'rose' | 'amber' | 'green' | 'sky' {
  const s = (status ?? statusFromVar(cv, cost)).toLowerCase()
  if (s.includes('over')) return 'rose'
  if (s.includes('under')) return 'amber'
  if (s.includes('on')) return 'green'
  return 'sky'
}

function Header({
  workspaces,
  workspaceId,
  onSelect,
  seedSlot,
}: {
  workspaces: Workspace[]
  workspaceId: string
  onSelect: (id: string) => void
  seedSlot?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Executive overview</h1>
        <p className="mt-1 text-sm text-zinc-500">Plan, pipeline, and actuals reconciled in one place.</p>
      </div>
      <div className="flex items-center gap-3">
        {workspaces.length > 0 && (
          <select
            value={workspaceId}
            onChange={(e) => onSelect(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        {seedSlot}
      </div>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-rose-700 bg-rose-900/30 px-4 py-3 text-sm text-rose-300">{message}</div>
  )
}

function Bar({
  label,
  value,
  max,
  tone,
  suffix = '',
  money: isMoney,
}: {
  label: string
  value: number
  max: number
  tone: string
  suffix?: string
  money?: boolean
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className="font-medium text-zinc-200">{isMoney ? money(value) : `${value.toLocaleString()}${suffix}`}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-0.5 text-base font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

function TrendChart({ trend }: { trend: NonNullable<DashboardReport['trend']> }) {
  const points = trend.map((t) => ({
    label: t.period_label ?? t.label ?? '',
    planned: num(t.planned),
    filled: num(t.filled),
    cost: num(t.cost ?? t.burn),
  }))
  const maxHc = Math.max(1, ...points.map((p) => Math.max(p.planned, p.filled)))
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-[480px] items-end gap-4" style={{ height: 180 }}>
        {points.map((p, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-[150px] w-full items-end justify-center gap-1.5">
              <div
                className="w-3 rounded-t bg-zinc-600"
                style={{ height: `${(p.planned / maxHc) * 100}%` }}
                title={`Planned ${p.planned}`}
              />
              <div
                className="w-3 rounded-t bg-teal-500"
                style={{ height: `${(p.filled / maxHc) * 100}%` }}
                title={`Filled ${p.filled}`}
              />
            </div>
            <div className="truncate text-[10px] text-zinc-500">{p.label}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-zinc-600" /> Planned
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-teal-500" /> Filled
        </span>
      </div>
    </div>
  )
}
