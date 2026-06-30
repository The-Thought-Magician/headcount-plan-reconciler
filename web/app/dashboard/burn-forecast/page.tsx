'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'hpr.activeWorkspace'

type Workspace = { id: string; name: string }
type Plan = { id: string; name: string; fiscal_year: number; version: number; status: string }

type PeriodPoint = { period?: string; label?: string; quarter?: string; cost?: number; amount?: number; value?: number }

type Forecast = {
  id: string
  workspace_id: string
  plan_id: string | null
  fiscal_year: number
  scenario: string | null
  projected_year_end_cost: number | null
  budget_total: number | null
  variance: number | null
  by_period: PeriodPoint[] | Record<string, number> | null
  assumptions: Record<string, unknown> | null
  created_at: string
}

const SCENARIOS = ['base', 'conservative', 'aggressive'] as const

function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString()}`
}

function scenarioTone(s: string | null) {
  if (s === 'aggressive') return 'rose' as const
  if (s === 'conservative') return 'green' as const
  return 'sky' as const
}

function normalizePeriods(by: Forecast['by_period']): { label: string; cost: number }[] {
  if (!by) return []
  if (Array.isArray(by)) {
    return by.map((p, i) => ({
      label: p.period ?? p.label ?? p.quarter ?? `P${i + 1}`,
      cost: Number(p.cost ?? p.amount ?? p.value ?? 0),
    }))
  }
  return Object.entries(by).map(([label, cost]) => ({ label, cost: Number(cost) }))
}

export default function BurnForecastPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [forecasts, setForecasts] = useState<Forecast[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [selected, setSelected] = useState<Forecast | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [runOpen, setRunOpen] = useState(false)
  const [runPlanId, setRunPlanId] = useState('')
  const [runYear, setRunYear] = useState(String(new Date().getFullYear()))
  const [runScenario, setRunScenario] = useState<string>('base')

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
      setForecasts([])
      setPlans([])
      return
    }
    const [fc, pl] = await Promise.all([api.listBurnForecasts(id), api.listPlans(id)])
    const list: Forecast[] = Array.isArray(fc) ? fc : []
    const planList: Plan[] = Array.isArray(pl) ? pl : []
    setForecasts(list)
    setPlans(planList)
    if (planList[0]) setRunPlanId((cur) => cur || planList[0].id)
    setSelected((cur) => (cur ? list.find((f) => f.id === cur.id) ?? list[0] ?? null : list[0] ?? null))
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
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load forecasts')
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
    setSelected(null)
    try {
      setLoading(true)
      setError(null)
      await loadData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load forecasts')
    } finally {
      setLoading(false)
    }
  }

  const openDetail = async (f: Forecast) => {
    setSelected(f)
    setDetailLoading(true)
    try {
      const full = await api.getBurnForecast(f.id)
      setSelected(full)
    } catch {
      /* keep list row */
    } finally {
      setDetailLoading(false)
    }
  }

  const runForecast = async () => {
    if (!wsId || !runPlanId) {
      setError('Select a plan to run the forecast against.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const created: Forecast = await api.runBurnForecast({
        workspace_id: wsId,
        plan_id: runPlanId,
        fiscal_year: Number(runYear),
        scenario: runScenario,
      })
      setRunOpen(false)
      await loadData(wsId)
      if (created?.id) await openDetail(created)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Forecast run failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (f: Forecast) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this forecast run?')) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteBurnForecast(f.id)
      if (selected?.id === f.id) setSelected(null)
      await loadData(wsId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const planName = (id: string | null) => plans.find((p) => p.id === id)?.name ?? '—'

  const series = useMemo(() => normalizePeriods(selected?.by_period ?? null), [selected])

  if (loading) return <PageSpinner label="Loading burn forecast..." />

  if (!wsId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create a workspace and a headcount plan, then run a phased burn forecast."
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
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
            <Button size="sm" onClick={() => setRunOpen(true)} disabled={busy || plans.length === 0}>
              Run forecast
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {plans.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          No headcount plans exist yet. Create a plan before running a burn forecast.
        </div>
      )}

      {/* Selected forecast summary */}
      {selected && (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Projected year-end" value={fmtMoney(selected.projected_year_end_cost)} tone="sky" />
            <Stat label="Budget total" value={fmtMoney(selected.budget_total)} />
            <Stat
              label="Variance vs budget"
              value={fmtMoney(selected.variance)}
              tone={(selected.variance ?? 0) > 0 ? 'rose' : 'green'}
              hint={(selected.variance ?? 0) > 0 ? 'Over budget' : 'Under budget'}
            />
            <Stat
              label="Scenario"
              value={<Badge tone={scenarioTone(selected.scenario)}>{selected.scenario ?? 'base'}</Badge>}
              hint={`FY${selected.fiscal_year} · ${planName(selected.plan_id)}`}
            />
          </div>

          <Card>
            <CardHeader className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-200">Phased burn to year-end</h2>
              {detailLoading && <span className="text-xs text-slate-500">Loading detail...</span>}
            </CardHeader>
            <CardBody>
              {series.length === 0 ? (
                <p className="py-6 text-center text-sm text-slate-500">No phased data on this forecast run.</p>
              ) : (
                <BurnChart series={series} budget={selected.budget_total} />
              )}
            </CardBody>
          </Card>

          {selected.assumptions && Object.keys(selected.assumptions).length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-slate-200">Assumptions</h2>
              </CardHeader>
              <CardBody>
                <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  {Object.entries(selected.assumptions).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">{k.replace(/_/g, ' ')}</dt>
                      <dd className="text-slate-200">{String(v)}</dd>
                    </div>
                  ))}
                </dl>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {/* Runs list */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Forecast runs</h2>
        </CardHeader>
        <CardBody className="p-0">
          {forecasts.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No forecast runs yet"
                description="Run a phased burn-to-year-end forecast against a headcount plan and scenario."
                action={
                  plans.length > 0 ? (
                    <Button size="sm" onClick={() => setRunOpen(true)}>
                      Run forecast
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Plan</TH>
                  <TH>FY</TH>
                  <TH>Scenario</TH>
                  <TH className="text-right">Projected</TH>
                  <TH className="text-right">Budget</TH>
                  <TH className="text-right">Variance</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {forecasts.map((f) => {
                  const over = (f.variance ?? 0) > 0
                  return (
                    <TR
                      key={f.id}
                      className={`cursor-pointer ${selected?.id === f.id ? 'bg-slate-800/50' : ''}`}
                      onClick={() => openDetail(f)}
                    >
                      <TD className="font-medium text-slate-200">{planName(f.plan_id)}</TD>
                      <TD>{f.fiscal_year}</TD>
                      <TD>
                        <Badge tone={scenarioTone(f.scenario)}>{f.scenario ?? 'base'}</Badge>
                      </TD>
                      <TD className="text-right">{fmtMoney(f.projected_year_end_cost)}</TD>
                      <TD className="text-right">{fmtMoney(f.budget_total)}</TD>
                      <TD className={`text-right font-medium ${over ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {(f.variance ?? 0) > 0 ? '+' : ''}
                        {fmtMoney(f.variance)}
                      </TD>
                      <TD className="text-right" onClick={(e) => e.stopPropagation()}>
                        <Button size="sm" variant="ghost" onClick={() => remove(f)} disabled={busy}>
                          Delete
                        </Button>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Modal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        title="Run burn forecast"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRunOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={runForecast} disabled={busy || !runPlanId}>
              {busy ? 'Running...' : 'Run'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Plan</label>
            <select
              value={runPlanId}
              onChange={(e) => setRunPlanId(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (FY{p.fiscal_year} v{p.version})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Fiscal year
              </label>
              <input
                type="number"
                value={runYear}
                onChange={(e) => setRunYear(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Scenario</label>
              <select
                value={runScenario}
                onChange={(e) => setRunScenario(e.target.value)}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              >
                {SCENARIOS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Burn Forecast</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Phased burn-to-year-end projection across scenarios, with variance against budget.
        </p>
      </div>
      {right}
    </div>
  )
}

function BurnChart({
  series,
  budget,
}: {
  series: { label: string; cost: number }[]
  budget: number | null
}) {
  // Cumulative burn line + per-period bars, plus optional budget guide.
  let running = 0
  const cumulative = series.map((p) => {
    running += p.cost
    return { label: p.label, period: p.cost, cumulative: running }
  })
  const maxCum = Math.max(cumulative[cumulative.length - 1]?.cumulative ?? 0, budget ?? 0, 1)
  const w = 100
  const h = 100
  const stepX = cumulative.length > 1 ? w / (cumulative.length - 1) : w
  const points = cumulative
    .map((p, i) => `${(i * stepX).toFixed(2)},${(h - (p.cumulative / maxCum) * h).toFixed(2)}`)
    .join(' ')
  const budgetY = budget ? (h - (budget / maxCum) * h).toFixed(2) : null

  return (
    <div className="space-y-4">
      <div className="relative h-56 w-full">
        <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-full w-full">
          {/* grid */}
          {[0.25, 0.5, 0.75].map((g) => (
            <line key={g} x1="0" x2={w} y1={h * g} y2={h * g} stroke="#1e293b" strokeWidth="0.5" />
          ))}
          {/* budget guide */}
          {budgetY && (
            <line
              x1="0"
              x2={w}
              y1={budgetY}
              y2={budgetY}
              stroke="#f59e0b"
              strokeWidth="0.8"
              strokeDasharray="2 2"
            />
          )}
          {/* cumulative area */}
          <polyline
            points={`0,${h} ${points} ${w},${h}`}
            fill="rgba(56,189,248,0.12)"
            stroke="none"
          />
          {/* cumulative line */}
          <polyline points={points} fill="none" stroke="#38bdf8" strokeWidth="1.2" />
          {cumulative.map((p, i) => (
            <circle
              key={i}
              cx={(i * stepX).toFixed(2)}
              cy={(h - (p.cumulative / maxCum) * h).toFixed(2)}
              r="1.1"
              fill="#38bdf8"
            />
          ))}
        </svg>
      </div>
      <div className="flex justify-between text-[11px] text-slate-500">
        {cumulative.map((p) => (
          <span key={p.label}>{p.label}</span>
        ))}
      </div>
      <Table>
        <THead>
          <TR>
            <TH>Period</TH>
            <TH className="text-right">Period burn</TH>
            <TH className="text-right">Cumulative</TH>
          </TR>
        </THead>
        <TBody>
          {cumulative.map((p) => (
            <TR key={p.label}>
              <TD className="font-medium text-slate-200">{p.label}</TD>
              <TD className="text-right">{fmtMoney(p.period)}</TD>
              <TD className="text-right text-sky-300">{fmtMoney(p.cumulative)}</TD>
            </TR>
          ))}
        </TBody>
      </Table>
      {budget !== null && budget !== undefined && (
        <div className="flex items-center gap-2 text-xs text-amber-300">
          <span className="inline-block h-0.5 w-4 border-t border-dashed border-amber-500" />
          Budget guide: {fmtMoney(budget)}
        </div>
      )}
    </div>
  )
}
