'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Stat } from '@/components/ui/Stat'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/Table'

type Workspace = { id: string; name: string }
type Plan = {
  id: string
  workspace_id: string
  name: string
  fiscal_year: number
  version: number
  status: string
  approved_by: string | null
  approved_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

const WS_KEY = 'hpr.activeWorkspace'

const STATUS_TONE: Record<string, 'slate' | 'sky' | 'amber' | 'green' | 'rose'> = {
  draft: 'slate',
  review: 'amber',
  in_review: 'amber',
  pending: 'amber',
  approved: 'green',
  active: 'sky',
  archived: 'slate',
  rejected: 'rose',
}

const STATUS_OPTIONS = ['draft', 'in_review', 'approved', 'active', 'archived']

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function PlansPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  // create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', fiscal_year: new Date().getFullYear() })

  // edit modal
  const [editing, setEditing] = useState<Plan | null>(null)
  const [editForm, setEditForm] = useState({ name: '', status: 'draft' })

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        if (!mounted) return
        setWorkspaces(ws || [])
        const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
        const initial = (stored && ws?.some((w) => w.id === stored) ? stored : ws?.[0]?.id) || ''
        setWorkspaceId(initial)
        if (!initial) setLoading(false)
      } catch (e: any) {
        if (mounted) {
          setError(e?.message || 'Failed to load workspaces')
          setLoading(false)
        }
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const loadPlans = useCallback(async (wsId: string, isRefresh = false) => {
    if (!wsId) return
    isRefresh ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const rows: Plan[] = await api.listPlans(wsId)
      setPlans(rows || [])
    } catch (e: any) {
      setError(e?.message || 'Failed to load plans')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    if (!workspaceId) return
    if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, workspaceId)
    loadPlans(workspaceId)
  }, [workspaceId, loadPlans])

  const statuses = useMemo(() => {
    const s = new Set<string>()
    plans.forEach((p) => p.status && s.add(p.status))
    return Array.from(s).sort()
  }, [plans])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return plans
      .filter((p) => (statusFilter === 'all' ? true : p.status === statusFilter))
      .filter((p) => (q ? p.name.toLowerCase().includes(q) || String(p.fiscal_year).includes(q) : true))
      .sort((a, b) => b.fiscal_year - a.fiscal_year || b.version - a.version)
  }, [plans, search, statusFilter])

  // group versions by name+fy
  const families = useMemo(() => {
    const map = new Map<string, Plan[]>()
    for (const p of plans) {
      const key = `${p.name}__${p.fiscal_year}`
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    return map
  }, [plans])

  const handleCreate = async () => {
    if (!workspaceId || !form.name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await api.createPlan({
        workspace_id: workspaceId,
        name: form.name.trim(),
        fiscal_year: Number(form.fiscal_year),
      })
      setCreateOpen(false)
      setForm({ name: '', fiscal_year: new Date().getFullYear() })
      await loadPlans(workspaceId, true)
    } catch (e: any) {
      setError(e?.message || 'Failed to create plan')
    } finally {
      setSaving(false)
    }
  }

  const openEdit = (p: Plan) => {
    setEditing(p)
    setEditForm({ name: p.name, status: p.status })
  }

  const handleUpdate = async () => {
    if (!editing) return
    setSaving(true)
    setError(null)
    try {
      const updated: Plan = await api.updatePlan(editing.id, {
        name: editForm.name.trim() || editing.name,
        status: editForm.status,
      })
      setPlans((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)))
      setEditing(null)
    } catch (e: any) {
      setError(e?.message || 'Failed to update plan')
    } finally {
      setSaving(false)
    }
  }

  const handleApprove = async (p: Plan) => {
    setBusyId(p.id)
    setError(null)
    try {
      const updated: Plan = await api.approvePlan(p.id, {})
      setPlans((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)))
    } catch (e: any) {
      setError(e?.message || 'Failed to approve plan')
    } finally {
      setBusyId(null)
    }
  }

  const handleClone = async (p: Plan) => {
    setBusyId(p.id)
    setError(null)
    try {
      await api.clonePlan(p.id, {})
      await loadPlans(workspaceId, true)
    } catch (e: any) {
      setError(e?.message || 'Failed to clone plan')
    } finally {
      setBusyId(null)
    }
  }

  const handleDelete = async (p: Plan) => {
    if (!confirm(`Delete plan "${p.name}" v${p.version}? This cannot be undone.`)) return
    setBusyId(p.id)
    setError(null)
    try {
      await api.deletePlan(p.id)
      setPlans((prev) => prev.filter((x) => x.id !== p.id))
    } catch (e: any) {
      setError(e?.message || 'Failed to delete plan')
    } finally {
      setBusyId(null)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500'
  const labelCls = 'mb-1 block text-xs font-medium text-zinc-400'

  const approvedCount = plans.filter((p) => p.status === 'approved' || p.status === 'active').length
  const draftCount = plans.filter((p) => p.status === 'draft').length

  if (loading && !plans.length && !error) return <PageSpinner label="Loading headcount plans..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Headcount Plans</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Versioned hiring plans per fiscal year. Draft, route for approval, clone to a new version.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {workspaces.length > 0 && (
            <select
              value={workspaceId}
              onChange={(e) => setWorkspaceId(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          )}
          <Button onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
            + New plan
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {!workspaceId ? (
        <EmptyState
          title="No workspace selected"
          description="Create a workspace under Setup → Workspaces before building a headcount plan."
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Plans" value={plans.length} tone="sky" />
            <Stat label="Plan families" value={families.size} hint="unique name + FY" />
            <Stat label="Approved / active" value={approvedCount} tone="green" />
            <Stat label="Drafts" value={draftCount} tone="amber" />
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-zinc-200">All plans</h2>
                  {refreshing && <Spinner />}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name or year..."
                    className="w-48 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm text-zinc-100 placeholder-zinc-600 focus:border-teal-500 focus:outline-none"
                  />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-sm text-zinc-200 focus:border-teal-500 focus:outline-none"
                  >
                    <option value="all">All statuses</option>
                    {statuses.map((s) => (
                      <option key={s} value={s}>
                        {s}
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
                    title={plans.length === 0 ? 'No plans yet' : 'No plans match your filters'}
                    description={
                      plans.length === 0
                        ? 'Create your first headcount plan to start mapping roles by team, level, and quarter.'
                        : 'Try clearing the search or status filter.'
                    }
                    action={
                      plans.length === 0 ? (
                        <Button onClick={() => setCreateOpen(true)}>+ New plan</Button>
                      ) : undefined
                    }
                  />
                </div>
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH className="pl-5">Plan</TH>
                      <TH>FY</TH>
                      <TH>Version</TH>
                      <TH>Status</TH>
                      <TH>Approved</TH>
                      <TH>Updated</TH>
                      <TH className="pr-5 text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((p) => {
                      const versionCount = families.get(`${p.name}__${p.fiscal_year}`)?.length ?? 1
                      const busy = busyId === p.id
                      return (
                        <TR key={p.id}>
                          <TD className="pl-5">
                            <Link
                              href={`/dashboard/plan/${p.id}`}
                              className="font-medium text-teal-300 hover:text-teal-200 hover:underline"
                            >
                              {p.name}
                            </Link>
                            {versionCount > 1 && (
                              <span className="ml-2 text-xs text-zinc-500">{versionCount} versions</span>
                            )}
                          </TD>
                          <TD>FY{p.fiscal_year}</TD>
                          <TD>
                            <Badge tone="slate">v{p.version}</Badge>
                          </TD>
                          <TD>
                            <Badge tone={STATUS_TONE[p.status] ?? 'slate'}>{p.status}</Badge>
                          </TD>
                          <TD className="text-xs text-zinc-400">
                            {p.approved_at ? fmtDate(p.approved_at) : '—'}
                          </TD>
                          <TD className="text-xs text-zinc-400">{fmtDate(p.updated_at)}</TD>
                          <TD className="pr-5">
                            <div className="flex items-center justify-end gap-1.5">
                              <Link href={`/dashboard/plan/${p.id}`}>
                                <Button variant="ghost" size="sm">
                                  Edit lines
                                </Button>
                              </Link>
                              <Button variant="ghost" size="sm" onClick={() => openEdit(p)} disabled={busy}>
                                Settings
                              </Button>
                              {p.status !== 'approved' && p.status !== 'active' && (
                                <Button variant="secondary" size="sm" onClick={() => handleApprove(p)} disabled={busy}>
                                  {busy ? '...' : 'Approve'}
                                </Button>
                              )}
                              <Button variant="secondary" size="sm" onClick={() => handleClone(p)} disabled={busy}>
                                Clone
                              </Button>
                              <Button variant="danger" size="sm" onClick={() => handleDelete(p)} disabled={busy}>
                                {busy ? '...' : 'Delete'}
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
        </>
      )}

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New headcount plan"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving || !form.name.trim()}>
              {saving ? 'Creating...' : 'Create plan'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Plan name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. FY26 Operating Plan"
              className={inputCls}
              autoFocus
            />
          </div>
          <div>
            <label className={labelCls}>Fiscal year</label>
            <input
              type="number"
              value={form.fiscal_year}
              onChange={(e) => setForm({ ...form, fiscal_year: Number(e.target.value) })}
              className={inputCls}
            />
          </div>
          <p className="text-xs text-zinc-500">
            New plans start at version 1 with status <span className="text-zinc-300">draft</span>. Add plan lines from
            the editor, then route for approval.
          </p>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Plan settings"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? 'Saving...' : 'Save changes'}
            </Button>
          </>
        }
      >
        {editing && (
          <div className="space-y-4">
            <div>
              <label className={labelCls}>Name</label>
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                className={inputCls}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-xs text-zinc-500">
              FY{editing.fiscal_year} · version {editing.version} · created {fmtDate(editing.created_at)}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
