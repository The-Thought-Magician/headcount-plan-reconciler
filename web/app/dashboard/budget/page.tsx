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

type Team = { id: string; name: string; cost_center?: string | null }
type Revision = { at?: string; by?: string; from?: number; to?: number; note?: string }
type Budget = {
  id: string
  workspace_id: string
  team_id: string | null
  fiscal_year: number
  quarter: number | string
  budgeted_cost: number
  headcount_cap: number | null
  source: string | null
  revisions: Revision[] | null
  created_at: string
}
type ByTeam = {
  team_id: string | null
  team_name?: string
  budget: number
  plan: number
  actual: number
}
type Summary = {
  budget: number
  plan: number
  actual: number
  byTeam: ByTeam[]
}

const WS_KEY = 'hpr_ws'
const QUARTERS = [1, 2, 3, 4]

function fmtMoney(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function varianceTone(variance: number): 'green' | 'rose' | 'slate' {
  if (variance > 0) return 'rose' // over budget
  if (variance < 0) return 'green' // under budget
  return 'slate'
}

export default function BudgetPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([])
  const [wsId, setWsId] = useState<string>('')

  const [budgets, setBudgets] = useState<Budget[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)

  const years = useMemo(() => {
    const set = new Set<number>()
    budgets.forEach((b) => set.add(Number(b.fiscal_year)))
    if (set.size === 0) set.add(new Date().getFullYear())
    return Array.from(set).sort((a, b) => b - a)
  }, [budgets])
  const [fiscalYear, setFiscalYear] = useState<number>(new Date().getFullYear())

  const [teamFilter, setTeamFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  // upsert modal
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({
    team_id: '',
    fiscal_year: new Date().getFullYear(),
    quarter: 1,
    budgeted_cost: '',
    headcount_cap: '',
    source: 'annual_plan',
  })
  const [saving, setSaving] = useState(false)

  // revise modal
  const [reviseTarget, setReviseTarget] = useState<Budget | null>(null)
  const [reviseForm, setReviseForm] = useState({ budgeted_cost: '', note: '' })

  const teamName = useCallback(
    (id: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? 'Unknown team' : 'Unassigned'),
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

  const loadData = useCallback(
    async (workspaceId: string, fy: number) => {
      if (!workspaceId) {
        setBudgets([])
        setTeams([])
        setSummary(null)
        return
      }
      const [b, t, s] = await Promise.all([
        api.listBudget(workspaceId) as Promise<Budget[]>,
        api.listTeams(workspaceId) as Promise<Team[]>,
        api.getBudgetSummary(workspaceId, fy) as Promise<Summary>,
      ])
      setBudgets(b || [])
      setTeams(t || [])
      setSummary(s || null)
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
        const initialYear = new Date().getFullYear()
        if (chosen) await loadData(chosen, initialYear)
        if (!alive) return
        setFiscalYear(initialYear)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load budget data')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadWorkspaces, loadData])

  const refresh = useCallback(
    async (fy = fiscalYear) => {
      if (!wsId) return
      setError(null)
      try {
        await loadData(wsId, fy)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to refresh')
      }
    },
    [wsId, fiscalYear, loadData],
  )

  const onSelectWorkspace = async (id: string) => {
    setWsId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, id)
    setLoading(true)
    try {
      await loadData(id, fiscalYear)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }

  const onSelectYear = async (fy: number) => {
    setFiscalYear(fy)
    await refresh(fy)
  }

  const openCreate = () => {
    setForm({
      team_id: teams[0]?.id ?? '',
      fiscal_year: fiscalYear,
      quarter: 1,
      budgeted_cost: '',
      headcount_cap: '',
      source: 'annual_plan',
    })
    setFormOpen(true)
  }

  const submitUpsert = async () => {
    if (!wsId) return
    setSaving(true)
    setError(null)
    try {
      await api.upsertBudget({
        workspace_id: wsId,
        team_id: form.team_id || null,
        fiscal_year: Number(form.fiscal_year),
        quarter: Number(form.quarter),
        budgeted_cost: Number(form.budgeted_cost || 0),
        headcount_cap: form.headcount_cap === '' ? null : Number(form.headcount_cap),
        source: form.source || null,
      })
      setFormOpen(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save baseline')
    } finally {
      setSaving(false)
    }
  }

  const submitRevise = async () => {
    if (!reviseTarget) return
    setSaving(true)
    setError(null)
    try {
      await api.reviseBudget(reviseTarget.id, {
        budgeted_cost: Number(reviseForm.budgeted_cost || 0),
        note: reviseForm.note || undefined,
      })
      setReviseTarget(null)
      setReviseForm({ budgeted_cost: '', note: '' })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revise baseline')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (b: Budget) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this budget baseline?')) return
    setError(null)
    try {
      await api.deleteBudget(b.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete baseline')
    }
  }

  const filtered = useMemo(() => {
    return budgets
      .filter((b) => Number(b.fiscal_year) === Number(fiscalYear))
      .filter((b) => (teamFilter === 'all' ? true : (b.team_id ?? '') === teamFilter))
      .filter((b) => {
        if (!search.trim()) return true
        const q = search.toLowerCase()
        return (
          teamName(b.team_id).toLowerCase().includes(q) ||
          (b.source ?? '').toLowerCase().includes(q) ||
          String(b.quarter).includes(q)
        )
      })
      .sort((a, b) =>
        a.team_id === b.team_id ? Number(a.quarter) - Number(b.quarter) : teamName(a.team_id).localeCompare(teamName(b.team_id)),
      )
  }, [budgets, fiscalYear, teamFilter, search, teamName])

  const totalVariance = summary ? summary.actual - summary.budget : 0
  const planVariance = summary ? summary.plan - summary.budget : 0

  const maxBar = useMemo(() => {
    if (!summary) return 1
    return Math.max(summary.budget, summary.plan, summary.actual, 1)
  }, [summary])

  if (loading) return <PageSpinner label="Loading budget baseline..." />

  if (!loading && workspaces.length === 0) {
    return (
      <div className="space-y-6">
        <Header
          workspaces={workspaces}
          wsId={wsId}
          onSelectWorkspace={onSelectWorkspace}
          years={years}
          fiscalYear={fiscalYear}
          onSelectYear={onSelectYear}
          onCreate={openCreate}
          createDisabled
        />
        <EmptyState
          title="No workspace yet"
          description="Create a workspace from the Workspaces page before setting comp budget baselines."
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header
        workspaces={workspaces}
        wsId={wsId}
        onSelectWorkspace={onSelectWorkspace}
        years={years}
        fiscalYear={fiscalYear}
        onSelectYear={onSelectYear}
        onCreate={openCreate}
        createDisabled={teams.length === 0}
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Stat cards: budget vs plan vs actual */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Comp Budget · FY${fiscalYear}`} value={fmtMoney(summary?.budget ?? 0)} tone="sky" />
        <Stat
          label="Planned Cost"
          value={fmtMoney(summary?.plan ?? 0)}
          tone={planVariance > 0 ? 'rose' : 'default'}
          hint={summary ? `${planVariance >= 0 ? '+' : ''}${fmtMoney(planVariance)} vs budget` : undefined}
        />
        <Stat
          label="Actual Cost"
          value={fmtMoney(summary?.actual ?? 0)}
          tone={totalVariance > 0 ? 'rose' : 'green'}
          hint={summary ? `${totalVariance >= 0 ? '+' : ''}${fmtMoney(totalVariance)} vs budget` : undefined}
        />
        <Stat
          label="Baselines"
          value={budgets.filter((b) => Number(b.fiscal_year) === Number(fiscalYear)).length}
          hint={`across ${teams.length} teams`}
        />
      </div>

      {/* Budget vs plan vs actual bars */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-100">Budget vs Plan vs Actual — FY{fiscalYear}</h2>
        </CardHeader>
        <CardBody>
          {!summary || (summary.budget === 0 && summary.plan === 0 && summary.actual === 0) ? (
            <p className="text-sm text-zinc-500">No budget, plan, or actual cost recorded for this fiscal year.</p>
          ) : (
            <div className="space-y-4">
              <BarRow label="Budget" value={summary.budget} max={maxBar} color="bg-teal-500" />
              <BarRow label="Plan" value={summary.plan} max={maxBar} color="bg-indigo-400" />
              <BarRow label="Actual" value={summary.actual} max={maxBar} color="bg-emerald-400" />
            </div>
          )}
        </CardBody>
      </Card>

      {/* By-team breakdown */}
      {summary && summary.byTeam && summary.byTeam.length > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">By Team — Budget / Plan / Actual</h2>
          </CardHeader>
          <CardBody className="px-0 py-0">
            <Table>
              <THead>
                <TR>
                  <TH>Team</TH>
                  <TH className="text-right">Budget</TH>
                  <TH className="text-right">Plan</TH>
                  <TH className="text-right">Actual</TH>
                  <TH className="text-right">Variance</TH>
                  <TH>Status</TH>
                </TR>
              </THead>
              <TBody>
                {summary.byTeam.map((row) => {
                  const v = row.actual - row.budget
                  return (
                    <TR key={(row.team_id ?? 'unassigned') + 'team'}>
                      <TD className="font-medium text-zinc-200">{row.team_name ?? teamName(row.team_id)}</TD>
                      <TD className="text-right">{fmtMoney(row.budget)}</TD>
                      <TD className="text-right">{fmtMoney(row.plan)}</TD>
                      <TD className="text-right">{fmtMoney(row.actual)}</TD>
                      <TD className="text-right">
                        <span className={v > 0 ? 'text-rose-300' : v < 0 ? 'text-emerald-300' : 'text-zinc-400'}>
                          {v >= 0 ? '+' : ''}
                          {fmtMoney(v)}
                        </span>
                      </TD>
                      <TD>
                        <Badge tone={varianceTone(v)}>{v > 0 ? 'Over' : v < 0 ? 'Under' : 'On budget'}</Badge>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      {/* Filters + baseline table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Comp Budget Baselines</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search team / source / quarter"
              className="w-56 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-teal-500 focus:outline-none"
            />
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
            >
              <option value="all">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No baselines for this view"
                description="Set a comp budget baseline per team, fiscal year, and quarter to begin reconciliation."
                action={
                  <Button onClick={openCreate} disabled={teams.length === 0}>
                    Set baseline
                  </Button>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Team</TH>
                  <TH>Cost center</TH>
                  <TH className="text-right">Quarter</TH>
                  <TH className="text-right">Budgeted cost</TH>
                  <TH className="text-right">HC cap</TH>
                  <TH>Source</TH>
                  <TH className="text-right">Revisions</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((b) => {
                  const team = teams.find((t) => t.id === b.team_id)
                  const revCount = Array.isArray(b.revisions) ? b.revisions.length : 0
                  return (
                    <TR key={b.id}>
                      <TD className="font-medium text-zinc-200">{teamName(b.team_id)}</TD>
                      <TD className="text-zinc-400">{team?.cost_center ?? '—'}</TD>
                      <TD className="text-right">Q{b.quarter}</TD>
                      <TD className="text-right font-medium text-zinc-100">{fmtMoney(b.budgeted_cost)}</TD>
                      <TD className="text-right">{b.headcount_cap ?? '—'}</TD>
                      <TD>
                        <Badge tone="slate">{b.source ?? 'manual'}</Badge>
                      </TD>
                      <TD className="text-right">
                        {revCount > 0 ? <Badge tone="amber">{revCount}</Badge> : <span className="text-zinc-600">0</span>}
                      </TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setReviseTarget(b)
                              setReviseForm({ budgeted_cost: String(b.budgeted_cost), note: '' })
                            }}
                          >
                            Revise
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => onDelete(b)}>
                            Delete
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Revision history for selected/recent baselines */}
      {filtered.some((b) => Array.isArray(b.revisions) && b.revisions.length > 0) && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-100">Revision History</h2>
          </CardHeader>
          <CardBody className="space-y-4">
            {filtered
              .filter((b) => Array.isArray(b.revisions) && b.revisions.length > 0)
              .map((b) => (
                <div key={`rev-${b.id}`} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
                  <div className="mb-2 text-sm font-medium text-zinc-200">
                    {teamName(b.team_id)} · Q{b.quarter} FY{b.fiscal_year}
                  </div>
                  <ol className="space-y-1.5">
                    {(b.revisions ?? []).map((r, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
                        <span className="text-zinc-500">{r.at ? new Date(r.at).toLocaleDateString() : `Rev ${i + 1}`}</span>
                        {r.from !== undefined && (
                          <span>
                            {fmtMoney(r.from)} → <span className="text-zinc-200">{fmtMoney(r.to)}</span>
                          </span>
                        )}
                        {r.note && <span className="text-zinc-500">— {r.note}</span>}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
          </CardBody>
        </Card>
      )}

      {/* Upsert modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Set comp budget baseline"
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitUpsert} disabled={saving || !form.budgeted_cost}>
              {saving ? 'Saving...' : 'Save baseline'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Team">
            <select
              value={form.team_id}
              onChange={(e) => setForm({ ...form, team_id: e.target.value })}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
            >
              <option value="">Unassigned (workspace-wide)</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Fiscal year">
              <input
                type="number"
                value={form.fiscal_year}
                onChange={(e) => setForm({ ...form, fiscal_year: Number(e.target.value) })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
              />
            </Field>
            <Field label="Quarter">
              <select
                value={form.quarter}
                onChange={(e) => setForm({ ...form, quarter: Number(e.target.value) })}
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="Budgeted cost (USD)">
              <input
                type="number"
                value={form.budgeted_cost}
                onChange={(e) => setForm({ ...form, budgeted_cost: e.target.value })}
                placeholder="0"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
              />
            </Field>
            <Field label="Headcount cap">
              <input
                type="number"
                value={form.headcount_cap}
                onChange={(e) => setForm({ ...form, headcount_cap: e.target.value })}
                placeholder="optional"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
              />
            </Field>
          </div>
          <Field label="Source">
            <input
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="annual_plan, board_approved, …"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
            />
          </Field>
          <p className="text-xs text-zinc-500">
            Saving a baseline for an existing team + year + quarter updates that baseline in place.
          </p>
        </div>
      </Modal>

      {/* Revise modal */}
      <Modal
        open={!!reviseTarget}
        onClose={() => setReviseTarget(null)}
        title="Revise baseline"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReviseTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitRevise} disabled={saving || !reviseForm.budgeted_cost}>
              {saving ? 'Saving...' : 'Record revision'}
            </Button>
          </>
        }
      >
        {reviseTarget && (
          <div className="space-y-3">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2 text-sm text-zinc-300">
              {teamName(reviseTarget.team_id)} · Q{reviseTarget.quarter} FY{reviseTarget.fiscal_year} ·{' '}
              <span className="text-zinc-400">current {fmtMoney(reviseTarget.budgeted_cost)}</span>
            </div>
            <Field label="New budgeted cost (USD)">
              <input
                type="number"
                value={reviseForm.budgeted_cost}
                onChange={(e) => setReviseForm({ ...reviseForm, budgeted_cost: e.target.value })}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
              />
            </Field>
            <Field label="Note">
              <textarea
                value={reviseForm.note}
                onChange={(e) => setReviseForm({ ...reviseForm, note: e.target.value })}
                rows={2}
                placeholder="Reason for revision"
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
              />
            </Field>
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
  years,
  fiscalYear,
  onSelectYear,
  onCreate,
  createDisabled,
}: {
  workspaces: { id: string; name: string }[]
  wsId: string
  onSelectWorkspace: (id: string) => void
  years: number[]
  fiscalYear: number
  onSelectYear: (y: number) => void
  onCreate: () => void
  createDisabled?: boolean
}) {
  const yearOptions = Array.from(new Set([...years, fiscalYear])).sort((a, b) => b - a)
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Budget Baseline</h1>
        <p className="mt-0.5 text-sm text-zinc-500">Comp budget baseline, budget vs plan vs actual, and revision history.</p>
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
        <select
          value={fiscalYear}
          onChange={(e) => onSelectYear(Number(e.target.value))}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
        >
          {yearOptions.map((y) => (
            <option key={y} value={y}>
              FY{y}
            </option>
          ))}
        </select>
        <Button onClick={onCreate} disabled={createDisabled}>
          Set baseline
        </Button>
      </div>
    </div>
  )
}

function BarRow({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = Math.max(2, Math.round((value / max) * 100))
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-zinc-300">{label}</span>
        <span className="text-zinc-400">{fmtMoney(value)}</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
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
