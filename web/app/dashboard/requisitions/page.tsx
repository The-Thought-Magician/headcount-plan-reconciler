'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

// ---------- types ----------
type Workspace = { id: string; name: string }
type Team = { id: string; name: string }
type PlanLine = {
  id: string
  role_title?: string | null
  level?: string | null
  quarter?: string | null
  count?: number | null
  team_id?: string | null
}
type Req = {
  id: string
  workspace_id: string
  team_id?: string | null
  plan_line_id?: string | null
  title?: string | null
  level?: string | null
  status?: string | null
  target_start?: string | null
  fill_by?: string | null
  opened_at?: string | null
  recruiter?: string | null
  hiring_manager?: string | null
  hire_type?: string | null
  budgeted_base?: number | null
  created_at?: string | null
}
type ReqEvent = {
  id: string
  from_status?: string | null
  to_status?: string | null
  note?: string | null
  created_by?: string | null
  created_at?: string | null
}

const STATUSES = ['draft', 'open', 'sourcing', 'interviewing', 'offer', 'filled', 'on_hold', 'closed', 'cancelled']
const HIRE_TYPES = ['new', 'backfill', 'conversion']

const statusTone: Record<string, 'sky' | 'green' | 'amber' | 'rose' | 'slate'> = {
  draft: 'slate',
  open: 'sky',
  sourcing: 'sky',
  interviewing: 'amber',
  offer: 'amber',
  filled: 'green',
  on_hold: 'amber',
  closed: 'slate',
  cancelled: 'rose',
}

function money(n?: number | null) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—'
  return '$' + Number(n).toLocaleString()
}
function fmtDate(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  if (isNaN(d.getTime())) return String(s)
  return d.toLocaleDateString()
}
function isOverdue(r: Req) {
  if (!r.fill_by) return false
  if (r.status === 'filled' || r.status === 'closed' || r.status === 'cancelled') return false
  return new Date(r.fill_by).getTime() < Date.now()
}

const WS_KEY = 'hpr.workspace_id'

export default function RequisitionsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string>('')
  const [reqs, setReqs] = useState<Req[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [planLines, setPlanLines] = useState<PlanLine[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // filters
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [teamFilter, setTeamFilter] = useState('')

  // modals
  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Req | null>(null)
  const [detail, setDetail] = useState<{ req: Req; events: ReqEvent[] } | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [statusModal, setStatusModal] = useState<Req | null>(null)
  const [linkModal, setLinkModal] = useState<Req | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)

  const teamName = useCallback(
    (id?: string | null) => teams.find((t) => t.id === id)?.name ?? (id ? '—' : '—'),
    [teams],
  )

  // resolve workspace
  useEffect(() => {
    let on = true
    ;(async () => {
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        if (!on) return
        setWorkspaces(ws || [])
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
        const pick = (ws || []).find((w) => w.id === stored)?.id || ws?.[0]?.id || ''
        setWsId(pick)
        if (!pick) setLoading(false)
      } catch (e: any) {
        if (on) {
          setError(e?.message || 'Failed to load workspaces')
          setLoading(false)
        }
      }
    })()
    return () => {
      on = false
    }
  }, [])

  const load = useCallback(async () => {
    if (!wsId) return
    setLoading(true)
    setError(null)
    try {
      const [r, t, pl] = await Promise.all([
        api.listReqs(wsId),
        api.listTeams(wsId),
        api.listPlanLines({ workspace_id: wsId }),
      ])
      setReqs(r || [])
      setTeams(t || [])
      setPlanLines(pl || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load requisitions')
    } finally {
      setLoading(false)
    }
  }, [wsId])

  useEffect(() => {
    if (wsId) {
      localStorage.setItem(WS_KEY, wsId)
      load()
    }
  }, [wsId, load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return reqs.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false
      if (teamFilter && r.team_id !== teamFilter) return false
      if (q) {
        const hay = `${r.title ?? ''} ${r.level ?? ''} ${r.recruiter ?? ''} ${r.hiring_manager ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [reqs, search, statusFilter, teamFilter])

  const stats = useMemo(() => {
    const openish = reqs.filter((r) => !['filled', 'closed', 'cancelled'].includes(r.status ?? ''))
    return {
      total: reqs.length,
      open: openish.length,
      filled: reqs.filter((r) => r.status === 'filled').length,
      overdue: reqs.filter(isOverdue).length,
      budget: reqs.reduce((s, r) => s + (Number(r.budgeted_base) || 0), 0),
    }
  }, [reqs])

  const byStatus = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of reqs) m.set(r.status ?? 'unknown', (m.get(r.status ?? 'unknown') || 0) + 1)
    return STATUSES.filter((s) => m.has(s)).map((s) => ({ status: s, count: m.get(s) || 0 }))
  }, [reqs])

  // ---------- actions ----------
  const openCreate = () => {
    setEditing(null)
    setActionErr(null)
    setEditOpen(true)
  }
  const openEdit = (r: Req) => {
    setEditing(r)
    setActionErr(null)
    setEditOpen(true)
  }

  const openDetail = async (r: Req) => {
    setDetail({ req: r, events: [] })
    setDetailLoading(true)
    try {
      const full = await api.getReq(r.id)
      setDetail({ req: full, events: full?.events ?? [] })
    } catch (e: any) {
      setActionErr(e?.message || 'Failed to load detail')
    } finally {
      setDetailLoading(false)
    }
  }

  const saveReq = async (form: Partial<Req>) => {
    setBusy(true)
    setActionErr(null)
    try {
      if (editing) {
        await api.updateReq(editing.id, form)
      } else {
        await api.createReq({ ...form, workspace_id: wsId })
      }
      setEditOpen(false)
      await load()
    } catch (e: any) {
      setActionErr(e?.message || 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  const changeStatus = async (id: string, to_status: string, note: string) => {
    setBusy(true)
    setActionErr(null)
    try {
      await api.setReqStatus(id, { to_status, note })
      setStatusModal(null)
      await load()
    } catch (e: any) {
      setActionErr(e?.message || 'Failed to set status')
    } finally {
      setBusy(false)
    }
  }

  const linkPlan = async (id: string, plan_line_id: string) => {
    setBusy(true)
    setActionErr(null)
    try {
      await api.linkReqPlan(id, { plan_line_id: plan_line_id || null })
      setLinkModal(null)
      await load()
    } catch (e: any) {
      setActionErr(e?.message || 'Failed to link plan line')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (r: Req) => {
    if (!confirm(`Delete requisition "${r.title ?? r.id}"?`)) return
    try {
      await api.deleteReq(r.id)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete')
    }
  }

  const doBulk = async (rows: any[]) => {
    setBusy(true)
    setActionErr(null)
    try {
      await api.bulkReqs({ reqs: rows.map((r) => ({ ...r, workspace_id: wsId })) })
      setBulkOpen(false)
      await load()
    } catch (e: any) {
      setActionErr(e?.message || 'Bulk import failed')
    } finally {
      setBusy(false)
    }
  }

  // ---------- render ----------
  if (loading && !reqs.length && !error) return <PageSpinner label="Loading requisitions..." />

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Requisitions</h1>
          <p className="mt-1 text-sm text-slate-500">
            Track open headcount, status timelines, and link reqs back to the approved plan.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && (
            <select
              value={wsId}
              onChange={(e) => setWsId(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button variant="secondary" onClick={() => setBulkOpen(true)} disabled={!wsId}>
            Bulk import
          </Button>
          <Button onClick={openCreate} disabled={!wsId}>
            New requisition
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!wsId && !loading && !error && (
        <EmptyState
          title="No workspace yet"
          description="Create a workspace under Setup to start tracking requisitions."
        />
      )}

      {wsId && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Total reqs" value={stats.total} />
            <Stat label="Open" value={stats.open} tone="sky" />
            <Stat label="Filled" value={stats.filled} tone="green" />
            <Stat label="Overdue fill-by" value={stats.overdue} tone={stats.overdue ? 'rose' : 'default'} />
            <Stat label="Budgeted base" value={money(stats.budget)} hint="sum of req base comp" />
          </div>

          {/* Status timeline / distribution */}
          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Pipeline by status</h2>
            </CardHeader>
            <CardBody>
              {byStatus.length === 0 ? (
                <p className="text-sm text-slate-500">No requisitions to chart yet.</p>
              ) : (
                <div className="space-y-2">
                  {byStatus.map((s) => {
                    const max = Math.max(...byStatus.map((x) => x.count), 1)
                    return (
                      <div key={s.status} className="flex items-center gap-3">
                        <div className="w-28 shrink-0 text-xs capitalize text-slate-400">
                          {s.status.replace('_', ' ')}
                        </div>
                        <div className="flex h-5 flex-1 items-center rounded bg-slate-800/60">
                          <div
                            className="h-5 rounded bg-sky-500/70"
                            style={{ width: `${(s.count / max) * 100}%` }}
                          />
                        </div>
                        <div className="w-8 shrink-0 text-right text-xs font-medium text-slate-300">{s.count}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, recruiter, manager..."
              className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">All statuses</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            {(search || statusFilter || teamFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setStatusFilter('')
                  setTeamFilter('')
                }}
              >
                Clear
              </Button>
            )}
          </div>

          {/* Table */}
          <Card>
            {filtered.length === 0 ? (
              <CardBody>
                <EmptyState
                  title={reqs.length === 0 ? 'No requisitions yet' : 'No matches'}
                  description={
                    reqs.length === 0
                      ? 'Open your first requisition or bulk-import from your ATS export.'
                      : 'Adjust your filters to see more requisitions.'
                  }
                  action={
                    reqs.length === 0 ? (
                      <Button onClick={openCreate}>New requisition</Button>
                    ) : undefined
                  }
                />
              </CardBody>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Title</TH>
                    <TH>Team</TH>
                    <TH>Level</TH>
                    <TH>Status</TH>
                    <TH>Plan link</TH>
                    <TH>Fill by</TH>
                    <TH>Recruiter</TH>
                    <TH className="text-right">Base</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((r) => {
                    const linked = planLines.find((p) => p.id === r.plan_line_id)
                    return (
                      <TR key={r.id}>
                        <TD>
                          <button
                            onClick={() => openDetail(r)}
                            className="text-left font-medium text-slate-100 hover:text-sky-300"
                          >
                            {r.title ?? 'Untitled'}
                          </button>
                        </TD>
                        <TD>{teamName(r.team_id)}</TD>
                        <TD>{r.level ?? '—'}</TD>
                        <TD>
                          <Badge tone={statusTone[r.status ?? ''] ?? 'slate'}>{r.status ?? 'unknown'}</Badge>
                        </TD>
                        <TD>
                          {r.plan_line_id ? (
                            <Badge tone="green">{linked?.role_title ?? 'linked'}</Badge>
                          ) : (
                            <Badge tone="amber">unlinked</Badge>
                          )}
                        </TD>
                        <TD>
                          <span className={isOverdue(r) ? 'text-rose-300' : ''}>{fmtDate(r.fill_by)}</span>
                        </TD>
                        <TD>{r.recruiter ?? '—'}</TD>
                        <TD className="text-right">{money(r.budgeted_base)}</TD>
                        <TD className="text-right">
                          <div className="flex justify-end gap-1">
                            <Button size="sm" variant="ghost" onClick={() => setStatusModal(r)}>
                              Status
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setLinkModal(r)}>
                              Link
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => remove(r)}>
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
          </Card>
        </>
      )}

      {/* Create / edit modal */}
      <ReqFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        editing={editing}
        teams={teams}
        planLines={planLines}
        busy={busy}
        error={actionErr}
        onSave={saveReq}
      />

      {/* Status modal */}
      <StatusModal
        req={statusModal}
        onClose={() => setStatusModal(null)}
        busy={busy}
        error={actionErr}
        onSubmit={changeStatus}
      />

      {/* Link plan modal */}
      <LinkPlanModal
        req={linkModal}
        planLines={planLines}
        teamName={teamName}
        onClose={() => setLinkModal(null)}
        busy={busy}
        error={actionErr}
        onSubmit={linkPlan}
      />

      {/* Detail / timeline modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.req.title ?? 'Requisition'} size="lg">
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Team" value={teamName(detail.req.team_id)} />
              <Field label="Level" value={detail.req.level ?? '—'} />
              <Field
                label="Status"
                value={<Badge tone={statusTone[detail.req.status ?? ''] ?? 'slate'}>{detail.req.status}</Badge>}
              />
              <Field label="Hire type" value={detail.req.hire_type ?? '—'} />
              <Field label="Recruiter" value={detail.req.recruiter ?? '—'} />
              <Field label="Hiring manager" value={detail.req.hiring_manager ?? '—'} />
              <Field label="Target start" value={fmtDate(detail.req.target_start)} />
              <Field label="Fill by" value={fmtDate(detail.req.fill_by)} />
              <Field label="Opened" value={fmtDate(detail.req.opened_at)} />
              <Field label="Budgeted base" value={money(detail.req.budgeted_base)} />
            </div>
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Status timeline</h3>
              {detailLoading ? (
                <Spinner label="Loading events..." />
              ) : detail.events.length === 0 ? (
                <p className="text-sm text-slate-500">No status events recorded.</p>
              ) : (
                <ol className="relative space-y-3 border-l border-slate-800 pl-4">
                  {detail.events.map((ev) => (
                    <li key={ev.id} className="relative">
                      <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-sky-500" />
                      <div className="flex flex-wrap items-center gap-2 text-sm text-slate-200">
                        {ev.from_status && <span className="text-slate-500">{ev.from_status}</span>}
                        {ev.from_status && <span className="text-slate-600">→</span>}
                        <Badge tone={statusTone[ev.to_status ?? ''] ?? 'slate'}>{ev.to_status}</Badge>
                        <span className="text-xs text-slate-500">{fmtDate(ev.created_at)}</span>
                      </div>
                      {ev.note && <p className="mt-0.5 text-xs text-slate-500">{ev.note}</p>}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Bulk import */}
      <BulkImportModal open={bulkOpen} onClose={() => setBulkOpen(false)} busy={busy} error={actionErr} onSubmit={doBulk} />
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-0.5 text-slate-200">{value}</div>
    </div>
  )
}

// ---------- create/edit form ----------
function ReqFormModal({
  open,
  onClose,
  editing,
  teams,
  planLines,
  busy,
  error,
  onSave,
}: {
  open: boolean
  onClose: () => void
  editing: Req | null
  teams: Team[]
  planLines: PlanLine[]
  busy: boolean
  error: string | null
  onSave: (form: Partial<Req>) => void
}) {
  const [form, setForm] = useState<Partial<Req>>({})

  useEffect(() => {
    if (open) {
      setForm(
        editing
          ? { ...editing }
          : { status: 'open', hire_type: 'new', team_id: teams[0]?.id ?? null },
      )
    }
  }, [open, editing, teams])

  const upd = (k: keyof Req, v: any) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit requisition' : 'New requisition'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onSave(form)} disabled={busy || !form.title}>
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      {error && <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <L label="Title" full>
          <input className={inp} value={form.title ?? ''} onChange={(e) => upd('title', e.target.value)} />
        </L>
        <L label="Team">
          <select className={inp} value={form.team_id ?? ''} onChange={(e) => upd('team_id', e.target.value || null)}>
            <option value="">— none —</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </L>
        <L label="Level">
          <input className={inp} value={form.level ?? ''} onChange={(e) => upd('level', e.target.value)} />
        </L>
        <L label="Status">
          <select className={inp} value={form.status ?? 'open'} onChange={(e) => upd('status', e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </L>
        <L label="Hire type">
          <select className={inp} value={form.hire_type ?? 'new'} onChange={(e) => upd('hire_type', e.target.value)}>
            {HIRE_TYPES.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </L>
        <L label="Plan line">
          <select
            className={inp}
            value={form.plan_line_id ?? ''}
            onChange={(e) => upd('plan_line_id', e.target.value || null)}
          >
            <option value="">— unlinked —</option>
            {planLines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.role_title ?? 'line'} {p.level ? `· ${p.level}` : ''} {p.quarter ? `· ${p.quarter}` : ''}
              </option>
            ))}
          </select>
        </L>
        <L label="Recruiter">
          <input className={inp} value={form.recruiter ?? ''} onChange={(e) => upd('recruiter', e.target.value)} />
        </L>
        <L label="Hiring manager">
          <input className={inp} value={form.hiring_manager ?? ''} onChange={(e) => upd('hiring_manager', e.target.value)} />
        </L>
        <L label="Target start">
          <input type="date" className={inp} value={(form.target_start ?? '').slice(0, 10)} onChange={(e) => upd('target_start', e.target.value || null)} />
        </L>
        <L label="Fill by">
          <input type="date" className={inp} value={(form.fill_by ?? '').slice(0, 10)} onChange={(e) => upd('fill_by', e.target.value || null)} />
        </L>
        <L label="Budgeted base">
          <input
            type="number"
            className={inp}
            value={form.budgeted_base ?? ''}
            onChange={(e) => upd('budgeted_base', e.target.value === '' ? null : Number(e.target.value))}
          />
        </L>
      </div>
    </Modal>
  )
}

function StatusModal({
  req,
  onClose,
  busy,
  error,
  onSubmit,
}: {
  req: Req | null
  onClose: () => void
  busy: boolean
  error: string | null
  onSubmit: (id: string, to: string, note: string) => void
}) {
  const [to, setTo] = useState('open')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (req) {
      const idx = STATUSES.indexOf(req.status ?? 'open')
      setTo(STATUSES[Math.min(idx + 1, STATUSES.length - 1)] ?? 'open')
      setNote('')
    }
  }, [req])
  return (
    <Modal
      open={!!req}
      onClose={onClose}
      title="Transition status"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => req && onSubmit(req.id, to, note)} disabled={busy}>
            {busy ? 'Saving...' : 'Apply'}
          </Button>
        </>
      }
    >
      {error && <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}
      {req && (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            <span className="text-slate-200">{req.title}</span> currently{' '}
            <Badge tone={statusTone[req.status ?? ''] ?? 'slate'}>{req.status}</Badge>
          </p>
          <L label="New status">
            <select className={inp} value={to} onChange={(e) => setTo(e.target.value)}>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </L>
          <L label="Note (optional)">
            <textarea className={inp} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
          </L>
        </div>
      )}
    </Modal>
  )
}

function LinkPlanModal({
  req,
  planLines,
  teamName,
  onClose,
  busy,
  error,
  onSubmit,
}: {
  req: Req | null
  planLines: PlanLine[]
  teamName: (id?: string | null) => string
  onClose: () => void
  busy: boolean
  error: string | null
  onSubmit: (id: string, planLineId: string) => void
}) {
  const [sel, setSel] = useState('')
  useEffect(() => {
    if (req) setSel(req.plan_line_id ?? '')
  }, [req])
  // prefer lines matching the req team
  const ordered = useMemo(() => {
    if (!req) return planLines
    return [...planLines].sort((a, b) => {
      const am = a.team_id === req.team_id ? 0 : 1
      const bm = b.team_id === req.team_id ? 0 : 1
      return am - bm
    })
  }, [planLines, req])
  return (
    <Modal
      open={!!req}
      onClose={onClose}
      title="Link to plan line"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => req && onSubmit(req.id, sel)} disabled={busy}>
            {busy ? 'Saving...' : 'Link'}
          </Button>
        </>
      }
    >
      {error && <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}
      {req && (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">
            Reconcile <span className="text-slate-200">{req.title}</span> against an approved plan line so it counts
            toward plan-vs-actual.
          </p>
          <L label="Plan line">
            <select className={inp} value={sel} onChange={(e) => setSel(e.target.value)}>
              <option value="">— unlink —</option>
              {ordered.map((p) => (
                <option key={p.id} value={p.id}>
                  {teamName(p.team_id)} · {p.role_title ?? 'line'} {p.level ? `· ${p.level}` : ''}{' '}
                  {p.quarter ? `· ${p.quarter}` : ''} {p.count ? `(×${p.count})` : ''}
                </option>
              ))}
            </select>
          </L>
        </div>
      )}
    </Modal>
  )
}

const SAMPLE_BULK = `title,team_id,level,status,recruiter,fill_by,budgeted_base
Senior Backend Engineer,,L5,open,Dana,2026-09-30,185000
Product Designer,,L4,sourcing,Lee,2026-08-15,150000`

function BulkImportModal({
  open,
  onClose,
  busy,
  error,
  onSubmit,
}: {
  open: boolean
  onClose: () => void
  busy: boolean
  error: string | null
  onSubmit: (rows: any[]) => void
}) {
  const [text, setText] = useState(SAMPLE_BULK)
  const [parseErr, setParseErr] = useState<string | null>(null)
  const [rows, setRows] = useState<any[]>([])

  const parse = useCallback(() => {
    setParseErr(null)
    try {
      const lines = text.trim().split(/\r?\n/).filter(Boolean)
      if (lines.length < 2) throw new Error('Provide a header row and at least one data row.')
      const headers = lines[0].split(',').map((h) => h.trim())
      const out = lines.slice(1).map((ln) => {
        const cells = ln.split(',')
        const obj: any = {}
        headers.forEach((h, i) => {
          let v: any = (cells[i] ?? '').trim()
          if (v === '') v = null
          else if (h === 'budgeted_base' && v != null) v = Number(v)
          obj[h] = v
        })
        return obj
      })
      setRows(out)
      return out
    } catch (e: any) {
      setParseErr(e?.message || 'Could not parse CSV')
      return null
    }
  }, [text])

  useEffect(() => {
    if (open) {
      setText(SAMPLE_BULK)
      setRows([])
      setParseErr(null)
    }
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Bulk import requisitions"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={parse} disabled={busy}>
            Preview
          </Button>
          <Button
            onClick={() => {
              const parsed = rows.length ? rows : parse()
              if (parsed && parsed.length) onSubmit(parsed)
            }}
            disabled={busy}
          >
            {busy ? 'Importing...' : `Import ${rows.length || ''}`.trim()}
          </Button>
        </>
      }
    >
      {(error || parseErr) && (
        <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
          {error || parseErr}
        </div>
      )}
      <p className="mb-2 text-xs text-slate-500">
        Paste CSV. First row is the header. Supported columns: title, team_id, level, status, recruiter,
        hiring_manager, hire_type, fill_by, target_start, budgeted_base.
      </p>
      <textarea
        className={`${inp} font-mono`}
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {rows.length > 0 && (
        <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-800">
          <Table>
            <THead>
              <TR>
                <TH>Title</TH>
                <TH>Level</TH>
                <TH>Status</TH>
                <TH>Recruiter</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={i}>
                  <TD>{r.title ?? '—'}</TD>
                  <TD>{r.level ?? '—'}</TD>
                  <TD>{r.status ?? '—'}</TD>
                  <TD>{r.recruiter ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>
      )}
    </Modal>
  )
}

const inp =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none'

function L({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  )
}
