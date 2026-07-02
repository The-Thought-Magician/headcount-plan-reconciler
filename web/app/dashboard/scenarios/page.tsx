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

type Plan = { id: string; name: string; fiscal_year?: number | null; version?: number | null; status?: string | null }

type Scenario = {
  id: string
  workspace_id: string
  plan_id: string | null
  name: string
  description: string | null
  is_frozen: boolean
  created_by: string | null
  created_at: string
}

type Override = {
  id: string
  scenario_id: string
  plan_line_id: string | null
  override_count: number | null
  override_start_quarter: string | null
  override_base: number | null
  created_at: string
}

type PlanLine = {
  id: string
  plan_id: string
  team_id: string | null
  level: string | null
  role_title: string | null
  quarter: string | null
  count: number | null
  budgeted_base: number | null
  planned_start_quarter: string | null
}

type DiffRow = {
  plan_line_id?: string
  role_title?: string | null
  level?: string | null
  base_count?: number | null
  scenario_count?: number | null
  count_delta?: number | null
  base_cost?: number | null
  scenario_cost?: number | null
  cost_delta?: number | null
  [k: string]: unknown
}

type ScenarioDetail = Scenario & {
  overrides?: Override[]
  diff?: DiffRow[] | Record<string, unknown>
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  const abs = Math.abs(v)
  return `${v < 0 ? '-' : ''}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function signedMoney(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  if (v === 0) return '$0'
  return `${v >= 0 ? '+' : ''}${money(v)}`
}

function signedNum(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '0'
  const v = Number(n)
  return `${v > 0 ? '+' : ''}${v}`
}

const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'] as const

export default function ScenariosPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [plans, setPlans] = useState<Plan[]>([])

  const [selectedId, setSelectedId] = useState<string>('')
  const [detail, setDetail] = useState<ScenarioDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [planLines, setPlanLines] = useState<PlanLine[]>([])

  // create form
  const [createOpen, setCreateOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [newPlanId, setNewPlanId] = useState('')

  // override form
  const [ovOpen, setOvOpen] = useState(false)
  const [ovLineId, setOvLineId] = useState('')
  const [ovCount, setOvCount] = useState('')
  const [ovStartQ, setOvStartQ] = useState('')
  const [ovBase, setOvBase] = useState('')

  const loadWorkspaces = useCallback(async () => {
    const ws: Workspace[] = await api.listWorkspaces()
    setWorkspaces(Array.isArray(ws) ? ws : [])
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
    const chosen = (stored && ws.find((w) => w.id === stored)?.id) || ws[0]?.id || ''
    setWsId(chosen)
    return chosen
  }, [])

  const loadData = useCallback(async (id: string) => {
    if (!id) {
      setScenarios([])
      setPlans([])
      return [] as Scenario[]
    }
    const [scs, pls] = await Promise.all([api.listScenarios(id), api.listPlans(id)])
    const scList: Scenario[] = Array.isArray(scs) ? scs : []
    setScenarios(scList)
    setPlans(Array.isArray(pls) ? pls : [])
    return scList
  }, [])

  const loadDetail = useCallback(async (scenarioId: string) => {
    if (!scenarioId) {
      setDetail(null)
      setPlanLines([])
      return
    }
    setDetailLoading(true)
    try {
      const d: ScenarioDetail = await api.getScenario(scenarioId)
      setDetail(d)
      if (d.plan_id) {
        const lines = await api.listPlanLines({ plan_id: d.plan_id })
        setPlanLines(Array.isArray(lines) ? lines : [])
      } else {
        setPlanLines([])
      }
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        const id = await loadWorkspaces()
        if (!mounted) return
        const scs = await loadData(id)
        if (!mounted) return
        if (scs[0]) {
          setSelectedId(scs[0].id)
          await loadDetail(scs[0].id)
        }
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load scenarios')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [loadWorkspaces, loadData, loadDetail])

  const switchWorkspace = async (id: string) => {
    setWsId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, id)
    try {
      setLoading(true)
      setError(null)
      setDetail(null)
      setSelectedId('')
      const scs = await loadData(id)
      if (scs[0]) {
        setSelectedId(scs[0].id)
        await loadDetail(scs[0].id)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scenarios')
    } finally {
      setLoading(false)
    }
  }

  const selectScenario = async (sid: string) => {
    setSelectedId(sid)
    setError(null)
    try {
      await loadDetail(sid)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load scenario detail')
    }
  }

  const refreshAll = useCallback(async () => {
    const scs = await loadData(wsId)
    if (selectedId && scs.find((s) => s.id === selectedId)) {
      await loadDetail(selectedId)
    } else if (scs[0]) {
      setSelectedId(scs[0].id)
      await loadDetail(scs[0].id)
    } else {
      setSelectedId('')
      setDetail(null)
    }
  }, [wsId, selectedId, loadData, loadDetail])

  const openCreate = () => {
    setNewName('')
    setNewDesc('')
    setNewPlanId(plans[0]?.id ?? '')
    setCreateOpen(true)
  }

  const create = async () => {
    if (!wsId) return
    if (!newName.trim()) {
      setError('Scenario name is required')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const payload: Record<string, unknown> = {
        workspace_id: wsId,
        name: newName.trim(),
        description: newDesc.trim() || null,
      }
      if (newPlanId) payload.plan_id = newPlanId
      const created: Scenario = await api.createScenario(payload)
      setCreateOpen(false)
      setNotice(`Created scenario "${newName.trim()}".`)
      const scs = await loadData(wsId)
      const target = created?.id || scs[0]?.id || ''
      if (target) {
        setSelectedId(target)
        await loadDetail(target)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Create failed')
    } finally {
      setBusy(false)
    }
  }

  const freeze = async (s: Scenario) => {
    setBusy(true)
    setError(null)
    try {
      await api.freezeScenario(s.id, { is_frozen: !s.is_frozen })
      await refreshAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Freeze toggle failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (s: Scenario) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete scenario "${s.name}"?`)) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteScenario(s.id)
      if (selectedId === s.id) {
        setSelectedId('')
        setDetail(null)
      }
      await refreshAll()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const openOverride = (lineId?: string) => {
    setOvLineId(lineId ?? planLines[0]?.id ?? '')
    setOvCount('')
    setOvStartQ('')
    setOvBase('')
    setOvOpen(true)
  }

  const saveOverride = async () => {
    if (!selectedId) return
    if (!ovLineId) {
      setError('Select a plan line to override')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const payload: Record<string, unknown> = { plan_line_id: ovLineId }
      if (ovCount !== '') payload.override_count = Number(ovCount)
      if (ovStartQ !== '') payload.override_start_quarter = ovStartQ
      if (ovBase !== '') payload.override_base = Number(ovBase)
      await api.setScenarioOverride(selectedId, payload)
      setOvOpen(false)
      setNotice('Override applied.')
      await loadDetail(selectedId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Override failed')
    } finally {
      setBusy(false)
    }
  }

  const selected = useMemo(() => scenarios.find((s) => s.id === selectedId) ?? null, [scenarios, selectedId])

  const overrides = detail?.overrides ?? []

  const diffRows = useMemo<DiffRow[]>(() => {
    const d = detail?.diff
    if (!d) return []
    if (Array.isArray(d)) return d as DiffRow[]
    if (typeof d === 'object' && Array.isArray((d as Record<string, unknown>).rows)) {
      return (d as { rows: DiffRow[] }).rows
    }
    if (typeof d === 'object' && Array.isArray((d as Record<string, unknown>).lines)) {
      return (d as { lines: DiffRow[] }).lines
    }
    return []
  }, [detail])

  const diffTotals = useMemo(() => {
    let countDelta = 0
    let costDelta = 0
    for (const r of diffRows) {
      countDelta += Number(r.count_delta ?? 0)
      costDelta += Number(r.cost_delta ?? 0)
    }
    return { countDelta, costDelta }
  }, [diffRows])

  const lineLabel = useCallback(
    (lineId: string | null) => {
      if (!lineId) return '—'
      const l = planLines.find((pl) => pl.id === lineId)
      if (!l) return lineId.slice(0, 8)
      return `${l.role_title ?? 'Role'}${l.level ? ` (${l.level})` : ''}`
    },
    [planLines],
  )

  if (loading) return <PageSpinner label="Loading scenarios..." />

  if (!wsId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create a workspace and seed sample data from the Imports & Seed page to begin modeling scenarios."
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
            <Button size="sm" onClick={openCreate} disabled={busy}>
              New scenario
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

      <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Scenario list */}
        <Card className="h-fit">
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Scenarios</h2>
          </CardHeader>
          <CardBody className="p-3">
            {scenarios.length === 0 ? (
              <EmptyState
                title="No scenarios"
                description="Create a what-if scenario layered on a headcount plan."
                action={
                  <Button size="sm" onClick={openCreate}>
                    New scenario
                  </Button>
                }
              />
            ) : (
              <ul className="space-y-1.5">
                {scenarios.map((s) => {
                  const active = s.id === selectedId
                  return (
                    <li key={s.id}>
                      <button
                        onClick={() => selectScenario(s.id)}
                        className={`w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                          active
                            ? 'border-teal-500/40 bg-teal-500/10'
                            : 'border-zinc-800 bg-zinc-900/40 hover:bg-zinc-800/40'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-zinc-200">{s.name}</span>
                          {s.is_frozen && <Badge tone="sky">Frozen</Badge>}
                        </div>
                        {s.description && (
                          <p className="mt-0.5 truncate text-xs text-zinc-500">{s.description}</p>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </CardBody>
        </Card>

        {/* Detail */}
        <div className="space-y-6">
          {!selected ? (
            <EmptyState title="Select a scenario" description="Pick a scenario on the left to view overrides and its diff vs the base plan." />
          ) : detailLoading ? (
            <Card>
              <CardBody>
                <PageSpinner label="Loading scenario detail..." />
              </CardBody>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-semibold text-zinc-100">{selected.name}</h2>
                      {selected.is_frozen && <Badge tone="sky">Frozen</Badge>}
                    </div>
                    {selected.description && <p className="mt-0.5 text-sm text-zinc-500">{selected.description}</p>}
                    <p className="mt-0.5 text-xs text-zinc-600">
                      Base plan: {plans.find((p) => p.id === selected.plan_id)?.name ?? '—'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      onClick={() => openOverride()}
                      disabled={busy || selected.is_frozen || planLines.length === 0}
                    >
                      Add override
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => freeze(selected)} disabled={busy}>
                      {selected.is_frozen ? 'Unfreeze' : 'Freeze'}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(selected)} disabled={busy}>
                      Delete
                    </Button>
                  </div>
                </CardHeader>
                <CardBody>
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Stat label="Overrides" value={overrides.length} tone="sky" hint="What-if changes" />
                    <Stat
                      label="Headcount delta"
                      value={signedNum(diffTotals.countDelta)}
                      tone={diffTotals.countDelta > 0 ? 'amber' : diffTotals.countDelta < 0 ? 'green' : 'default'}
                      hint="vs base plan"
                    />
                    <Stat
                      label="Cost delta"
                      value={signedMoney(diffTotals.costDelta)}
                      tone={diffTotals.costDelta > 0 ? 'rose' : diffTotals.costDelta < 0 ? 'green' : 'default'}
                      hint="vs base plan"
                    />
                    <Stat label="Plan lines" value={planLines.length} hint="In base plan" />
                  </div>
                </CardBody>
              </Card>

              {/* Overrides */}
              <Card>
                <CardHeader className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-zinc-200">What-if overrides</h3>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openOverride()}
                    disabled={busy || selected.is_frozen || planLines.length === 0}
                  >
                    Add override
                  </Button>
                </CardHeader>
                <CardBody className="p-0">
                  {overrides.length === 0 ? (
                    <div className="p-5">
                      <EmptyState
                        title="No overrides"
                        description={
                          planLines.length === 0
                            ? 'This scenario has no base plan lines to override.'
                            : 'Add an override to model a different count, start quarter, or base for a plan line.'
                        }
                      />
                    </div>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Plan line</TH>
                          <TH className="text-right">Override count</TH>
                          <TH>Override start Q</TH>
                          <TH className="text-right">Override base</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {overrides.map((o) => (
                          <TR key={o.id}>
                            <TD className="text-zinc-300">{lineLabel(o.plan_line_id)}</TD>
                            <TD className="text-right text-zinc-300">
                              {o.override_count === null || o.override_count === undefined ? '—' : o.override_count}
                            </TD>
                            <TD className="text-zinc-300">{o.override_start_quarter ?? '—'}</TD>
                            <TD className="text-right text-zinc-300">{money(o.override_base)}</TD>
                          </TR>
                        ))}
                      </TBody>
                    </Table>
                  )}
                </CardBody>
              </Card>

              {/* Diff */}
              <Card>
                <CardHeader>
                  <h3 className="text-sm font-semibold text-zinc-200">Diff vs base plan</h3>
                </CardHeader>
                <CardBody className="p-0">
                  {diffRows.length === 0 ? (
                    <div className="p-5">
                      <EmptyState
                        title="No differences"
                        description="This scenario currently matches the base plan. Add overrides to see the impact."
                      />
                    </div>
                  ) : (
                    <Table>
                      <THead>
                        <TR>
                          <TH>Role / Level</TH>
                          <TH className="text-right">Base count</TH>
                          <TH className="text-right">Scenario count</TH>
                          <TH className="text-right">Δ count</TH>
                          <TH className="text-right">Base cost</TH>
                          <TH className="text-right">Scenario cost</TH>
                          <TH className="text-right">Δ cost</TH>
                        </TR>
                      </THead>
                      <TBody>
                        {diffRows.map((r, i) => {
                          const cd = Number(r.count_delta ?? 0)
                          const costd = Number(r.cost_delta ?? 0)
                          const label =
                            r.role_title ?? lineLabel((r.plan_line_id as string) ?? null)
                          return (
                            <TR key={(r.plan_line_id as string) ?? i}>
                              <TD className="text-zinc-300">
                                {label}
                                {r.level ? <span className="ml-1 text-xs text-zinc-500">{r.level}</span> : null}
                              </TD>
                              <TD className="text-right text-zinc-400">{r.base_count ?? '—'}</TD>
                              <TD className="text-right text-zinc-200">{r.scenario_count ?? '—'}</TD>
                              <TD className={`text-right font-medium ${cd > 0 ? 'text-amber-300' : cd < 0 ? 'text-emerald-300' : 'text-zinc-500'}`}>
                                {signedNum(cd)}
                              </TD>
                              <TD className="text-right text-zinc-400">{money(r.base_cost)}</TD>
                              <TD className="text-right text-zinc-200">{money(r.scenario_cost)}</TD>
                              <TD className={`text-right font-medium ${costd > 0 ? 'text-rose-300' : costd < 0 ? 'text-emerald-300' : 'text-zinc-500'}`}>
                                {signedMoney(costd)}
                              </TD>
                            </TR>
                          )
                        })}
                        <TR className="border-t-2 border-zinc-700 font-semibold">
                          <TD className="text-zinc-200">Total</TD>
                          <TD className="text-right text-zinc-500">—</TD>
                          <TD className="text-right text-zinc-500">—</TD>
                          <TD className={`text-right ${diffTotals.countDelta > 0 ? 'text-amber-300' : diffTotals.countDelta < 0 ? 'text-emerald-300' : 'text-zinc-300'}`}>
                            {signedNum(diffTotals.countDelta)}
                          </TD>
                          <TD className="text-right text-zinc-500">—</TD>
                          <TD className="text-right text-zinc-500">—</TD>
                          <TD className={`text-right ${diffTotals.costDelta > 0 ? 'text-rose-300' : diffTotals.costDelta < 0 ? 'text-emerald-300' : 'text-zinc-300'}`}>
                            {signedMoney(diffTotals.costDelta)}
                          </TD>
                        </TR>
                      </TBody>
                    </Table>
                  )}
                </CardBody>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Create scenario modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New scenario"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={create} disabled={busy}>
              {busy ? 'Creating...' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Name</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Conservative hiring"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Description</label>
            <textarea
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              rows={2}
              placeholder="Optional notes about this what-if"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Base plan</label>
            <select
              value={newPlanId}
              onChange={(e) => setNewPlanId(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="">No plan</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.fiscal_year ? ` · FY${p.fiscal_year}` : ''}
                  {p.version ? ` · v${p.version}` : ''}
                </option>
              ))}
            </select>
            {plans.length === 0 && (
              <p className="mt-1 text-xs text-zinc-500">No plans yet. Create one on the Headcount Plans page.</p>
            )}
          </div>
        </div>
      </Modal>

      {/* Override modal */}
      <Modal
        open={ovOpen}
        onClose={() => setOvOpen(false)}
        title="Set what-if override"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOvOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveOverride} disabled={busy}>
              {busy ? 'Saving...' : 'Apply override'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Plan line</label>
            <select
              value={ovLineId}
              onChange={(e) => setOvLineId(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              {planLines.length === 0 && <option value="">No plan lines available</option>}
              {planLines.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.role_title ?? 'Role'}
                  {l.level ? ` (${l.level})` : ''}
                  {l.quarter ? ` · ${l.quarter}` : ''} · count {l.count ?? 0}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Override count
              </label>
              <input
                type="number"
                value={ovCount}
                onChange={(e) => setOvCount(e.target.value)}
                placeholder="leave blank to keep"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Override start Q
              </label>
              <select
                value={ovStartQ}
                onChange={(e) => setOvStartQ(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="">keep</option>
                {QUARTERS.map((q) => (
                  <option key={q} value={q}>
                    {q}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Override base salary
            </label>
            <input
              type="number"
              value={ovBase}
              onChange={(e) => setOvBase(e.target.value)}
              placeholder="leave blank to keep"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
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
        <h1 className="text-xl font-semibold text-zinc-100">Scenarios</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Layer what-if overrides on a headcount plan and compare the diff against the approved base.
        </p>
      </div>
      {right}
    </div>
  )
}
