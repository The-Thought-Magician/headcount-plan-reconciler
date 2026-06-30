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

type Threshold = {
  id: string
  workspace_id: string
  name: string
  metric: string
  comparator: string
  value: number
  team_id: string | null
  is_active: boolean
  created_by: string | null
  created_at: string
}

type Alert = {
  id: string
  workspace_id: string
  threshold_id: string | null
  title: string
  detail: string | null
  severity: string | null
  status: string | null
  assigned_to: string | null
  acknowledged_at: string | null
  created_at: string
}

const METRICS = [
  { value: 'cost_variance', label: 'Cost variance' },
  { value: 'count_variance', label: 'Headcount count variance' },
  { value: 'open_count', label: 'Open requisitions' },
  { value: 'ghost_reqs', label: 'Ghost reqs' },
  { value: 'burn_variance', label: 'Burn vs budget variance' },
  { value: 'net_headcount', label: 'Net headcount' },
] as const

const COMPARATORS = [
  { value: 'gt', label: 'greater than (>)' },
  { value: 'gte', label: 'at least (>=)' },
  { value: 'lt', label: 'less than (<)' },
  { value: 'lte', label: 'at most (<=)' },
  { value: 'eq', label: 'equals (=)' },
] as const

function comparatorSymbol(c: string) {
  return { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=' }[c] ?? c
}

function metricLabel(m: string) {
  return METRICS.find((x) => x.value === m)?.label ?? m
}

function severityTone(s: string | null) {
  if (s === 'critical' || s === 'high') return 'rose' as const
  if (s === 'medium' || s === 'warning') return 'amber' as const
  if (s === 'low' || s === 'info') return 'sky' as const
  return 'slate' as const
}

function statusTone(s: string | null) {
  if (s === 'resolved') return 'green' as const
  if (s === 'acknowledged') return 'sky' as const
  if (s === 'open' || s === 'active') return 'amber' as const
  return 'slate' as const
}

function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}

type ThresholdForm = {
  name: string
  metric: string
  comparator: string
  value: string
  is_active: boolean
}

const emptyForm: ThresholdForm = {
  name: '',
  metric: 'cost_variance',
  comparator: 'gt',
  value: '',
  is_active: true,
}

export default function AlertsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [thresholds, setThresholds] = useState<Threshold[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])

  const [alertSearch, setAlertSearch] = useState('')
  const [alertFilter, setAlertFilter] = useState<'all' | 'open' | 'acknowledged' | 'resolved'>('all')
  const [sevFilter, setSevFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Threshold | null>(null)
  const [form, setForm] = useState<ThresholdForm>(emptyForm)

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
      setThresholds([])
      setAlerts([])
      return
    }
    const [th, al] = await Promise.all([api.listThresholds(id), api.listAlerts(id)])
    setThresholds(Array.isArray(th) ? th : [])
    setAlerts(Array.isArray(al) ? al : [])
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
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load alerts')
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
      setError(e instanceof Error ? e.message : 'Failed to load alerts')
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
    setEditing(null)
    setForm(emptyForm)
    setFormOpen(true)
  }

  const openEdit = (t: Threshold) => {
    setEditing(t)
    setForm({
      name: t.name,
      metric: t.metric,
      comparator: t.comparator,
      value: String(t.value),
      is_active: t.is_active,
    })
    setFormOpen(true)
  }

  const saveThreshold = async () => {
    if (!wsId) return
    if (!form.name.trim()) {
      setError('Threshold name is required.')
      return
    }
    if (form.value.trim() === '' || Number.isNaN(Number(form.value))) {
      setError('A numeric value is required.')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (editing) {
        await api.updateThreshold(editing.id, {
          name: form.name.trim(),
          metric: form.metric,
          comparator: form.comparator,
          value: Number(form.value),
          is_active: form.is_active,
        })
        setNotice('Threshold updated.')
      } else {
        await api.createThreshold({
          workspace_id: wsId,
          name: form.name.trim(),
          metric: form.metric,
          comparator: form.comparator,
          value: Number(form.value),
          is_active: form.is_active,
        })
        setNotice('Threshold created.')
      }
      setFormOpen(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (t: Threshold) => {
    setBusy(true)
    setError(null)
    try {
      await api.updateThreshold(t.id, { is_active: !t.is_active })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const removeThreshold = async (t: Threshold) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete threshold "${t.name}"?`)) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteThreshold(t.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const evaluate = async () => {
    if (!wsId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.evaluateThresholds({ workspace_id: wsId })
      const count = Array.isArray(res) ? res.length : 0
      setNotice(
        count === 0
          ? 'Evaluation complete — no thresholds breached.'
          : `Evaluation complete — ${count} alert${count === 1 ? '' : 's'} generated.`,
      )
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Evaluation failed')
    } finally {
      setBusy(false)
    }
  }

  const ack = async (a: Alert) => {
    setBusy(true)
    setError(null)
    try {
      await api.ackAlert(a.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Acknowledge failed')
    } finally {
      setBusy(false)
    }
  }

  const resolve = async (a: Alert) => {
    setBusy(true)
    setError(null)
    try {
      await api.resolveAlert(a.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolve failed')
    } finally {
      setBusy(false)
    }
  }

  const removeAlert = async (a: Alert) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this alert?')) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteAlert(a.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const filteredAlerts = useMemo(() => {
    const q = alertSearch.trim().toLowerCase()
    return alerts.filter((a) => {
      const status = (a.status ?? 'open').toLowerCase()
      if (alertFilter !== 'all') {
        if (alertFilter === 'open' && status !== 'open' && status !== 'active') return false
        if (alertFilter === 'acknowledged' && status !== 'acknowledged') return false
        if (alertFilter === 'resolved' && status !== 'resolved') return false
      }
      if (sevFilter !== 'all' && (a.severity ?? '').toLowerCase() !== sevFilter) return false
      if (!q) return true
      const hay = [a.title, a.detail, a.severity, a.status].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [alerts, alertSearch, alertFilter, sevFilter])

  const stats = useMemo(() => {
    let open = 0
    let critical = 0
    let resolved = 0
    for (const a of alerts) {
      const s = (a.status ?? 'open').toLowerCase()
      if (s === 'open' || s === 'active') open++
      if (s === 'resolved') resolved++
      const sev = (a.severity ?? '').toLowerCase()
      if (sev === 'critical' || sev === 'high') critical++
    }
    return { open, critical, resolved, activeThresholds: thresholds.filter((t) => t.is_active).length }
  }, [alerts, thresholds])

  if (loading) return <PageSpinner label="Loading alerts & thresholds..." />

  if (!wsId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create a workspace and seed sample data from the Imports & Seed page before configuring alert thresholds."
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
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
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
            <Button size="sm" onClick={evaluate} disabled={busy}>
              {busy ? 'Evaluating...' : 'Evaluate thresholds'}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">{notice}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Open alerts" value={stats.open} tone={stats.open > 0 ? 'amber' : 'green'} hint="Awaiting action" />
        <Stat label="Critical / high" value={stats.critical} tone={stats.critical > 0 ? 'rose' : 'green'} hint="By severity" />
        <Stat label="Resolved" value={stats.resolved} tone="green" hint="Closed out" />
        <Stat label="Active thresholds" value={stats.activeThresholds} tone="sky" hint={`${thresholds.length} total`} />
      </div>

      {/* Thresholds config */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Thresholds</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Rules evaluated against the latest reconciliation and burn forecast to raise alerts.
            </p>
          </div>
          <Button size="sm" onClick={openCreate} disabled={busy}>
            New threshold
          </Button>
        </CardHeader>
        <CardBody className="p-0">
          {thresholds.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No thresholds configured"
                description="Define rules like cost variance > 50000 to be alerted when the plan drifts from actuals."
                action={
                  <Button size="sm" onClick={openCreate}>
                    New threshold
                  </Button>
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Rule</TH>
                  <TH>State</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {thresholds.map((t) => (
                  <TR key={t.id}>
                    <TD className="font-medium text-slate-200">{t.name}</TD>
                    <TD>
                      <span className="text-slate-300">{metricLabel(t.metric)}</span>{' '}
                      <span className="font-mono text-slate-400">
                        {comparatorSymbol(t.comparator)} {t.value}
                      </span>
                    </TD>
                    <TD>
                      {t.is_active ? <Badge tone="green">Active</Badge> : <Badge tone="slate">Inactive</Badge>}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => toggleActive(t)} disabled={busy}>
                          {t.is_active ? 'Disable' : 'Enable'}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => openEdit(t)} disabled={busy}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => removeThreshold(t)} disabled={busy}>
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

      {/* Alerts queue */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-slate-200">Alert queue</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={alertSearch}
              onChange={(e) => setAlertSearch(e.target.value)}
              placeholder="Search alerts..."
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-500"
            />
            <select
              value={sevFilter}
              onChange={(e) => setSevFilter(e.target.value as typeof sevFilter)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
            >
              <option value="all">All severities</option>
              <option value="critical">Critical</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
            <select
              value={alertFilter}
              onChange={(e) => setAlertFilter(e.target.value as typeof alertFilter)}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="acknowledged">Acknowledged</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filteredAlerts.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={alerts.length === 0 ? 'No alerts yet' : 'No alerts match your filters'}
                description={
                  alerts.length === 0
                    ? 'Run "Evaluate thresholds" to check the latest reconciliation and forecast against your rules.'
                    : 'Adjust the search or filters to see more alerts.'
                }
                action={
                  alerts.length === 0 ? (
                    <Button size="sm" onClick={evaluate} disabled={busy}>
                      Evaluate thresholds
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Severity</TH>
                  <TH>Alert</TH>
                  <TH>Status</TH>
                  <TH>Raised</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filteredAlerts.map((a) => {
                  const status = (a.status ?? 'open').toLowerCase()
                  const isResolved = status === 'resolved'
                  const isAcked = status === 'acknowledged'
                  return (
                    <TR key={a.id}>
                      <TD>
                        <Badge tone={severityTone(a.severity)}>{a.severity ?? 'info'}</Badge>
                      </TD>
                      <TD>
                        <div className="font-medium text-slate-200">{a.title}</div>
                        {a.detail && <div className="mt-0.5 text-xs text-slate-500">{a.detail}</div>}
                      </TD>
                      <TD>
                        <Badge tone={statusTone(a.status)}>{a.status ?? 'open'}</Badge>
                      </TD>
                      <TD className="whitespace-nowrap text-xs text-slate-400">{fmtDate(a.created_at)}</TD>
                      <TD>
                        <div className="flex justify-end gap-1.5">
                          {!isResolved && !isAcked && (
                            <Button size="sm" variant="secondary" onClick={() => ack(a)} disabled={busy}>
                              Acknowledge
                            </Button>
                          )}
                          {!isResolved && (
                            <Button size="sm" onClick={() => resolve(a)} disabled={busy}>
                              Resolve
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => removeAlert(a)} disabled={busy}>
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

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit threshold' : 'New threshold'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setFormOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveThreshold} disabled={busy}>
              {busy ? 'Saving...' : editing ? 'Save changes' : 'Create threshold'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Comp overspend warning"
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Metric</label>
            <select
              value={form.metric}
              onChange={(e) => setForm({ ...form, metric: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
            >
              {METRICS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Comparator
              </label>
              <select
                value={form.comparator}
                onChange={(e) => setForm({ ...form, comparator: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
              >
                {COMPARATORS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">Value</label>
              <input
                type="number"
                step="any"
                value={form.value}
                onChange={(e) => setForm({ ...form, value: e.target.value })}
                placeholder="e.g. 50000"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={form.is_active}
              onChange={(e) => setForm({ ...form, is_active: e.target.checked })}
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-sky-600 focus:ring-sky-500/60"
            />
            Active (evaluated on each run)
          </label>
        </div>
      </Modal>
    </div>
  )
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Alerts &amp; Thresholds</h1>
        <p className="mt-0.5 text-sm text-slate-500">
          Configure variance rules and triage the alerts they generate against plan vs actuals.
        </p>
      </div>
      {right}
    </div>
  )
}
