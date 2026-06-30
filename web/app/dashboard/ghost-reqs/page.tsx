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

type Ghost = {
  id: string
  workspace_id: string
  req_id: string | null
  reason: string | null
  severity: string | null
  days_overdue: number | null
  status: string | null
  resolution: string | null
  resolved_by: string | null
  resolved_at: string | null
  created_at: string
}

const WS_KEY = 'hpr_ws'

function sevTone(sev: string | null): 'rose' | 'amber' | 'sky' | 'slate' {
  const s = (sev || '').toLowerCase()
  if (s === 'high' || s === 'critical') return 'rose'
  if (s === 'medium' || s === 'warning') return 'amber'
  if (s === 'low') return 'sky'
  return 'slate'
}

function statusTone(status: string | null): 'green' | 'amber' | 'sky' | 'slate' {
  const s = (status || '').toLowerCase()
  if (s === 'resolved' || s === 'closed') return 'green'
  if (s === 'open' || s === 'new') return 'amber'
  if (s === 'triaged' || s === 'investigating') return 'sky'
  return 'slate'
}

const RESOLUTIONS = [
  { value: 'closed_req', label: 'Close the requisition' },
  { value: 'linked_to_plan', label: 'Link to plan line' },
  { value: 'reopened', label: 'Legitimate — keep open' },
  { value: 'duplicate', label: 'Duplicate / data error' },
  { value: 'transferred', label: 'Transferred to another team' },
]

export default function GhostReqsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([])
  const [wsId, setWsId] = useState('')

  const [ghosts, setGhosts] = useState<Ghost[]>([])
  const [scanning, setScanning] = useState(false)
  const [scanNote, setScanNote] = useState<string | null>(null)

  const [statusFilter, setStatusFilter] = useState<'open' | 'resolved' | 'all'>('open')
  const [sevFilter, setSevFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all')
  const [search, setSearch] = useState('')

  // resolve modal
  const [resolveTarget, setResolveTarget] = useState<Ghost | null>(null)
  const [resolveForm, setResolveForm] = useState({ resolution: RESOLUTIONS[0].value, note: '' })
  const [saving, setSaving] = useState(false)

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
      setGhosts([])
      return
    }
    const g = (await api.listGhostReqs(workspaceId)) as Ghost[]
    setGhosts(g || [])
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const chosen = await loadWorkspaces()
        if (chosen) await loadData(chosen)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load ghost reqs')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadWorkspaces, loadData])

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
    setScanNote(null)
    setLoading(true)
    try {
      await loadData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }

  const onScan = async () => {
    if (!wsId) return
    setScanning(true)
    setError(null)
    setScanNote(null)
    try {
      const res = (await api.scanGhostReqs({ workspace_id: wsId })) as Ghost[]
      await refresh()
      setScanNote(`Scan complete — ${Array.isArray(res) ? res.length : 0} ghost-req finding(s).`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to scan')
    } finally {
      setScanning(false)
    }
  }

  const submitResolve = async () => {
    if (!resolveTarget) return
    setSaving(true)
    setError(null)
    try {
      await api.resolveGhostReq(resolveTarget.id, {
        resolution: resolveForm.resolution,
        note: resolveForm.note || undefined,
      })
      setResolveTarget(null)
      setResolveForm({ resolution: RESOLUTIONS[0].value, note: '' })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to resolve')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = async (g: Ghost) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this ghost-req finding?')) return
    setError(null)
    try {
      await api.deleteGhostReq(g.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete finding')
    }
  }

  const isOpen = (g: Ghost) => {
    const s = (g.status || '').toLowerCase()
    return s !== 'resolved' && s !== 'closed'
  }

  const counts = useMemo(() => {
    const open = ghosts.filter(isOpen)
    return {
      open: open.length,
      resolved: ghosts.length - open.length,
      high: open.filter((g) => sevTone(g.severity) === 'rose').length,
      maxOverdue: open.reduce((m, g) => Math.max(m, g.days_overdue ?? 0), 0),
    }
  }, [ghosts])

  const filtered = useMemo(() => {
    return ghosts
      .filter((g) => {
        if (statusFilter === 'all') return true
        if (statusFilter === 'open') return isOpen(g)
        return !isOpen(g)
      })
      .filter((g) => (sevFilter === 'all' ? true : (g.severity || '').toLowerCase() === sevFilter))
      .filter((g) => {
        if (!search.trim()) return true
        const q = search.toLowerCase()
        return (
          (g.reason ?? '').toLowerCase().includes(q) ||
          (g.req_id ?? '').toLowerCase().includes(q) ||
          (g.resolution ?? '').toLowerCase().includes(q)
        )
      })
      .sort((a, b) => {
        const sevOrder = (g: Ghost) => ({ rose: 0, amber: 1, sky: 2, slate: 3 })[sevTone(g.severity)]
        const so = sevOrder(a) - sevOrder(b)
        if (so !== 0) return so
        return (b.days_overdue ?? 0) - (a.days_overdue ?? 0)
      })
  }, [ghosts, statusFilter, sevFilter, search])

  if (loading) return <PageSpinner label="Loading ghost-req queue..." />

  if (workspaces.length === 0) {
    return (
      <div className="space-y-6">
        <Header workspaces={workspaces} wsId={wsId} onSelectWorkspace={onSelectWorkspace} onScan={onScan} scanning={scanning} scanDisabled />
        <EmptyState title="No workspace yet" description="Create a workspace before scanning for ghost requisitions." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Header
        workspaces={workspaces}
        wsId={wsId}
        onSelectWorkspace={onSelectWorkspace}
        onScan={onScan}
        scanning={scanning}
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {scanNote && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">{scanNote}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open findings" value={counts.open} tone={counts.open > 0 ? 'amber' : 'green'} />
        <Stat label="High severity" value={counts.high} tone={counts.high > 0 ? 'rose' : 'default'} />
        <Stat label="Max days overdue" value={counts.maxOverdue} tone={counts.maxOverdue > 30 ? 'rose' : 'default'} />
        <Stat label="Resolved" value={counts.resolved} tone="green" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-100">Triage Queue</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reason / req / resolution"
              className="w-56 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
            />
            <select
              value={sevFilter}
              onChange={(e) => setSevFilter(e.target.value as typeof sevFilter)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="all">All severities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <div className="flex overflow-hidden rounded-lg border border-slate-700">
              {(['open', 'resolved', 'all'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    statusFilter === s ? 'bg-sky-600 text-white' : 'bg-slate-900 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardBody className="px-0 py-0">
          {ghosts.length === 0 ? (
            <div className="px-5 py-8">
              <EmptyState
                title="No ghost reqs found"
                description="Run a scan to detect requisitions with no plan line, past their fill-by date, or otherwise abandoned."
                action={
                  <Button onClick={onScan} disabled={scanning}>
                    {scanning ? 'Scanning...' : 'Scan now'}
                  </Button>
                }
              />
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-slate-500">No findings match these filters.</div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Severity</TH>
                  <TH>Reason</TH>
                  <TH>Req</TH>
                  <TH className="text-right">Days overdue</TH>
                  <TH>Status</TH>
                  <TH>Resolution</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((g) => (
                  <TR key={g.id}>
                    <TD>
                      <Badge tone={sevTone(g.severity)}>{g.severity ?? 'unknown'}</Badge>
                    </TD>
                    <TD className="max-w-xs text-slate-300">{g.reason ?? '—'}</TD>
                    <TD className="font-mono text-xs text-slate-400">{g.req_id ? g.req_id.slice(0, 8) : '—'}</TD>
                    <TD className="text-right">
                      <span className={(g.days_overdue ?? 0) > 30 ? 'text-rose-300' : (g.days_overdue ?? 0) > 0 ? 'text-amber-300' : 'text-slate-400'}>
                        {g.days_overdue ?? 0}
                      </span>
                    </TD>
                    <TD>
                      <Badge tone={statusTone(g.status)}>{g.status ?? 'open'}</Badge>
                    </TD>
                    <TD className="text-slate-400">{g.resolution ?? '—'}</TD>
                    <TD className="text-right">
                      <div className="flex justify-end gap-1.5">
                        {isOpen(g) && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => {
                              setResolveTarget(g)
                              setResolveForm({ resolution: RESOLUTIONS[0].value, note: '' })
                            }}
                          >
                            Resolve
                          </Button>
                        )}
                        <Button size="sm" variant="danger" onClick={() => onDelete(g)}>
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      {/* Resolve modal */}
      <Modal
        open={!!resolveTarget}
        onClose={() => setResolveTarget(null)}
        title="Resolve ghost req"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResolveTarget(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitResolve} disabled={saving}>
              {saving ? 'Resolving...' : 'Mark resolved'}
            </Button>
          </>
        }
      >
        {resolveTarget && (
          <div className="space-y-3">
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 px-3 py-2 text-sm text-slate-300">
              <div className="flex items-center gap-2">
                <Badge tone={sevTone(resolveTarget.severity)}>{resolveTarget.severity ?? 'unknown'}</Badge>
                <span>{resolveTarget.reason ?? 'Ghost requisition'}</span>
              </div>
              {(resolveTarget.days_overdue ?? 0) > 0 && (
                <div className="mt-1 text-xs text-slate-500">{resolveTarget.days_overdue} days overdue</div>
              )}
            </div>
            <Field label="Resolution">
              <select
                value={resolveForm.resolution}
                onChange={(e) => setResolveForm({ ...resolveForm, resolution: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                {RESOLUTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Note">
              <textarea
                value={resolveForm.note}
                onChange={(e) => setResolveForm({ ...resolveForm, note: e.target.value })}
                rows={3}
                placeholder="Context for the resolution"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
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
  onScan,
  scanning,
  scanDisabled,
}: {
  workspaces: { id: string; name: string }[]
  wsId: string
  onSelectWorkspace: (id: string) => void
  onScan: () => void
  scanning: boolean
  scanDisabled?: boolean
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">Ghost Reqs</h1>
        <p className="mt-0.5 text-sm text-slate-500">Triage requisitions with no plan line, past fill-by, or abandoned, then resolve them.</p>
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
        <Button onClick={onScan} disabled={scanning || scanDisabled}>
          {scanning ? 'Scanning...' : 'Scan for ghost reqs'}
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}
