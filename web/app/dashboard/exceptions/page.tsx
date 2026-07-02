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

type Exception = {
  id: string
  workspace_id: string
  req_id: string | null
  filled_position_id: string | null
  reason: string
  status: string | null
  requested_by: string | null
  approver: string | null
  decided_at: string | null
  decision_note: string | null
  created_at: string
}

type Req = {
  id: string
  title: string
  level: string | null
  status: string | null
}

function statusTone(s: string | null) {
  if (s === 'approved') return 'green' as const
  if (s === 'denied' || s === 'rejected') return 'rose' as const
  if (s === 'pending' || s === null) return 'amber' as const
  return 'slate' as const
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

export default function ExceptionsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [exceptions, setExceptions] = useState<Exception[]>([])
  const [reqs, setReqs] = useState<Req[]>([])

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'approved' | 'denied'>('all')

  const [createOpen, setCreateOpen] = useState(false)
  const [newReqId, setNewReqId] = useState<string>('')
  const [newReason, setNewReason] = useState('')

  const [deciding, setDeciding] = useState<Exception | null>(null)
  const [decision, setDecision] = useState<'approved' | 'denied'>('approved')
  const [decisionNote, setDecisionNote] = useState('')

  const reqLabel = useCallback(
    (id: string | null) => {
      if (!id) return '—'
      const r = reqs.find((x) => x.id === id)
      return r ? `${r.title}${r.level ? ` · ${r.level}` : ''}` : id.slice(0, 8)
    },
    [reqs],
  )

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
      setExceptions([])
      setReqs([])
      return
    }
    const [ex, rq] = await Promise.all([api.listExceptions(id), api.listReqs(id)])
    setExceptions(Array.isArray(ex) ? ex : [])
    setReqs(Array.isArray(rq) ? rq : [])
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
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load exceptions')
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
    try {
      setLoading(true)
      setError(null)
      await loadData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load exceptions')
    } finally {
      setLoading(false)
    }
  }

  const refresh = useCallback(async () => {
    try {
      await loadData(wsId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    }
  }, [wsId, loadData])

  const openCreate = () => {
    setNewReqId('')
    setNewReason('')
    setCreateOpen(true)
  }

  const submitException = async () => {
    if (!wsId) return
    if (!newReason.trim()) {
      setError('A reason is required to request an exception.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.createException({
        workspace_id: wsId,
        req_id: newReqId || null,
        reason: newReason.trim(),
      })
      setNotice('Exception request submitted.')
      setCreateOpen(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Submit failed')
    } finally {
      setBusy(false)
    }
  }

  const openDecide = (ex: Exception) => {
    setDeciding(ex)
    setDecision('approved')
    setDecisionNote('')
  }

  const submitDecision = async () => {
    if (!deciding) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.decideException(deciding.id, {
        status: decision,
        decision_note: decisionNote.trim() || null,
      })
      setNotice(`Exception ${decision}.`)
      setDeciding(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Decision failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (ex: Exception) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this exception request?')) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteException(ex.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return exceptions.filter((ex) => {
      const status = (ex.status ?? 'pending').toLowerCase()
      if (filter !== 'all') {
        if (filter === 'pending' && status !== 'pending') return false
        if (filter === 'approved' && status !== 'approved') return false
        if (filter === 'denied' && status !== 'denied' && status !== 'rejected') return false
      }
      if (!q) return true
      const hay = [ex.reason, ex.status, ex.requested_by, ex.approver, reqLabel(ex.req_id)].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [exceptions, search, filter, reqLabel])

  const stats = useMemo(() => {
    let pending = 0
    let approved = 0
    let denied = 0
    for (const ex of exceptions) {
      const s = (ex.status ?? 'pending').toLowerCase()
      if (s === 'pending') pending++
      else if (s === 'approved') approved++
      else if (s === 'denied' || s === 'rejected') denied++
    }
    return { pending, approved, denied, total: exceptions.length }
  }, [exceptions])

  if (loading) return <PageSpinner label="Loading exceptions..." />

  if (!wsId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create a workspace and seed sample data from the Imports & Seed page before requesting out-of-plan exceptions."
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
            <Button variant="secondary" size="sm" onClick={refresh} disabled={busy}>
              Refresh
            </Button>
            <Button size="sm" onClick={openCreate} disabled={busy}>
              Request exception
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

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Pending" value={stats.pending} tone={stats.pending > 0 ? 'amber' : 'green'} hint="Awaiting decision" />
        <Stat label="Approved" value={stats.approved} tone="green" hint="Out-of-plan allowed" />
        <Stat label="Denied" value={stats.denied} tone="rose" hint="Held to plan" />
        <Stat label="Total requests" value={stats.total} tone="sky" hint="All time" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-zinc-200">Exception requests</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Out-of-plan hires and reqs that need explicit approval before they count against budget.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search reason / requester..."
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="denied">Denied</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={exceptions.length === 0 ? 'No exception requests' : 'No requests match your filters'}
                description={
                  exceptions.length === 0
                    ? 'When a req or hire falls outside the approved plan, request an exception here for sign-off.'
                    : 'Adjust the search or filter to see more requests.'
                }
                action={
                  exceptions.length === 0 ? (
                    <Button size="sm" onClick={openCreate}>
                      Request exception
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Reason</TH>
                  <TH>Linked req</TH>
                  <TH>Status</TH>
                  <TH>Requested</TH>
                  <TH>Decision</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((ex) => {
                  const status = (ex.status ?? 'pending').toLowerCase()
                  const isPending = status === 'pending'
                  return (
                    <TR key={ex.id}>
                      <TD className="max-w-xs">
                        <div className="text-zinc-200">{ex.reason}</div>
                        {ex.requested_by && (
                          <div className="mt-0.5 text-xs text-zinc-500">by {ex.requested_by}</div>
                        )}
                      </TD>
                      <TD className="text-zinc-300">{reqLabel(ex.req_id)}</TD>
                      <TD>
                        <Badge tone={statusTone(ex.status)}>{ex.status ?? 'pending'}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-zinc-400">{fmtDate(ex.created_at)}</TD>
                      <TD>
                        {ex.decided_at ? (
                          <div className="text-xs text-zinc-400">
                            <div>{fmtDate(ex.decided_at)}</div>
                            {ex.approver && <div className="text-zinc-500">by {ex.approver}</div>}
                            {ex.decision_note && <div className="mt-0.5 text-zinc-500">“{ex.decision_note}”</div>}
                          </div>
                        ) : (
                          <span className="text-xs text-zinc-600">—</span>
                        )}
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1.5">
                          {isPending && (
                            <Button size="sm" onClick={() => openDecide(ex)} disabled={busy}>
                              Decide
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => remove(ex)} disabled={busy}>
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

      {/* Create exception modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Request out-of-plan exception"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submitException} disabled={busy}>
              {busy ? 'Submitting...' : 'Submit request'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Linked requisition (optional)
            </label>
            <select
              value={newReqId}
              onChange={(e) => setNewReqId(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="">No specific req</option>
              {reqs.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title}
                  {r.level ? ` · ${r.level}` : ''}
                  {r.status ? ` (${r.status})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Reason</label>
            <textarea
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              rows={4}
              placeholder="Why does this fall outside the approved headcount plan?"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
          </div>
        </div>
      </Modal>

      {/* Decide modal */}
      <Modal
        open={!!deciding}
        onClose={() => setDeciding(null)}
        title="Decide exception"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeciding(null)} disabled={busy}>
              Cancel
            </Button>
            <Button
              variant={decision === 'denied' ? 'danger' : 'primary'}
              onClick={submitDecision}
              disabled={busy}
            >
              {busy ? 'Saving...' : decision === 'approved' ? 'Approve' : 'Deny'}
            </Button>
          </>
        }
      >
        {deciding && (
          <div className="space-y-4">
            <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm text-zinc-300">
              {deciding.reason}
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Decision</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setDecision('approved')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    decision === 'approved'
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => setDecision('denied')}
                  className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    decision === 'denied'
                      ? 'border-rose-500/40 bg-rose-500/15 text-rose-300'
                      : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  Deny
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Decision note (optional)
              </label>
              <textarea
                value={decisionNote}
                onChange={(e) => setDecisionNote(e.target.value)}
                rows={3}
                placeholder="Rationale for the decision..."
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500"
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Exceptions</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Request and approve out-of-plan hires and requisitions with a clear audit trail.
        </p>
      </div>
      {right}
    </div>
  )
}
