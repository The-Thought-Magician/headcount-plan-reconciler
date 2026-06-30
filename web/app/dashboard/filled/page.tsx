'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Modal } from '@/components/ui/Modal'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type Workspace = { id: string; name: string }
type Team = { id: string; name: string }
type Req = { id: string; title?: string | null; team_id?: string | null; level?: string | null; plan_line_id?: string | null }
type Filled = {
  id: string
  workspace_id: string
  team_id?: string | null
  req_id?: string | null
  plan_line_id?: string | null
  person_name?: string | null
  title?: string | null
  level?: string | null
  actual_start?: string | null
  actual_base?: number | null
  actual_variable?: number | null
  burden_rate?: number | null
  hire_type?: string | null
  backfill_of?: string | null
  created_at?: string | null
}

const HIRE_TYPES = ['new', 'backfill', 'conversion']
const hireTone: Record<string, 'sky' | 'green' | 'amber' | 'slate'> = {
  new: 'sky',
  backfill: 'amber',
  conversion: 'green',
}

function money(n?: number | null) {
  if (n === null || n === undefined || isNaN(Number(n))) return '—'
  return '$' + Number(n).toLocaleString()
}
function fmtDate(s?: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString()
}
function loadedCost(f: Filled) {
  const base = Number(f.actual_base) || 0
  const variable = Number(f.actual_variable) || 0
  const burden = Number(f.burden_rate) || 0
  return Math.round((base + variable) * (1 + burden))
}

const WS_KEY = 'hpr.workspace_id'

export default function FilledPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState('')
  const [rows, setRows] = useState<Filled[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [reqs, setReqs] = useState<Req[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState<Filled | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)

  const teamName = useCallback((id?: string | null) => teams.find((t) => t.id === id)?.name ?? '—', [teams])
  const reqTitle = useCallback((id?: string | null) => reqs.find((r) => r.id === id)?.title ?? null, [reqs])

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
      const [f, t, r] = await Promise.all([api.listFilled(wsId), api.listTeams(wsId), api.listReqs(wsId)])
      setRows(f || [])
      setTeams(t || [])
      setReqs(r || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load hires')
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
    return rows.filter((f) => {
      if (teamFilter && f.team_id !== teamFilter) return false
      if (typeFilter && f.hire_type !== typeFilter) return false
      if (q) {
        const hay = `${f.person_name ?? ''} ${f.title ?? ''} ${f.level ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, teamFilter, typeFilter])

  const stats = useMemo(() => {
    const totalLoaded = rows.reduce((s, f) => s + loadedCost(f), 0)
    const totalBase = rows.reduce((s, f) => s + (Number(f.actual_base) || 0), 0)
    return {
      total: rows.length,
      linked: rows.filter((f) => f.req_id).length,
      backfill: rows.filter((f) => f.hire_type === 'backfill').length,
      totalBase,
      totalLoaded,
    }
  }, [rows])

  const byTeam = useMemo(() => {
    const m = new Map<string, { count: number; cost: number }>()
    for (const f of rows) {
      const k = f.team_id ?? 'unassigned'
      const cur = m.get(k) ?? { count: 0, cost: 0 }
      cur.count += 1
      cur.cost += loadedCost(f)
      m.set(k, cur)
    }
    return Array.from(m.entries())
      .map(([id, v]) => ({ id, name: id === 'unassigned' ? 'Unassigned' : teamName(id), ...v }))
      .sort((a, b) => b.cost - a.cost)
  }, [rows, teamName])

  const openCreate = () => {
    setEditing(null)
    setActionErr(null)
    setEditOpen(true)
  }
  const openEdit = (f: Filled) => {
    setEditing(f)
    setActionErr(null)
    setEditOpen(true)
  }

  const save = async (form: Partial<Filled>) => {
    setBusy(true)
    setActionErr(null)
    try {
      if (editing) await api.updateFilled(editing.id, form)
      else await api.createFilled({ ...form, workspace_id: wsId })
      setEditOpen(false)
      await load()
    } catch (e: any) {
      setActionErr(e?.message || 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (f: Filled) => {
    if (!confirm(`Delete hire "${f.person_name ?? f.id}"?`)) return
    try {
      await api.deleteFilled(f.id)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete')
    }
  }

  const doBulk = async (data: any[]) => {
    setBusy(true)
    setActionErr(null)
    try {
      await api.bulkFilled({ filled: data.map((d) => ({ ...d, workspace_id: wsId })) })
      setBulkOpen(false)
      await load()
    } catch (e: any) {
      setActionErr(e?.message || 'Bulk import failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !rows.length && !error) return <PageSpinner label="Loading hires..." />

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Filled Positions</h1>
          <p className="mt-1 text-sm text-slate-500">
            Ledger of actual hires, loaded cost, and the req / plan line each one filled.
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
            Record hire
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {!wsId && !loading && !error && (
        <EmptyState title="No workspace yet" description="Create a workspace under Setup to begin." />
      )}

      {wsId && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="Total hires" value={stats.total} />
            <Stat label="Linked to req" value={stats.linked} tone="sky" hint={`${stats.total - stats.linked} unlinked`} />
            <Stat label="Backfills" value={stats.backfill} tone="amber" />
            <Stat label="Base comp" value={money(stats.totalBase)} />
            <Stat label="Loaded cost" value={money(stats.totalLoaded)} tone="green" hint="incl. variable + burden" />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-slate-200">Loaded cost by team</h2>
            </CardHeader>
            <CardBody>
              {byTeam.length === 0 ? (
                <p className="text-sm text-slate-500">No hires to chart yet.</p>
              ) : (
                <div className="space-y-2">
                  {byTeam.map((t) => {
                    const max = Math.max(...byTeam.map((x) => x.cost), 1)
                    return (
                      <div key={t.id} className="flex items-center gap-3">
                        <div className="w-32 shrink-0 truncate text-xs text-slate-400" title={t.name}>
                          {t.name}
                        </div>
                        <div className="flex h-5 flex-1 items-center rounded bg-slate-800/60">
                          <div className="h-5 rounded bg-emerald-500/70" style={{ width: `${(t.cost / max) * 100}%` }} />
                        </div>
                        <div className="w-24 shrink-0 text-right text-xs font-medium text-slate-300">
                          {money(t.cost)}
                        </div>
                        <div className="w-10 shrink-0 text-right text-xs text-slate-500">{t.count}</div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardBody>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, title, level..."
              className="min-w-[220px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
            />
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
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">All types</option>
              {HIRE_TYPES.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
            {(search || teamFilter || typeFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setTeamFilter('')
                  setTypeFilter('')
                }}
              >
                Clear
              </Button>
            )}
          </div>

          <Card>
            {filtered.length === 0 ? (
              <CardBody>
                <EmptyState
                  title={rows.length === 0 ? 'No hires recorded' : 'No matches'}
                  description={
                    rows.length === 0
                      ? 'Record your first hire or bulk-import from your HRIS export.'
                      : 'Adjust filters to see more hires.'
                  }
                  action={rows.length === 0 ? <Button onClick={openCreate}>Record hire</Button> : undefined}
                />
              </CardBody>
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>Person</TH>
                    <TH>Title</TH>
                    <TH>Team</TH>
                    <TH>Level</TH>
                    <TH>Type</TH>
                    <TH>Req</TH>
                    <TH>Start</TH>
                    <TH className="text-right">Base</TH>
                    <TH className="text-right">Loaded</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((f) => (
                    <TR key={f.id}>
                      <TD className="font-medium text-slate-100">{f.person_name ?? '—'}</TD>
                      <TD>{f.title ?? '—'}</TD>
                      <TD>{teamName(f.team_id)}</TD>
                      <TD>{f.level ?? '—'}</TD>
                      <TD>
                        <Badge tone={hireTone[f.hire_type ?? ''] ?? 'slate'}>{f.hire_type ?? '—'}</Badge>
                      </TD>
                      <TD>
                        {f.req_id ? (
                          <Badge tone="sky">{reqTitle(f.req_id) ?? 'linked'}</Badge>
                        ) : (
                          <Badge tone="amber">unlinked</Badge>
                        )}
                      </TD>
                      <TD>{fmtDate(f.actual_start)}</TD>
                      <TD className="text-right">{money(f.actual_base)}</TD>
                      <TD className="text-right text-emerald-300">{money(loadedCost(f))}</TD>
                      <TD className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => openEdit(f)}>
                            Edit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(f)}>
                            Delete
                          </Button>
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}

      <FilledFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        editing={editing}
        teams={teams}
        reqs={reqs}
        busy={busy}
        error={actionErr}
        onSave={save}
      />

      <BulkFilledModal open={bulkOpen} onClose={() => setBulkOpen(false)} busy={busy} error={actionErr} onSubmit={doBulk} />
    </div>
  )
}

function FilledFormModal({
  open,
  onClose,
  editing,
  teams,
  reqs,
  busy,
  error,
  onSave,
}: {
  open: boolean
  onClose: () => void
  editing: Filled | null
  teams: Team[]
  reqs: Req[]
  busy: boolean
  error: string | null
  onSave: (form: Partial<Filled>) => void
}) {
  const [form, setForm] = useState<Partial<Filled>>({})

  useEffect(() => {
    if (open) {
      setForm(
        editing ? { ...editing } : { hire_type: 'new', burden_rate: 0.25, team_id: teams[0]?.id ?? null },
      )
    }
  }, [open, editing, teams])

  const upd = (k: keyof Filled, v: any) => setForm((f) => ({ ...f, [k]: v }))

  // When selecting a req, prefill team/level/plan link
  const onPickReq = (reqId: string) => {
    const r = reqs.find((x) => x.id === reqId)
    setForm((f) => ({
      ...f,
      req_id: reqId || null,
      team_id: r?.team_id ?? f.team_id ?? null,
      level: f.level || r?.level || null,
      plan_line_id: r?.plan_line_id ?? f.plan_line_id ?? null,
    }))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? 'Edit hire' : 'Record hire'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onSave(form)} disabled={busy || !form.person_name}>
            {busy ? 'Saving...' : editing ? 'Save changes' : 'Record'}
          </Button>
        </>
      }
    >
      {error && <div className="mb-3 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</div>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <L label="Person name" full>
          <input className={inp} value={form.person_name ?? ''} onChange={(e) => upd('person_name', e.target.value)} />
        </L>
        <L label="Title">
          <input className={inp} value={form.title ?? ''} onChange={(e) => upd('title', e.target.value)} />
        </L>
        <L label="Level">
          <input className={inp} value={form.level ?? ''} onChange={(e) => upd('level', e.target.value)} />
        </L>
        <L label="Linked requisition" full>
          <select className={inp} value={form.req_id ?? ''} onChange={(e) => onPickReq(e.target.value)}>
            <option value="">— no req —</option>
            {reqs.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title ?? 'Untitled'} {r.level ? `· ${r.level}` : ''}
              </option>
            ))}
          </select>
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
        <L label="Hire type">
          <select className={inp} value={form.hire_type ?? 'new'} onChange={(e) => upd('hire_type', e.target.value)}>
            {HIRE_TYPES.map((h) => (
              <option key={h} value={h}>
                {h}
              </option>
            ))}
          </select>
        </L>
        <L label="Actual start">
          <input type="date" className={inp} value={(form.actual_start ?? '').slice(0, 10)} onChange={(e) => upd('actual_start', e.target.value || null)} />
        </L>
        <L label="Backfill of (name)">
          <input className={inp} value={form.backfill_of ?? ''} onChange={(e) => upd('backfill_of', e.target.value || null)} />
        </L>
        <L label="Actual base">
          <input
            type="number"
            className={inp}
            value={form.actual_base ?? ''}
            onChange={(e) => upd('actual_base', e.target.value === '' ? null : Number(e.target.value))}
          />
        </L>
        <L label="Actual variable">
          <input
            type="number"
            className={inp}
            value={form.actual_variable ?? ''}
            onChange={(e) => upd('actual_variable', e.target.value === '' ? null : Number(e.target.value))}
          />
        </L>
        <L label="Burden rate (e.g. 0.25)">
          <input
            type="number"
            step="0.01"
            className={inp}
            value={form.burden_rate ?? ''}
            onChange={(e) => upd('burden_rate', e.target.value === '' ? null : Number(e.target.value))}
          />
        </L>
      </div>
      {(form.actual_base != null || form.actual_variable != null) && (
        <p className="mt-3 text-xs text-slate-500">
          Loaded cost preview:{' '}
          <span className="font-medium text-emerald-300">{money(loadedCost(form as Filled))}</span>
        </p>
      )}
    </Modal>
  )
}

const SAMPLE = `person_name,title,level,hire_type,actual_start,actual_base,actual_variable,burden_rate
Avery Chen,Backend Engineer,L4,new,2026-07-01,165000,15000,0.25
Sam Okoro,Designer,L3,backfill,2026-07-15,140000,0,0.25`

function BulkFilledModal({
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
  const [text, setText] = useState(SAMPLE)
  const [parseErr, setParseErr] = useState<string | null>(null)
  const [rows, setRows] = useState<any[]>([])

  const NUM = new Set(['actual_base', 'actual_variable', 'burden_rate'])

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
          else if (NUM.has(h)) v = Number(v)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  useEffect(() => {
    if (open) {
      setText(SAMPLE)
      setRows([])
      setParseErr(null)
    }
  }, [open])

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Bulk import hires"
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
        Paste CSV. Columns: person_name, title, level, team_id, req_id, hire_type, actual_start, actual_base,
        actual_variable, burden_rate, backfill_of.
      </p>
      <textarea className={`${inp} font-mono`} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      {rows.length > 0 && (
        <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-800">
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH>Title</TH>
                <TH>Type</TH>
                <TH className="text-right">Base</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={i}>
                  <TD>{r.person_name ?? '—'}</TD>
                  <TD>{r.title ?? '—'}</TD>
                  <TD>{r.hire_type ?? '—'}</TD>
                  <TD className="text-right">{money(r.actual_base)}</TD>
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
