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

type Backfill = {
  id: string
  workspace_id: string
  filled_position_id: string | null
  req_id: string | null
  termination_id: string | null
  classification: string | null
  confidence: number | null
  confirmed: boolean
  created_at: string
}

type NetHeadcount = {
  growth: number
  backfill: number
  terminations: number
  net: number
}

const CLASSIFICATIONS = ['backfill', 'growth', 'unclassified'] as const

function classTone(c: string | null) {
  if (c === 'backfill') return 'sky' as const
  if (c === 'growth') return 'green' as const
  return 'slate' as const
}

function confidencePct(c: number | null) {
  if (c === null || c === undefined) return '—'
  const v = c <= 1 ? c * 100 : c
  return `${Math.round(v)}%`
}

export default function BackfillsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [backfills, setBackfills] = useState<Backfill[]>([])
  const [net, setNet] = useState<NetHeadcount | null>(null)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'backfill' | 'growth' | 'unclassified' | 'confirmed' | 'unconfirmed'>('all')

  const [editing, setEditing] = useState<Backfill | null>(null)
  const [editClass, setEditClass] = useState<string>('unclassified')
  const [editConfidence, setEditConfidence] = useState<string>('')

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
      setBackfills([])
      setNet(null)
      return
    }
    const [bf, nh] = await Promise.all([api.listBackfills(id), api.getNetHeadcount(id)])
    setBackfills(Array.isArray(bf) ? bf : [])
    setNet(nh)
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
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load backfills')
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
      setError(e instanceof Error ? e.message : 'Failed to load backfills')
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

  const runSuggest = async () => {
    if (!wsId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.suggestBackfills({ workspace_id: wsId })
      const count = Array.isArray(res) ? res.length : 0
      setNotice(`Auto-matched ${count} candidate link${count === 1 ? '' : 's'}.`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Suggest failed')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (b: Backfill) => {
    setBusy(true)
    setError(null)
    try {
      await api.confirmBackfill(b.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Confirm failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (b: Backfill) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this backfill link?')) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteBackfill(b.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (b: Backfill) => {
    setEditing(b)
    setEditClass(b.classification ?? 'unclassified')
    setEditConfidence(b.confidence === null || b.confidence === undefined ? '' : String(b.confidence))
  }

  const saveEdit = async () => {
    if (!editing) return
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = { classification: editClass }
      if (editConfidence !== '') payload.confidence = Number(editConfidence)
      await api.updateBackfill(editing.id, payload)
      setEditing(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Update failed')
    } finally {
      setBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return backfills.filter((b) => {
      if (filter === 'confirmed' && !b.confirmed) return false
      if (filter === 'unconfirmed' && b.confirmed) return false
      if ((filter === 'backfill' || filter === 'growth' || filter === 'unclassified') && (b.classification ?? 'unclassified') !== filter)
        return false
      if (!q) return true
      const hay = [b.id, b.classification, b.req_id, b.filled_position_id, b.termination_id].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [backfills, search, filter])

  const counts = useMemo(() => {
    const c = { backfill: 0, growth: 0, unclassified: 0, confirmed: 0 }
    for (const b of backfills) {
      const cls = (b.classification ?? 'unclassified') as keyof typeof c
      if (cls in c) (c[cls] as number)++
      if (b.confirmed) c.confirmed++
    }
    return c
  }, [backfills])

  if (loading) return <PageSpinner label="Loading backfill classifier..." />

  if (!wsId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create a workspace and seed sample data from the Imports & Seed page to begin classifying backfills."
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
            <Button size="sm" onClick={runSuggest} disabled={busy}>
              {busy ? 'Matching...' : 'Auto-match backfills'}
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

      {/* Net headcount summary */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Gross growth hires" value={net?.growth ?? 0} tone="green" hint="New roles above plan baseline" />
        <Stat label="Backfill hires" value={net?.backfill ?? 0} tone="sky" hint="Replacing departures" />
        <Stat label="Terminations" value={net?.terminations ?? 0} tone="rose" hint="Departures in period" />
        <Stat
          label="Net headcount"
          value={(net?.net ?? 0) >= 0 ? `+${net?.net ?? 0}` : net?.net ?? 0}
          tone={(net?.net ?? 0) >= 0 ? 'green' : 'rose'}
          hint="Growth − terminations"
        />
      </div>

      {/* Net composition bar */}
      {net && (net.growth + net.backfill + net.terminations) > 0 && (
        <Card>
          <CardHeader>
            <h2 className="text-sm font-semibold text-zinc-200">Headcount composition</h2>
          </CardHeader>
          <CardBody>
            <CompositionBar growth={net.growth} backfill={net.backfill} terminations={net.terminations} />
          </CardBody>
        </Card>
      )}

      {/* Classification breakdown */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <MiniStat label="Backfill" value={counts.backfill} tone="sky" />
        <MiniStat label="Growth" value={counts.growth} tone="green" />
        <MiniStat label="Unclassified" value={counts.unclassified} tone="slate" />
        <MiniStat label="Confirmed" value={counts.confirmed} tone="green" />
      </div>

      {/* Links table */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Backfill links</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by id / classification..."
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
            >
              <option value="all">All</option>
              <option value="backfill">Backfill</option>
              <option value="growth">Growth</option>
              <option value="unclassified">Unclassified</option>
              <option value="confirmed">Confirmed</option>
              <option value="unconfirmed">Unconfirmed</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={backfills.length === 0 ? 'No backfill links yet' : 'No links match your filters'}
                description={
                  backfills.length === 0
                    ? 'Run auto-match to pair terminations with hires and reqs in the same team and level.'
                    : 'Adjust the search or filter to see more links.'
                }
                action={
                  backfills.length === 0 ? (
                    <Button size="sm" onClick={runSuggest} disabled={busy}>
                      Auto-match backfills
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Classification</TH>
                  <TH>Confidence</TH>
                  <TH>Req</TH>
                  <TH>Filled position</TH>
                  <TH>Termination</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((b) => (
                  <TR key={b.id}>
                    <TD>
                      <Badge tone={classTone(b.classification)}>{b.classification ?? 'unclassified'}</Badge>
                    </TD>
                    <TD>
                      <ConfidenceBar value={b.confidence} />
                    </TD>
                    <TD className="font-mono text-xs text-zinc-400">{b.req_id ? b.req_id.slice(0, 8) : '—'}</TD>
                    <TD className="font-mono text-xs text-zinc-400">
                      {b.filled_position_id ? b.filled_position_id.slice(0, 8) : '—'}
                    </TD>
                    <TD className="font-mono text-xs text-zinc-400">
                      {b.termination_id ? b.termination_id.slice(0, 8) : '—'}
                    </TD>
                    <TD>
                      {b.confirmed ? (
                        <Badge tone="green">Confirmed</Badge>
                      ) : (
                        <Badge tone="amber">Pending</Badge>
                      )}
                    </TD>
                    <TD>
                      <div className="flex justify-end gap-1.5">
                        {!b.confirmed && (
                          <Button size="sm" variant="secondary" onClick={() => confirm(b)} disabled={busy}>
                            Confirm
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => openEdit(b)} disabled={busy}>
                          Reclassify
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(b)} disabled={busy}>
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

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Reclassify backfill link"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={saveEdit} disabled={busy}>
              {busy ? 'Saving...' : 'Save'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Classification
            </label>
            <select
              value={editClass}
              onChange={(e) => setEditClass(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              {CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">
              Confidence (0–1 or 0–100)
            </label>
            <input
              type="number"
              step="0.01"
              value={editConfidence}
              onChange={(e) => setEditConfidence(e.target.value)}
              placeholder="e.g. 0.85"
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
          </div>
        </div>
      </Modal>
    </div>
  )
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Backfill Classifier</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Distinguish replacement hires from net growth and track true net headcount.
        </p>
      </div>
      {right}
    </div>
  )
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: 'sky' | 'green' | 'slate' }) {
  const toneCls =
    tone === 'sky' ? 'text-teal-300' : tone === 'green' ? 'text-emerald-300' : 'text-zinc-300'
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${toneCls}`}>{value}</div>
    </div>
  )
}

function ConfidenceBar({ value }: { value: number | null }) {
  if (value === null || value === undefined) return <span className="text-xs text-zinc-600">—</span>
  const pct = value <= 1 ? value * 100 : value
  const clamped = Math.max(0, Math.min(100, pct))
  const tone = clamped >= 70 ? 'bg-emerald-500' : clamped >= 40 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-zinc-800">
        <div className={`h-full ${tone}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className="text-xs text-zinc-400">{confidencePct(value)}</span>
    </div>
  )
}

function CompositionBar({
  growth,
  backfill,
  terminations,
}: {
  growth: number
  backfill: number
  terminations: number
}) {
  const total = Math.max(1, growth + backfill + terminations)
  const seg = (n: number) => `${(n / total) * 100}%`
  return (
    <div className="space-y-3">
      <div className="flex h-6 w-full overflow-hidden rounded-lg border border-zinc-800">
        <div className="bg-emerald-500/70" style={{ width: seg(growth) }} title={`Growth ${growth}`} />
        <div className="bg-teal-500/70" style={{ width: seg(backfill) }} title={`Backfill ${backfill}`} />
        <div className="bg-rose-500/70" style={{ width: seg(terminations) }} title={`Terminations ${terminations}`} />
      </div>
      <div className="flex flex-wrap gap-4 text-xs text-zinc-400">
        <Legend color="bg-emerald-500/70" label={`Growth (${growth})`} />
        <Legend color="bg-teal-500/70" label={`Backfill (${backfill})`} />
        <Legend color="bg-rose-500/70" label={`Terminations (${terminations})`} />
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-sm ${color}`} />
      {label}
    </span>
  )
}
