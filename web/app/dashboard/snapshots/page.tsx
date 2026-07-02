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

type Snapshot = {
  id: string
  workspace_id: string
  period_label: string
  kind: string | null
  payload: Record<string, unknown> | null
  created_by: string | null
  created_at: string
}

type CompareResult = {
  a: Snapshot
  b: Snapshot
  diff: Record<string, unknown> | unknown
}

function kindTone(kind: string | null): 'sky' | 'green' | 'amber' | 'slate' {
  const k = (kind || '').toLowerCase()
  if (k.includes('close') || k.includes('final')) return 'green'
  if (k.includes('draft') || k.includes('interim')) return 'amber'
  if (k.includes('period')) return 'sky'
  return 'slate'
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

function payloadCount(p: Record<string, unknown> | null) {
  if (!p) return 0
  return Object.keys(p).length
}

export default function SnapshotsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [search, setSearch] = useState('')

  // create form
  const [createOpen, setCreateOpen] = useState(false)
  const [formLabel, setFormLabel] = useState('')
  const [formKind, setFormKind] = useState('period-close')

  // detail viewer
  const [detail, setDetail] = useState<Snapshot | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  // compare
  const [compareA, setCompareA] = useState<string>('')
  const [compareB, setCompareB] = useState<string>('')
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null)
  const [comparing, setComparing] = useState(false)

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
      setSnapshots([])
      return
    }
    const rows = await api.listSnapshots(id)
    setSnapshots(Array.isArray(rows) ? rows : [])
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
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load snapshots')
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
    setCompareA('')
    setCompareB('')
    setCompareResult(null)
    try {
      setLoading(true)
      setError(null)
      await loadData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load snapshots')
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

  const createSnapshot = async () => {
    if (!wsId || !formLabel.trim()) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.createSnapshot({ workspace_id: wsId, period_label: formLabel.trim(), kind: formKind })
      setNotice(`Snapshot "${formLabel.trim()}" captured.`)
      setCreateOpen(false)
      setFormLabel('')
      setFormKind('period-close')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create snapshot')
    } finally {
      setBusy(false)
    }
  }

  const openDetail = async (s: Snapshot) => {
    setDetail(s)
    setDetailLoading(true)
    try {
      const full = await api.getSnapshot(s.id)
      if (full) setDetail(full)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load snapshot detail')
    } finally {
      setDetailLoading(false)
    }
  }

  const runCompare = async () => {
    if (!compareA || !compareB || compareA === compareB) return
    setComparing(true)
    setError(null)
    setCompareResult(null)
    try {
      const res = await api.compareSnapshots(compareA, compareB)
      setCompareResult(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Compare failed')
    } finally {
      setComparing(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return snapshots
    return snapshots.filter((s) =>
      [s.period_label, s.kind, s.id, s.created_by].join(' ').toLowerCase().includes(q),
    )
  }, [snapshots, search])

  const labelById = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of snapshots) m.set(s.id, s.period_label)
    return m
  }, [snapshots])

  if (loading) return <PageSpinner label="Loading snapshots..." />

  if (!wsId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create a workspace and seed sample data from the Imports & Seed page before capturing period-close snapshots."
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
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={busy}>
              Capture snapshot
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
        <Stat label="Snapshots" value={snapshots.length} hint="Frozen period captures" />
        <Stat
          label="Distinct periods"
          value={new Set(snapshots.map((s) => s.period_label)).size}
          tone="sky"
          hint="Unique labels"
        />
        <Stat
          label="Latest"
          value={snapshots[0] ? snapshots[0].period_label : '—'}
          tone="green"
          hint={snapshots[0] ? fmtDate(snapshots[0].created_at) : 'No snapshots yet'}
        />
        <Stat
          label="Comparable"
          value={snapshots.length >= 2 ? 'Yes' : 'No'}
          tone={snapshots.length >= 2 ? 'green' : 'amber'}
          hint="Need 2+ to compare"
        />
      </div>

      {/* Compare panel */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-200">Compare snapshots</h2>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Baseline (A)</label>
              <select
                value={compareA}
                onChange={(e) => setCompareA(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="">Select snapshot...</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.period_label} · {fmtDate(s.created_at)}
                  </option>
                ))}
              </select>
            </div>
            <div className="hidden self-center pb-2 text-zinc-600 sm:block">vs</div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Comparison (B)</label>
              <select
                value={compareB}
                onChange={(e) => setCompareB(e.target.value)}
                className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
              >
                <option value="">Select snapshot...</option>
                {snapshots.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.period_label} · {fmtDate(s.created_at)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              onClick={runCompare}
              disabled={comparing || !compareA || !compareB || compareA === compareB}
            >
              {comparing ? 'Comparing...' : 'Compare'}
            </Button>
          </div>

          {compareA && compareB && compareA === compareB && (
            <p className="text-xs text-amber-300">Select two different snapshots to compare.</p>
          )}

          {compareResult && (
            <div className="space-y-3 rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
                <Badge tone="slate">A · {labelById.get(compareA) ?? compareResult.a?.period_label ?? '—'}</Badge>
                <span className="text-zinc-600">→</span>
                <Badge tone="sky">B · {labelById.get(compareB) ?? compareResult.b?.period_label ?? '—'}</Badge>
              </div>
              <DiffView diff={compareResult.diff} />
            </div>
          )}
        </CardBody>
      </Card>

      {/* Snapshot list */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">All snapshots</h2>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by period / kind..."
            className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500"
          />
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={snapshots.length === 0 ? 'No snapshots yet' : 'No snapshots match your search'}
                description={
                  snapshots.length === 0
                    ? 'Capture a snapshot at period close to freeze plan, reqs, hires, and reconciliation state for later comparison.'
                    : 'Adjust your search to see more snapshots.'
                }
                action={
                  snapshots.length === 0 ? (
                    <Button size="sm" onClick={() => setCreateOpen(true)}>
                      Capture snapshot
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Period</TH>
                  <TH>Kind</TH>
                  <TH>Captured fields</TH>
                  <TH>Created by</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((s) => (
                  <TR key={s.id}>
                    <TD className="font-medium text-zinc-200">{s.period_label}</TD>
                    <TD>
                      <Badge tone={kindTone(s.kind)}>{s.kind || 'snapshot'}</Badge>
                    </TD>
                    <TD className="text-zinc-400">{payloadCount(s.payload)} key{payloadCount(s.payload) === 1 ? '' : 's'}</TD>
                    <TD className="font-mono text-xs text-zinc-500">{s.created_by ? s.created_by.slice(0, 12) : '—'}</TD>
                    <TD className="text-zinc-400">{fmtDate(s.created_at)}</TD>
                    <TD>
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" onClick={() => openDetail(s)}>
                          View payload
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setCompareA(s.id)
                            if (compareB === s.id) setCompareB('')
                          }}
                        >
                          Set as A
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setCompareB(s.id)
                            if (compareA === s.id) setCompareA('')
                          }}
                        >
                          Set as B
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

      {/* Create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Capture period-close snapshot"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={createSnapshot} disabled={busy || !formLabel.trim()}>
              {busy ? 'Capturing...' : 'Capture'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            A snapshot freezes the current plan, requisitions, hires, and reconciliation state under a period label so you can
            compare against it later.
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Period label</label>
            <input
              value={formLabel}
              onChange={(e) => setFormLabel(e.target.value)}
              placeholder="e.g. FY26 Q1 Close"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Kind</label>
            <select
              value={formKind}
              onChange={(e) => setFormKind(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="period-close">Period close</option>
              <option value="interim">Interim</option>
              <option value="draft">Draft</option>
              <option value="final">Final</option>
            </select>
          </div>
        </div>
      </Modal>

      {/* Detail modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail ? `Snapshot · ${detail.period_label}` : 'Snapshot'}
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detailLoading ? (
          <div className="py-6">
            <PageSpinner label="Loading payload..." />
          </div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
              <Badge tone={kindTone(detail.kind)}>{detail.kind || 'snapshot'}</Badge>
              <span>Captured {fmtDate(detail.created_at)}</span>
            </div>
            <PayloadSummary payload={detail.payload} />
            <div>
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wide text-zinc-500">Raw payload</div>
              <pre className="max-h-80 overflow-auto rounded-lg border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
                {JSON.stringify(detail.payload ?? {}, null, 2)}
              </pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}

function PayloadSummary({ payload }: { payload: Record<string, unknown> | null }) {
  if (!payload || Object.keys(payload).length === 0) {
    return <p className="text-sm text-zinc-500">This snapshot has no captured payload.</p>
  }
  const entries = Object.entries(payload)
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {entries.map(([k, v]) => {
        const count = Array.isArray(v) ? v.length : typeof v === 'object' && v !== null ? Object.keys(v).length : null
        return (
          <div key={k} className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-3 py-2">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{k.replace(/_/g, ' ')}</div>
            <div className="mt-0.5 text-sm font-semibold text-zinc-200">
              {count !== null ? count : typeof v === 'object' ? '—' : String(v)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DiffView({ diff }: { diff: unknown }) {
  if (diff === null || diff === undefined) {
    return <p className="text-sm text-zinc-500">No differences computed.</p>
  }
  if (typeof diff !== 'object') {
    return <p className="text-sm text-zinc-300">{String(diff)}</p>
  }
  const entries = Object.entries(diff as Record<string, unknown>)
  if (entries.length === 0) {
    return <p className="text-sm text-emerald-300">Snapshots are identical — no changes.</p>
  }
  return (
    <div className="space-y-2">
      {entries.map(([key, val]) => (
        <DiffRow key={key} label={key} value={val} />
      ))}
    </div>
  )
}

function DiffRow({ label, value }: { label: string; value: unknown }) {
  // Handle { from, to } / { a, b } / numeric delta shapes gracefully.
  const obj = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  const from = obj ? obj.from ?? obj.a ?? obj.before : undefined
  const to = obj ? obj.to ?? obj.b ?? obj.after : undefined
  const delta = obj ? obj.delta ?? obj.change ?? obj.diff : undefined

  if (from !== undefined || to !== undefined) {
    const numFrom = Number(from)
    const numTo = Number(to)
    const haveNums = !Number.isNaN(numFrom) && !Number.isNaN(numTo)
    const change = haveNums ? numTo - numFrom : null
    return (
      <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm">
        <span className="text-zinc-400">{label.replace(/_/g, ' ')}</span>
        <span className="flex items-center gap-2">
          <span className="text-zinc-500">{String(from ?? '—')}</span>
          <span className="text-zinc-600">→</span>
          <span className="font-medium text-zinc-200">{String(to ?? '—')}</span>
          {change !== null && change !== 0 && (
            <Badge tone={change > 0 ? 'green' : 'rose'}>
              {change > 0 ? '+' : ''}
              {change}
            </Badge>
          )}
        </span>
      </div>
    )
  }

  const num = Number(delta ?? value)
  if (!Number.isNaN(num) && (delta !== undefined || typeof value === 'number')) {
    return (
      <div className="flex items-center justify-between rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm">
        <span className="text-zinc-400">{label.replace(/_/g, ' ')}</span>
        <Badge tone={num > 0 ? 'green' : num < 0 ? 'rose' : 'slate'}>
          {num > 0 ? '+' : ''}
          {num}
        </Badge>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-sm">
      <div className="text-zinc-400">{label.replace(/_/g, ' ')}</div>
      <pre className="mt-1 overflow-auto text-xs text-zinc-300">{JSON.stringify(value, null, 2)}</pre>
    </div>
  )
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Snapshots</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Freeze period-close state and compare any two points in time.
        </p>
      </div>
      {right}
    </div>
  )
}
