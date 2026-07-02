'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

type Plan = {
  id: string
  workspace_id: string
  name: string
  fiscal_year: number
  version: number
  status: string
}
type Team = { id: string; name: string; cost_center?: string | null }
type Annotation = { note?: string; author?: string; at?: string; [k: string]: unknown }
type PlanLine = {
  id: string
  plan_id: string
  workspace_id: string
  team_id: string | null
  level: string | null
  role_title: string | null
  quarter: number | null
  count: number | null
  budgeted_base: number | null
  budgeted_variable: number | null
  burden_rate: number | null
  planned_start_quarter: number | null
  hire_type: string | null
  justification: string | null
  annotations: Annotation[] | null
  created_at: string
}

const QUARTERS = [1, 2, 3, 4]
const LEVELS = ['IC1', 'IC2', 'IC3', 'IC4', 'IC5', 'M1', 'M2', 'M3', 'Exec']
const HIRE_TYPES = ['new', 'backfill', 'conversion', 'contractor']

const STATUS_TONE: Record<string, 'slate' | 'sky' | 'amber' | 'green'> = {
  draft: 'slate',
  in_review: 'amber',
  approved: 'green',
  active: 'sky',
}

const emptyForm = {
  team_id: '',
  level: 'IC2',
  role_title: '',
  quarter: 1,
  count: 1,
  budgeted_base: 0,
  budgeted_variable: 0,
  burden_rate: 0.3,
  planned_start_quarter: 1,
  hire_type: 'new',
  justification: '',
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
function lineCost(l: PlanLine) {
  const base = num(l.budgeted_base)
  const variable = num(l.budgeted_variable)
  const burden = num(l.burden_rate)
  const count = num(l.count) || 1
  return (base + variable) * (1 + burden) * count
}
function fmtMoney(n: number) {
  if (!Number.isFinite(n)) return '$0'
  return '$' + Math.round(n).toLocaleString()
}

export default function PlanEditorPage() {
  const params = useParams<{ id: string }>()
  const planId = params?.id as string

  const [plan, setPlan] = useState<Plan | null>(null)
  const [lines, setLines] = useState<PlanLine[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [teamFilter, setTeamFilter] = useState('all')
  const [levelFilter, setLevelFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  // create/edit modal
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState({ ...emptyForm })
  const [saving, setSaving] = useState(false)

  // bulk modal
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)

  // annotate modal
  const [annotateLine, setAnnotateLine] = useState<PlanLine | null>(null)
  const [annotateNote, setAnnotateNote] = useState('')
  const [annotating, setAnnotating] = useState(false)

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (!planId) return
      isRefresh ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const p: Plan = await api.getPlan(planId)
        setPlan(p)
        const [ls, ts] = await Promise.all([
          api.listPlanLines({ plan_id: planId }),
          p?.workspace_id ? api.listTeams(p.workspace_id) : Promise.resolve([]),
        ])
        setLines(ls || [])
        setTeams(ts || [])
      } catch (e: any) {
        setError(e?.message || 'Failed to load plan')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [planId],
  )

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const teamName = useCallback(
    (id: string | null) => (id ? teams.find((t) => t.id === id)?.name ?? 'Unknown team' : 'Unassigned'),
    [teams],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return lines
      .filter((l) => (teamFilter === 'all' ? true : l.team_id === teamFilter))
      .filter((l) => (levelFilter === 'all' ? true : l.level === levelFilter))
      .filter((l) =>
        q ? (l.role_title || '').toLowerCase().includes(q) || (l.justification || '').toLowerCase().includes(q) : true,
      )
      .sort(
        (a, b) =>
          teamName(a.team_id).localeCompare(teamName(b.team_id)) ||
          num(a.quarter) - num(b.quarter) ||
          (a.level || '').localeCompare(b.level || ''),
      )
  }, [lines, teamFilter, levelFilter, search, teamName])

  // totals
  const totals = useMemo(() => {
    const totalHeadcount = lines.reduce((s, l) => s + (num(l.count) || 0), 0)
    const totalCost = lines.reduce((s, l) => s + lineCost(l), 0)
    const byQuarter = QUARTERS.map((q) => {
      const ql = lines.filter((l) => num(l.quarter) === q)
      return {
        quarter: q,
        headcount: ql.reduce((s, l) => s + (num(l.count) || 0), 0),
        cost: ql.reduce((s, l) => s + lineCost(l), 0),
      }
    })
    const byTeam = teams
      .map((t) => {
        const tl = lines.filter((l) => l.team_id === t.id)
        return {
          team: t.name,
          headcount: tl.reduce((s, l) => s + (num(l.count) || 0), 0),
          cost: tl.reduce((s, l) => s + lineCost(l), 0),
        }
      })
      .filter((r) => r.headcount > 0)
      .sort((a, b) => b.cost - a.cost)
    return { totalHeadcount, totalCost, byQuarter, byTeam }
  }, [lines, teams])

  const maxQCost = Math.max(1, ...totals.byQuarter.map((q) => q.cost))

  const openCreate = () => {
    setEditingId(null)
    setForm({ ...emptyForm, team_id: teams[0]?.id ?? '' })
    setFormOpen(true)
  }
  const openEdit = (l: PlanLine) => {
    setEditingId(l.id)
    setForm({
      team_id: l.team_id ?? '',
      level: l.level ?? 'IC2',
      role_title: l.role_title ?? '',
      quarter: num(l.quarter) || 1,
      count: num(l.count) || 1,
      budgeted_base: num(l.budgeted_base),
      budgeted_variable: num(l.budgeted_variable),
      burden_rate: num(l.burden_rate),
      planned_start_quarter: num(l.planned_start_quarter) || 1,
      hire_type: l.hire_type ?? 'new',
      justification: l.justification ?? '',
    })
    setFormOpen(true)
  }

  const handleSubmit = async () => {
    if (!plan) return
    setSaving(true)
    setError(null)
    const payload = {
      plan_id: plan.id,
      workspace_id: plan.workspace_id,
      team_id: form.team_id || null,
      level: form.level,
      role_title: form.role_title.trim() || null,
      quarter: Number(form.quarter),
      count: Number(form.count),
      budgeted_base: Number(form.budgeted_base),
      budgeted_variable: Number(form.budgeted_variable),
      burden_rate: Number(form.burden_rate),
      planned_start_quarter: Number(form.planned_start_quarter),
      hire_type: form.hire_type,
      justification: form.justification.trim() || null,
    }
    try {
      if (editingId) {
        const updated: PlanLine = await api.updatePlanLine(editingId, payload)
        setLines((prev) => prev.map((l) => (l.id === editingId ? { ...l, ...updated } : l)))
      } else {
        await api.createPlanLine(payload)
        await loadAll(true)
      }
      setFormOpen(false)
    } catch (e: any) {
      setError(e?.message || 'Failed to save plan line')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (l: PlanLine) => {
    if (!confirm('Delete this plan line?')) return
    setBusyId(l.id)
    setError(null)
    try {
      await api.deletePlanLine(l.id)
      setLines((prev) => prev.filter((x) => x.id !== l.id))
    } catch (e: any) {
      setError(e?.message || 'Failed to delete plan line')
    } finally {
      setBusyId(null)
    }
  }

  const handleAnnotate = async () => {
    if (!annotateLine || !annotateNote.trim()) return
    setAnnotating(true)
    setError(null)
    try {
      const updated: PlanLine = await api.annotatePlanLine(annotateLine.id, { note: annotateNote.trim() })
      setLines((prev) => prev.map((l) => (l.id === annotateLine.id ? { ...l, ...updated } : l)))
      setAnnotateNote('')
      setAnnotateLine(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to add annotation')
    } finally {
      setAnnotating(false)
    }
  }

  const bulkTemplate = `# One line per row: team_name, level, role_title, quarter, count, base, variable
Engineering, IC3, Backend Engineer, 1, 2, 180000, 20000
Engineering, IC4, Staff Engineer, 2, 1, 230000, 30000
Sales, IC2, AE, 1, 3, 90000, 90000`

  const handleBulk = async () => {
    if (!plan) return
    setBulkSaving(true)
    setBulkError(null)
    try {
      const rows = bulkText
        .split('\n')
        .map((r) => r.trim())
        .filter((r) => r && !r.startsWith('#'))
      if (rows.length === 0) {
        setBulkError('No rows to import.')
        setBulkSaving(false)
        return
      }
      const teamByName = new Map(teams.map((t) => [t.name.toLowerCase(), t.id]))
      const linesPayload = rows.map((r, idx) => {
        const cols = r.split(',').map((c) => c.trim())
        const [teamN, level, role, quarter, count, base, variable] = cols
        const tid = teamN ? teamByName.get(teamN.toLowerCase()) ?? null : null
        if (teamN && !tid) throw new Error(`Row ${idx + 1}: unknown team "${teamN}"`)
        return {
          plan_id: plan.id,
          workspace_id: plan.workspace_id,
          team_id: tid,
          level: level || null,
          role_title: role || null,
          quarter: quarter ? Number(quarter) : null,
          count: count ? Number(count) : 1,
          budgeted_base: base ? Number(base) : 0,
          budgeted_variable: variable ? Number(variable) : 0,
          burden_rate: 0.3,
          planned_start_quarter: quarter ? Number(quarter) : 1,
          hire_type: 'new',
        }
      })
      await api.bulkPlanLines({ lines: linesPayload })
      setBulkOpen(false)
      setBulkText('')
      await loadAll(true)
    } catch (e: any) {
      setBulkError(e?.message || 'Bulk import failed')
    } finally {
      setBulkSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500'
  const labelCls = 'mb-1 block text-xs font-medium text-zinc-400'

  if (loading && !plan) return <PageSpinner label="Loading plan editor..." />

  if (error && !plan) {
    return (
      <div className="space-y-4">
        <Link href="/dashboard/plan" className="text-sm text-teal-300 hover:underline">
          ← Back to plans
        </Link>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Link href="/dashboard/plan" className="text-sm text-teal-300 hover:underline">
          ← Back to plans
        </Link>
        <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-zinc-100">{plan?.name}</h1>
              {plan && <Badge tone={STATUS_TONE[plan.status] ?? 'slate'}>{plan.status}</Badge>}
            </div>
            <p className="mt-1 text-sm text-zinc-500">
              FY{plan?.fiscal_year} · version {plan?.version} · plan-line editor by team, level, and quarter
            </p>
          </div>
          <div className="flex items-center gap-2">
            {refreshing && <Spinner />}
            <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)}>
              Bulk add
            </Button>
            <Button size="sm" onClick={openCreate}>
              + Add line
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat label="Plan lines" value={lines.length} tone="sky" />
        <Stat label="Total headcount" value={totals.totalHeadcount} tone="green" />
        <Stat label="Fully-loaded cost" value={fmtMoney(totals.totalCost)} hint="base + variable × (1 + burden)" />
        <Stat label="Teams covered" value={totals.byTeam.length} />
      </div>

      {/* Quarter phasing chart (SVG-free div bars) + team rollup */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Budgeted cost by quarter</h2>
          </CardHeader>
          <CardBody>
            {totals.totalCost === 0 ? (
              <p className="text-sm text-zinc-500">No budgeted cost yet.</p>
            ) : (
              <div className="space-y-3">
                {totals.byQuarter.map((q) => (
                  <div key={q.quarter}>
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="text-zinc-400">
                        Q{q.quarter} · {q.headcount} HC
                      </span>
                      <span className="font-medium text-zinc-300">{fmtMoney(q.cost)}</span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-teal-500"
                        style={{ width: `${Math.max(2, (q.cost / maxQCost) * 100)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Cost by team</h2>
          </CardHeader>
          <CardBody className="px-0 py-0">
            {totals.byTeam.length === 0 ? (
              <p className="px-5 py-4 text-sm text-zinc-500">No team allocations yet.</p>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH className="pl-5">Team</TH>
                    <TH className="text-right">Headcount</TH>
                    <TH className="pr-5 text-right">Cost</TH>
                  </TR>
                </THead>
                <TBody>
                  {totals.byTeam.map((r) => (
                    <TR key={r.team}>
                      <TD className="pl-5 font-medium text-zinc-200">{r.team}</TD>
                      <TD className="text-right">{r.headcount}</TD>
                      <TD className="pr-5 text-right text-zinc-300">{fmtMoney(r.cost)}</TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardBody>
        </Card>
      </div>

      {/* Lines table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-sm font-semibold text-zinc-200">Plan lines</h2>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search role / justification..."
                className="w-52 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-teal-500 focus:outline-none"
              />
              <select
                value={teamFilter}
                onChange={(e) => setTeamFilter(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
              >
                <option value="all">All teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
              >
                <option value="all">All levels</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {filtered.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title={lines.length === 0 ? 'No plan lines yet' : 'No lines match your filters'}
                description={
                  lines.length === 0
                    ? 'Add headcount lines by team, level, and quarter — or bulk-paste rows to populate fast.'
                    : 'Try clearing the filters above.'
                }
                action={
                  lines.length === 0 ? (
                    <div className="flex gap-2">
                      <Button onClick={openCreate}>+ Add line</Button>
                      <Button variant="secondary" onClick={() => setBulkOpen(true)}>
                        Bulk add
                      </Button>
                    </div>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="pl-5">Team</TH>
                  <TH>Level</TH>
                  <TH>Role</TH>
                  <TH>Q</TH>
                  <TH className="text-right">Count</TH>
                  <TH className="text-right">Base</TH>
                  <TH className="text-right">Loaded cost</TH>
                  <TH>Type</TH>
                  <TH className="pr-5 text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((l) => {
                  const ann = Array.isArray(l.annotations) ? l.annotations.length : 0
                  const busy = busyId === l.id
                  return (
                    <TR key={l.id}>
                      <TD className="pl-5 font-medium text-zinc-200">{teamName(l.team_id)}</TD>
                      <TD>
                        <Badge tone="slate">{l.level || '—'}</Badge>
                      </TD>
                      <TD>
                        <div className="text-zinc-200">{l.role_title || '—'}</div>
                        {l.justification && (
                          <div className="max-w-[18rem] truncate text-xs text-zinc-500" title={l.justification}>
                            {l.justification}
                          </div>
                        )}
                      </TD>
                      <TD>Q{l.quarter ?? '—'}</TD>
                      <TD className="text-right">{l.count ?? 0}</TD>
                      <TD className="text-right text-zinc-400">{fmtMoney(num(l.budgeted_base))}</TD>
                      <TD className="text-right font-medium text-zinc-200">{fmtMoney(lineCost(l))}</TD>
                      <TD>
                        <span className="text-xs text-zinc-400">{l.hire_type || '—'}</span>
                      </TD>
                      <TD className="pr-5">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setAnnotateLine(l)
                              setAnnotateNote('')
                            }}
                            className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-teal-300"
                            title="Annotations"
                          >
                            Notes{ann ? ` (${ann})` : ''}
                          </button>
                          <Button variant="ghost" size="sm" onClick={() => openEdit(l)} disabled={busy}>
                            Edit
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(l)} disabled={busy}>
                            {busy ? '...' : 'Del'}
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

      {/* Create / edit line modal */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        size="lg"
        title={editingId ? 'Edit plan line' : 'Add plan line'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save changes' : 'Add line'}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={labelCls}>Team</label>
            <select
              value={form.team_id}
              onChange={(e) => setForm({ ...form, team_id: e.target.value })}
              className={inputCls}
            >
              <option value="">Unassigned</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {teams.length === 0 && (
              <p className="mt-1 text-xs text-amber-400">
                No teams yet — add teams under Setup → Teams to allocate lines.
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Level</label>
            <select
              value={form.level}
              onChange={(e) => setForm({ ...form, level: e.target.value })}
              className={inputCls}
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Role title</label>
            <input
              value={form.role_title}
              onChange={(e) => setForm({ ...form, role_title: e.target.value })}
              placeholder="e.g. Backend Engineer"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Quarter</label>
            <select
              value={form.quarter}
              onChange={(e) => setForm({ ...form, quarter: Number(e.target.value) })}
              className={inputCls}
            >
              {QUARTERS.map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Planned start quarter</label>
            <select
              value={form.planned_start_quarter}
              onChange={(e) => setForm({ ...form, planned_start_quarter: Number(e.target.value) })}
              className={inputCls}
            >
              {QUARTERS.map((q) => (
                <option key={q} value={q}>
                  Q{q}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Count</label>
            <input
              type="number"
              min={0}
              value={form.count}
              onChange={(e) => setForm({ ...form, count: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Hire type</label>
            <select
              value={form.hire_type}
              onChange={(e) => setForm({ ...form, hire_type: e.target.value })}
              className={inputCls}
            >
              {HIRE_TYPES.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Budgeted base ($)</label>
            <input
              type="number"
              min={0}
              value={form.budgeted_base}
              onChange={(e) => setForm({ ...form, budgeted_base: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Budgeted variable ($)</label>
            <input
              type="number"
              min={0}
              value={form.budgeted_variable}
              onChange={(e) => setForm({ ...form, budgeted_variable: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Burden rate (e.g. 0.3 = 30%)</label>
            <input
              type="number"
              step="0.01"
              min={0}
              value={form.burden_rate}
              onChange={(e) => setForm({ ...form, burden_rate: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
          <div className="col-span-2">
            <label className={labelCls}>Justification</label>
            <textarea
              value={form.justification}
              onChange={(e) => setForm({ ...form, justification: e.target.value })}
              rows={2}
              placeholder="Why this role is needed..."
              className={inputCls}
            />
          </div>
          <div className="col-span-2 rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-400">
            Fully-loaded estimate:{' '}
            <span className="font-semibold text-teal-300">
              {fmtMoney(
                (num(form.budgeted_base) + num(form.budgeted_variable)) *
                  (1 + num(form.burden_rate)) *
                  (num(form.count) || 1),
              )}
            </span>
          </div>
        </div>
      </Modal>

      {/* Bulk modal */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        size="lg"
        title="Bulk add plan lines"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBulkOpen(false)} disabled={bulkSaving}>
              Cancel
            </Button>
            <Button onClick={handleBulk} disabled={bulkSaving || !bulkText.trim()}>
              {bulkSaving ? 'Importing...' : 'Import lines'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-zinc-400">
            One line per row, comma-separated:{' '}
            <span className="text-zinc-300">team_name, level, role_title, quarter, count, base, variable</span>. Team
            names must match existing teams. Lines starting with <span className="text-zinc-300">#</span> are ignored.
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={9}
            placeholder={bulkTemplate}
            className={`${inputCls} font-mono text-xs`}
          />
          {!bulkText.trim() && (
            <Button variant="ghost" size="sm" onClick={() => setBulkText(bulkTemplate)}>
              Insert template
            </Button>
          )}
          {bulkError && (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
              {bulkError}
            </div>
          )}
        </div>
      </Modal>

      {/* Annotate modal */}
      <Modal
        open={!!annotateLine}
        onClose={() => setAnnotateLine(null)}
        title="Annotations"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAnnotateLine(null)} disabled={annotating}>
              Close
            </Button>
            <Button onClick={handleAnnotate} disabled={annotating || !annotateNote.trim()}>
              {annotating ? 'Adding...' : 'Add note'}
            </Button>
          </>
        }
      >
        {annotateLine && (
          <div className="space-y-3">
            <div className="text-sm text-zinc-400">
              {teamName(annotateLine.team_id)} · {annotateLine.level} · {annotateLine.role_title || 'role'} · Q
              {annotateLine.quarter}
            </div>
            <div className="max-h-48 space-y-2 overflow-y-auto">
              {Array.isArray(annotateLine.annotations) && annotateLine.annotations.length > 0 ? (
                annotateLine.annotations.map((a, i) => (
                  <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm">
                    <div className="text-zinc-200">{a.note ?? JSON.stringify(a)}</div>
                    {(a.author || a.at) && (
                      <div className="mt-0.5 text-xs text-zinc-500">
                        {a.author ?? 'someone'}
                        {a.at ? ` · ${new Date(a.at).toLocaleString()}` : ''}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-sm text-zinc-500">No annotations yet.</p>
              )}
            </div>
            <div>
              <label className={labelCls}>New note</label>
              <textarea
                value={annotateNote}
                onChange={(e) => setAnnotateNote(e.target.value)}
                rows={3}
                placeholder="Add context, an approval note, or a flag..."
                className={inputCls}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
