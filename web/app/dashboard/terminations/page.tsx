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
type Termination = {
  id: string
  workspace_id: string
  team_id?: string | null
  person_name?: string | null
  level?: string | null
  title?: string | null
  term_date?: string | null
  reason?: string | null
  base?: number | null
  created_at?: string | null
}

const REASONS = ['voluntary', 'involuntary', 'layoff', 'retirement', 'end_of_contract', 'other']
const reasonTone: Record<string, 'sky' | 'amber' | 'rose' | 'slate' | 'green'> = {
  voluntary: 'amber',
  involuntary: 'rose',
  layoff: 'rose',
  retirement: 'sky',
  end_of_contract: 'slate',
  other: 'slate',
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
function monthKey(s?: string | null) {
  if (!s) return null
  const d = new Date(s)
  if (isNaN(d.getTime())) return null
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const WS_KEY = 'hpr.workspace_id'

export default function TerminationsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState('')
  const [rows, setRows] = useState<Termination[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('')
  const [reasonFilter, setReasonFilter] = useState('')

  const [editOpen, setEditOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionErr, setActionErr] = useState<string | null>(null)

  const teamName = useCallback((id?: string | null) => teams.find((t) => t.id === id)?.name ?? '—', [teams])

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
      const [t, teamRows] = await Promise.all([api.listTerminations(wsId), api.listTeams(wsId)])
      setRows(t || [])
      setTeams(teamRows || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load terminations')
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
    return rows.filter((r) => {
      if (teamFilter && r.team_id !== teamFilter) return false
      if (reasonFilter && r.reason !== reasonFilter) return false
      if (q) {
        const hay = `${r.person_name ?? ''} ${r.title ?? ''} ${r.level ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, search, teamFilter, reasonFilter])

  const stats = useMemo(() => {
    const totalBase = rows.reduce((s, r) => s + (Number(r.base) || 0), 0)
    const involuntary = rows.filter((r) => r.reason === 'involuntary' || r.reason === 'layoff').length
    return {
      total: rows.length,
      voluntary: rows.filter((r) => r.reason === 'voluntary').length,
      involuntary,
      totalBase,
      reclaimed: totalBase,
    }
  }, [rows])

  // departures-by-month sparkline
  const byMonth = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const k = monthKey(r.term_date)
      if (k) m.set(k, (m.get(k) || 0) + 1)
    }
    return Array.from(m.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-12)
      .map(([month, count]) => ({ month, count }))
  }, [rows])

  const save = async (form: Partial<Termination>) => {
    setBusy(true)
    setActionErr(null)
    try {
      await api.createTermination({ ...form, workspace_id: wsId })
      setEditOpen(false)
      await load()
    } catch (e: any) {
      setActionErr(e?.message || 'Failed to save')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (r: Termination) => {
    if (!confirm(`Delete departure record for "${r.person_name ?? r.id}"?`)) return
    try {
      await api.deleteTermination(r.id)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Failed to delete')
    }
  }

  const doBulk = async (data: any[]) => {
    setBusy(true)
    setActionErr(null)
    try {
      await api.bulkTerminations({ terminations: data.map((d) => ({ ...d, workspace_id: wsId })) })
      setBulkOpen(false)
      await load()
    } catch (e: any) {
      setActionErr(e?.message || 'Bulk import failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !rows.length && !error) return <PageSpinner label="Loading terminations..." />

  const maxMonth = Math.max(...byMonth.map((m) => m.count), 1)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-100">Terminations</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Departures ledger. Drives net headcount and the backfill-vs-growth classifier.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {workspaces.length > 1 && (
            <select
              value={wsId}
              onChange={(e) => setWsId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
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
          <Button onClick={() => { setActionErr(null); setEditOpen(true) }} disabled={!wsId}>
            Record departure
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total departures" value={stats.total} />
            <Stat label="Voluntary" value={stats.voluntary} tone="amber" />
            <Stat label="Involuntary / layoff" value={stats.involuntary} tone="rose" />
            <Stat label="Base comp freed" value={money(stats.reclaimed)} tone="green" />
          </div>

          <Card>
            <CardHeader>
              <h2 className="text-sm font-semibold text-zinc-200">Departures by month</h2>
            </CardHeader>
            <CardBody>
              {byMonth.length === 0 ? (
                <p className="text-sm text-zinc-500">No dated departures to chart yet.</p>
              ) : (
                <div className="flex items-end gap-2" style={{ height: 120 }}>
                  {byMonth.map((m) => (
                    <div key={m.month} className="flex flex-1 flex-col items-center justify-end gap-1">
                      <div className="text-xs font-medium text-zinc-300">{m.count}</div>
                      <div
                        className="w-full rounded-t bg-rose-500/60"
                        style={{ height: `${(m.count / maxMonth) * 90}px`, minHeight: 4 }}
                        title={`${m.month}: ${m.count}`}
                      />
                      <div className="text-[10px] text-zinc-500">{m.month.slice(2)}</div>
                    </div>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, title, level..."
              className="min-w-[220px] flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600"
            />
            <select
              value={teamFilter}
              onChange={(e) => setTeamFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="">All teams</option>
              {teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <select
              value={reasonFilter}
              onChange={(e) => setReasonFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="">All reasons</option>
              {REASONS.map((r) => (
                <option key={r} value={r}>
                  {r.replace('_', ' ')}
                </option>
              ))}
            </select>
            {(search || teamFilter || reasonFilter) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setTeamFilter('')
                  setReasonFilter('')
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
                  title={rows.length === 0 ? 'No departures recorded' : 'No matches'}
                  description={
                    rows.length === 0
                      ? 'Record a departure or bulk-import from your HRIS offboarding export.'
                      : 'Adjust filters to see more departures.'
                  }
                  action={
                    rows.length === 0 ? (
                      <Button onClick={() => { setActionErr(null); setEditOpen(true) }}>Record departure</Button>
                    ) : undefined
                  }
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
                    <TH>Reason</TH>
                    <TH>Term date</TH>
                    <TH className="text-right">Base</TH>
                    <TH className="text-right">Actions</TH>
                  </TR>
                </THead>
                <TBody>
                  {filtered.map((r) => (
                    <TR key={r.id}>
                      <TD className="font-medium text-zinc-100">{r.person_name ?? '—'}</TD>
                      <TD>{r.title ?? '—'}</TD>
                      <TD>{teamName(r.team_id)}</TD>
                      <TD>{r.level ?? '—'}</TD>
                      <TD>
                        <Badge tone={reasonTone[r.reason ?? ''] ?? 'slate'}>
                          {(r.reason ?? '—').replace('_', ' ')}
                        </Badge>
                      </TD>
                      <TD>{fmtDate(r.term_date)}</TD>
                      <TD className="text-right">{money(r.base)}</TD>
                      <TD className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => remove(r)}>
                          Delete
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </Card>
        </>
      )}

      <TermFormModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        teams={teams}
        busy={busy}
        error={actionErr}
        onSave={save}
      />

      <BulkTermModal open={bulkOpen} onClose={() => setBulkOpen(false)} busy={busy} error={actionErr} onSubmit={doBulk} />
    </div>
  )
}

function TermFormModal({
  open,
  onClose,
  teams,
  busy,
  error,
  onSave,
}: {
  open: boolean
  onClose: () => void
  teams: Team[]
  busy: boolean
  error: string | null
  onSave: (form: Partial<Termination>) => void
}) {
  const [form, setForm] = useState<Partial<Termination>>({})

  useEffect(() => {
    if (open) setForm({ reason: 'voluntary', team_id: teams[0]?.id ?? null, term_date: new Date().toISOString().slice(0, 10) })
  }, [open, teams])

  const upd = (k: keyof Termination, v: any) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Record departure"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => onSave(form)} disabled={busy || !form.person_name}>
            {busy ? 'Saving...' : 'Record'}
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
        <L label="Reason">
          <select className={inp} value={form.reason ?? 'voluntary'} onChange={(e) => upd('reason', e.target.value)}>
            {REASONS.map((r) => (
              <option key={r} value={r}>
                {r.replace('_', ' ')}
              </option>
            ))}
          </select>
        </L>
        <L label="Term date">
          <input type="date" className={inp} value={(form.term_date ?? '').slice(0, 10)} onChange={(e) => upd('term_date', e.target.value || null)} />
        </L>
        <L label="Base comp">
          <input
            type="number"
            className={inp}
            value={form.base ?? ''}
            onChange={(e) => upd('base', e.target.value === '' ? null : Number(e.target.value))}
          />
        </L>
      </div>
    </Modal>
  )
}

const SAMPLE = `person_name,title,level,reason,term_date,base
Jordan Pratt,Account Executive,L4,voluntary,2026-06-15,120000
Riley Adams,Support Lead,L3,layoff,2026-06-30,95000`

function BulkTermModal({
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
          else if (h === 'base') v = Number(v)
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
      title="Bulk import departures"
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
      <p className="mb-2 text-xs text-zinc-500">
        Paste CSV. Columns: person_name, title, level, team_id, reason, term_date, base.
      </p>
      <textarea className={`${inp} font-mono`} rows={8} value={text} onChange={(e) => setText(e.target.value)} />
      {rows.length > 0 && (
        <div className="mt-3 max-h-40 overflow-auto rounded-lg border border-zinc-800">
          <Table>
            <THead>
              <TR>
                <TH>Person</TH>
                <TH>Reason</TH>
                <TH>Date</TH>
                <TH className="text-right">Base</TH>
              </TR>
            </THead>
            <TBody>
              {rows.map((r, i) => (
                <TR key={i}>
                  <TD>{r.person_name ?? '—'}</TD>
                  <TD>{r.reason ?? '—'}</TD>
                  <TD>{r.term_date ?? '—'}</TD>
                  <TD className="text-right">{money(r.base)}</TD>
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
  'w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-teal-500 focus:outline-none'

function L({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <label className={`block ${full ? 'sm:col-span-2' : ''}`}>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</span>
      {children}
    </label>
  )
}
