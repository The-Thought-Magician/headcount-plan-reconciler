'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Stat } from '@/components/ui/Stat'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Plan = { id: string; name: string; fiscal_year: number; version: number; status: string }
type Cell = {
  id: string
  reconciliation_id: string
  team_id: string | null
  level: string | null
  quarter: number | string
  planned_count: number
  open_count: number
  filled_count: number
  count_variance: number
  cost_variance: number
  status: string
}
type Recon = {
  id: string
  workspace_id: string
  plan_id: string
  fiscal_year: number
  quarter: number | string
  status: string
  total_planned: number
  total_open: number
  total_filled: number
  cost_variance: number
  summary: Record<string, unknown> | null
  created_at: string
  cells?: Cell[]
}

const WS_KEY = 'hpr_ws'
const QUARTERS = [1, 2, 3, 4]

function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  const abs = Math.abs(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
  return v < 0 ? `(${abs})` : abs
}

function cellTone(status: string): 'green' | 'amber' | 'rose' | 'sky' | 'slate' {
  const s = (status || '').toLowerCase()
  if (s.includes('over')) return 'rose'
  if (s.includes('under')) return 'amber'
  if (s.includes('match') || s.includes('ok') || s.includes('on')) return 'green'
  return 'sky'
}

function statusTone(status: string): 'green' | 'amber' | 'sky' | 'slate' {
  const s = (status || '').toLowerCase()
  if (s === 'closed' || s === 'snapshot') return 'green'
  if (s === 'open' || s === 'draft') return 'sky'
  return 'slate'
}

export default function ReconciliationPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([])
  const [wsId, setWsId] = useState('')

  const [runs, setRuns] = useState<Recon[]>([])
  const [plans, setPlans] = useState<Plan[]>([])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Recon | null>(null)
  const [cells, setCells] = useState<Cell[]>([])
  const [detailLoading, setDetailLoading] = useState(false)

  // run modal
  const [runOpen, setRunOpen] = useState(false)
  const [runForm, setRunForm] = useState({ plan_id: '', fiscal_year: new Date().getFullYear(), quarter: 1 })
  const [running, setRunning] = useState(false)

  // cell filters + drill-down
  const [cellStatusFilter, setCellStatusFilter] = useState<'all' | 'over' | 'under' | 'match'>('all')
  const [drillCell, setDrillCell] = useState<Cell | null>(null)

  const planName = useCallback(
    (id: string) => plans.find((p) => p.id === id)?.name ?? 'Unknown plan',
    [plans],
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
      setRuns([])
      setPlans([])
      return
    }
    const [r, p] = await Promise.all([
      api.listReconciliations(workspaceId) as Promise<Recon[]>,
      api.listPlans(workspaceId) as Promise<Plan[]>,
    ])
    setRuns(r || [])
    setPlans(p || [])
    return { r: r || [], p: p || [] }
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      const [d, c] = await Promise.all([
        api.getReconciliation(id) as Promise<Recon>,
        api.getReconciliationCells(id) as Promise<Cell[]>,
      ])
      setDetail(d)
      setCells(c || d?.cells || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load reconciliation detail')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const chosen = await loadWorkspaces()
        if (chosen) {
          const res = await loadData(chosen)
          if (alive && res && res.r.length > 0) {
            setSelectedId(res.r[0].id)
          }
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load reconciliations')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadWorkspaces, loadData])

  useEffect(() => {
    if (selectedId) loadDetail(selectedId)
    else {
      setDetail(null)
      setCells([])
    }
  }, [selectedId, loadDetail])

  const refresh = useCallback(async () => {
    if (!wsId) return
    setError(null)
    try {
      await loadData(wsId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to refresh')
    }
  }, [wsId, loadData])

  const onSelectWorkspace = async (id: string) => {
    setWsId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, id)
    setSelectedId(null)
    setLoading(true)
    try {
      const res = await loadData(id)
      if (res && res.r.length > 0) setSelectedId(res.r[0].id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }

  const openRun = () => {
    setRunForm({ plan_id: plans[0]?.id ?? '', fiscal_year: plans[0]?.fiscal_year ?? new Date().getFullYear(), quarter: 1 })
    setRunOpen(true)
  }

  const submitRun = async () => {
    if (!wsId || !runForm.plan_id) return
    setRunning(true)
    setError(null)
    try {
      const res = (await api.runReconciliation({
        workspace_id: wsId,
        plan_id: runForm.plan_id,
        fiscal_year: Number(runForm.fiscal_year),
        quarter: Number(runForm.quarter),
      })) as Recon
      setRunOpen(false)
      await refresh()
      if (res?.id) setSelectedId(res.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to run reconciliation')
    } finally {
      setRunning(false)
    }
  }

  const onSnapshot = async (id: string) => {
    setError(null)
    try {
      await api.snapshotReconciliation(id)
      await refresh()
      if (selectedId === id) await loadDetail(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to snapshot run')
    }
  }

  const onDelete = async (id: string) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this reconciliation run?')) return
    setError(null)
    try {
      await api.deleteReconciliation(id)
      if (selectedId === id) setSelectedId(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete run')
    }
  }

  const filteredCells = useMemo(() => {
    return cells.filter((c) => {
      if (cellStatusFilter === 'all') return true
      const s = (c.status || '').toLowerCase()
      if (cellStatusFilter === 'over') return s.includes('over')
      if (cellStatusFilter === 'under') return s.includes('under')
      if (cellStatusFilter === 'match') return s.includes('match') || s.includes('ok') || s.includes('on')
      return true
    })
  }, [cells, cellStatusFilter])

  const overCount = cells.filter((c) => (c.status || '').toLowerCase().includes('over')).length
  const underCount = cells.filter((c) => (c.status || '').toLowerCase().includes('under')).length

  if (loading) return <PageSpinner label="Loading reconciliations..." />

  if (workspaces.length === 0) {
    return (
      <div className="space-y-6">
        <Header workspaces={workspaces} wsId={wsId} onSelectWorkspace={onSelectWorkspace} onRun={openRun} runDisabled />
        <EmptyState title="No workspace yet" description="Create a workspace before running three-way reconciliation." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header
        workspaces={workspaces}
        wsId={wsId}
        onSelectWorkspace={onSelectWorkspace}
        onRun={openRun}
        runDisabled={plans.length === 0}
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {plans.length === 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
          No headcount plans found. Create a plan first to reconcile plan vs open reqs vs filled positions.
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Runs list */}
        <Card className="h-fit">
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">Reconciliation Runs</h2>
          </CardHeader>
          <CardBody className="px-0 py-0">
            {runs.length === 0 ? (
              <div className="px-4 py-6">
                <p className="text-sm text-zinc-500">No runs yet. Run a reconciliation to build the three-way match grid.</p>
              </div>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {runs.map((r) => (
                  <li key={r.id}>
                    <button
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full px-4 py-3 text-left transition-colors ${
                        selectedId === r.id ? 'bg-teal-500/10' : 'hover:bg-zinc-800/40'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-zinc-200">
                          {planName(r.plan_id)}
                        </span>
                        <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-zinc-500">
                        FY{r.fiscal_year} · Q{r.quarter} · {new Date(r.created_at).toLocaleDateString()}
                      </div>
                      <div className="mt-1.5 flex gap-3 text-xs text-zinc-400">
                        <span>plan {r.total_planned}</span>
                        <span>open {r.total_open}</span>
                        <span>filled {r.total_filled}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Detail / three-way grid */}
        <div className="space-y-6">
          {!selectedId || !detail ? (
            <EmptyState
              title="Select a run"
              description="Pick a reconciliation run on the left, or run a new three-way match."
              action={
                <Button onClick={openRun} disabled={plans.length === 0}>
                  Run reconciliation
                </Button>
              }
            />
          ) : detailLoading ? (
            <PageSpinner label="Loading match grid..." />
          ) : (
            <>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-zinc-100">
                    {planName(detail.plan_id)} · FY{detail.fiscal_year} Q{detail.quarter}
                  </h2>
                  <p className="text-sm text-zinc-500">
                    Run {new Date(detail.created_at).toLocaleString()} · <Badge tone={statusTone(detail.status)}>{detail.status}</Badge>
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => onSnapshot(detail.id)}
                    disabled={(detail.status || '').toLowerCase() === 'closed'}
                  >
                    Snapshot &amp; freeze
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => onDelete(detail.id)}>
                    Delete
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <Stat label="Planned" value={detail.total_planned} tone="sky" />
                <Stat label="Open reqs" value={detail.total_open} tone="amber" />
                <Stat label="Filled" value={detail.total_filled} tone="green" />
                <Stat
                  label="Cost variance"
                  value={fmtMoney(detail.cost_variance)}
                  tone={Number(detail.cost_variance) > 0 ? 'rose' : 'green'}
                  hint={Number(detail.cost_variance) > 0 ? 'over budget' : 'under budget'}
                />
              </div>

              {/* Three-way match summary bars */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-zinc-100">Three-Way Coverage</h3>
                </CardHeader>
                <CardBody>
                  <ThreeWayBar
                    planned={detail.total_planned}
                    open={detail.total_open}
                    filled={detail.total_filled}
                  />
                </CardBody>
              </Card>

              {/* Cell grid */}
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <h3 className="text-sm font-semibold text-zinc-100">
                    Match Grid <span className="text-zinc-500">({cells.length} cells)</span>
                  </h3>
                  <div className="flex items-center gap-2 text-xs">
                    <Badge tone="rose">{overCount} over</Badge>
                    <Badge tone="amber">{underCount} under</Badge>
                    <select
                      value={cellStatusFilter}
                      onChange={(e) => setCellStatusFilter(e.target.value as typeof cellStatusFilter)}
                      className="rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-200 focus:border-teal-500 focus:outline-none"
                    >
                      <option value="all">All cells</option>
                      <option value="over">Over only</option>
                      <option value="under">Under only</option>
                      <option value="match">Matched only</option>
                    </select>
                  </div>
                </CardHeader>
                <CardBody className="px-0 py-0">
                  {filteredCells.length === 0 ? (
                    <div className="px-5 py-8 text-center text-sm text-zinc-500">
                      No cells match this filter.
                    </div>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Level</TH>
                          <TH className="text-right">Quarter</TH>
                          <TH className="text-right">Planned</TH>
                          <TH className="text-right">Open</TH>
                          <TH className="text-right">Filled</TH>
                          <TH className="text-right">Count Δ</TH>
                          <TH className="text-right">Cost Δ</TH>
                          <TH>Flag</TH>
                          <TH className="text-right"></TH>
                        </TR>
                      </THead>
                      <TBody>
                        {filteredCells.map((c) => (
                          <TR key={c.id}>
                            <TD className="font-medium text-zinc-200">{c.level ?? '—'}</TD>
                            <TD className="text-right">Q{c.quarter}</TD>
                            <TD className="text-right">{c.planned_count}</TD>
                            <TD className="text-right text-amber-300">{c.open_count}</TD>
                            <TD className="text-right text-emerald-300">{c.filled_count}</TD>
                            <TD className="text-right">
                              <span className={Number(c.count_variance) > 0 ? 'text-rose-300' : Number(c.count_variance) < 0 ? 'text-amber-300' : 'text-zinc-400'}>
                                {Number(c.count_variance) > 0 ? '+' : ''}
                                {c.count_variance}
                              </span>
                            </TD>
                            <TD className="text-right">
                              <span className={Number(c.cost_variance) > 0 ? 'text-rose-300' : 'text-emerald-300'}>
                                {fmtMoney(c.cost_variance)}
                              </span>
                            </TD>
                            <TD>
                              <Badge tone={cellTone(c.status)}>{c.status}</Badge>
                            </TD>
                            <TD className="text-right">
                              <Button size="sm" variant="ghost" onClick={() => setDrillCell(c)}>
                                Drill down
                              </Button>
                            </TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Run modal */}
      <Modal
        open={runOpen}
        onClose={() => setRunOpen(false)}
        title="Run three-way reconciliation"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRunOpen(false)} disabled={running}>
              Cancel
            </Button>
            <Button onClick={submitRun} disabled={running || !runForm.plan_id}>
              {running ? 'Running...' : 'Run reconciliation'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Headcount plan">
            <select
              value={runForm.plan_id}
              onChange={(e) => {
                const p = plans.find((x) => x.id === e.target.value)
                setRunForm({ ...runForm, plan_id: e.target.value, fiscal_year: p?.fiscal_year ?? runForm.fiscal_year })
              }}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (FY{p.fiscal_year} v{p.version})
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fiscal year">
              <input
                type="number"
                value={runForm.fiscal_year}
                onChange={(e) => setRunForm({ ...runForm, fiscal_year: Number(e.target.value) })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
              />
            </Field>
            <Field label="Quarter">
              <select
                value={runForm.quarter}
                onChange={(e) => setRunForm({ ...runForm, quarter: Number(e.target.value) })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
              >
                {QUARTERS.map((q) => (
                  <option key={q} value={q}>
                    Q{q}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <p className="text-xs text-zinc-500">
            Compares planned headcount against open requisitions and filled positions, then flags over- and
            under-coverage by level and quarter.
          </p>
        </div>
      </Modal>

      {/* Drill-down modal */}
      <Modal open={!!drillCell} onClose={() => setDrillCell(null)} title="Cell drill-down" size="md">
        {drillCell && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">
              <span className="text-zinc-400">Level</span>
              <span className="font-medium text-zinc-100">{drillCell.level ?? '—'}</span>
              <Badge tone={cellTone(drillCell.status)}>{drillCell.status}</Badge>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <MiniStat label="Planned" value={drillCell.planned_count} tone="text-teal-300" />
              <MiniStat label="Open" value={drillCell.open_count} tone="text-amber-300" />
              <MiniStat label="Filled" value={drillCell.filled_count} tone="text-emerald-300" />
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Count variance</span>
                <span className={Number(drillCell.count_variance) > 0 ? 'text-rose-300' : Number(drillCell.count_variance) < 0 ? 'text-amber-300' : 'text-zinc-300'}>
                  {Number(drillCell.count_variance) > 0 ? '+' : ''}
                  {drillCell.count_variance}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-sm">
                <span className="text-zinc-400">Cost variance</span>
                <span className={Number(drillCell.cost_variance) > 0 ? 'text-rose-300' : 'text-emerald-300'}>
                  {fmtMoney(drillCell.cost_variance)}
                </span>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-sm">
                <span className="text-zinc-400">Quarter</span>
                <span className="text-zinc-200">Q{drillCell.quarter}</span>
              </div>
            </div>
            <p className="text-xs text-zinc-500">
              {Number(drillCell.count_variance) > 0
                ? 'Filled + open exceeds the plan for this level — overhiring risk.'
                : Number(drillCell.count_variance) < 0
                  ? 'Plan is not yet covered by open reqs and hires — under-filled.'
                  : 'Pipeline matches plan for this level and quarter.'}
            </p>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Header({
  workspaces,
  wsId,
  onSelectWorkspace,
  onRun,
  runDisabled,
}: {
  workspaces: { id: string; name: string }[]
  wsId: string
  onSelectWorkspace: (id: string) => void
  onRun: () => void
  runDisabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Three-Way Reconciliation</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Match plan vs open reqs vs filled positions, with over/under flags and drill-down.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {workspaces.length > 1 && (
          <select
            value={wsId}
            onChange={(e) => onSelectWorkspace(e.target.value)}
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <Button onClick={onRun} disabled={runDisabled}>
          Run reconciliation
        </Button>
      </div>
    </div>
  )
}

function ThreeWayBar({ planned, open, filled }: { planned: number; open: number; filled: number }) {
  const max = Math.max(planned, open + filled, 1)
  const filledPct = Math.round((filled / max) * 100)
  const openPct = Math.round((open / max) * 100)
  const plannedPct = Math.round((planned / max) * 100)
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 flex justify-between text-xs">
          <span className="font-medium text-zinc-300">Coverage (filled + open)</span>
          <span className="text-zinc-400">
            {filled + open} / {planned} planned
          </span>
        </div>
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-emerald-400" style={{ width: `${filledPct}%` }} title={`Filled ${filled}`} />
          <div className="h-full bg-amber-400" style={{ width: `${openPct}%` }} title={`Open ${open}`} />
        </div>
        <div className="mt-2 flex gap-4 text-xs text-zinc-400">
          <Legend color="bg-emerald-400" label={`Filled ${filled}`} />
          <Legend color="bg-amber-400" label={`Open ${open}`} />
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-xs">
          <span className="font-medium text-zinc-300">Plan</span>
          <span className="text-zinc-400">{planned}</span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800">
          <div className="h-full bg-teal-500" style={{ width: `${plannedPct}%` }} />
        </div>
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      {label}
    </span>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-center">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`text-lg font-semibold ${tone}`}>{value}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-zinc-400">{label}</span>
      {children}
    </label>
  )
}
