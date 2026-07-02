'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

const WS_KEY = 'hpr.activeWorkspace'

type Workspace = { id: string; name: string }

type Activity = {
  id: string
  workspace_id: string
  user_id: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const diff = Date.now() - then
  const sec = Math.round(diff / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.round(hr / 24)
  if (day < 30) return `${day}d ago`
  return new Date(iso).toLocaleDateString()
}

function actionTone(action: string): 'sky' | 'green' | 'amber' | 'rose' | 'slate' {
  const a = action.toLowerCase()
  if (a.includes('delete') || a.includes('remove') || a.includes('reset')) return 'rose'
  if (a.includes('create') || a.includes('add') || a.includes('seed') || a.includes('approve')) return 'green'
  if (a.includes('update') || a.includes('edit') || a.includes('revise') || a.includes('sign')) return 'amber'
  if (a.includes('run') || a.includes('scan') || a.includes('compute') || a.includes('generate')) return 'sky'
  return 'slate'
}

function entityGlyph(entity: string | null) {
  const map: Record<string, string> = {
    workspace: '◆',
    team: '⛁',
    plan: '▤',
    plan_line: '≣',
    requisition: '◷',
    filled_position: '✔',
    termination: '⊗',
    budget: '$',
    reconciliation: '⇄',
    ghost_req: '◌',
    backfill: '↺',
    burn_forecast: '∿',
    velocity: '⏱',
    variance_pack: '⊞',
    scenario: '◑',
    threshold: '⚑',
    alert: '!',
    exception: '※',
    snapshot: '◰',
    import: '⇪',
  }
  return (entity && map[entity]) || '•'
}

export default function ActivityPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [items, setItems] = useState<Activity[]>([])

  const [search, setSearch] = useState('')
  const [actionFilter, setActionFilter] = useState<string>('all')
  const [entityFilter, setEntityFilter] = useState<string>('all')

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
      setItems([])
      return
    }
    const rows = await api.listActivity(id)
    setItems(Array.isArray(rows) ? rows : [])
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
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load activity')
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
      setError(e instanceof Error ? e.message : 'Failed to load activity')
    } finally {
      setLoading(false)
    }
  }

  const refresh = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      await loadData(wsId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    } finally {
      setBusy(false)
    }
  }, [wsId, loadData])

  const actionOptions = useMemo(() => {
    const s = new Set<string>()
    for (const a of items) s.add(a.action)
    return Array.from(s).sort()
  }, [items])

  const entityOptions = useMemo(() => {
    const s = new Set<string>()
    for (const a of items) if (a.entity_type) s.add(a.entity_type)
    return Array.from(s).sort()
  }, [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((a) => {
      if (actionFilter !== 'all' && a.action !== actionFilter) return false
      if (entityFilter !== 'all' && a.entity_type !== entityFilter) return false
      if (!q) return true
      const hay = [a.action, a.entity_type, a.entity_id, a.user_id, JSON.stringify(a.detail ?? {})]
        .join(' ')
        .toLowerCase()
      return hay.includes(q)
    })
  }, [items, search, actionFilter, entityFilter])

  const grouped = useMemo(() => {
    const map = new Map<string, Activity[]>()
    for (const a of filtered) {
      const day = new Date(a.created_at)
      const key = Number.isNaN(day.getTime()) ? 'Unknown' : day.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(a)
    }
    return Array.from(map.entries())
  }, [filtered])

  const stats = useMemo(() => {
    const today = new Date().toLocaleDateString()
    let todayCount = 0
    const actors = new Set<string>()
    for (const a of items) {
      if (new Date(a.created_at).toLocaleDateString() === today) todayCount++
      if (a.user_id) actors.add(a.user_id)
    }
    return { total: items.length, today: todayCount, actors: actors.size, kinds: entityOptions.length }
  }, [items, entityOptions])

  if (loading) return <PageSpinner label="Loading activity feed..." />

  if (!wsId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create a workspace and seed sample data from the Imports & Seed page to start logging activity."
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
              {busy ? 'Refreshing...' : 'Refresh'}
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total events" value={stats.total} hint="All recorded activity" />
        <Stat label="Today" value={stats.today} tone="sky" hint="Events in the last calendar day" />
        <Stat label="Active users" value={stats.actors} tone="green" hint="Distinct actors" />
        <Stat label="Entity types" value={stats.kinds} tone="amber" hint="Kinds of objects touched" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Activity timeline</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search activity..."
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
            >
              <option value="all">All actions</option>
              {actionOptions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              value={entityFilter}
              onChange={(e) => setEntityFilter(e.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
            >
              <option value="all">All entities</option>
              {entityOptions.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardBody>
          {filtered.length === 0 ? (
            <EmptyState
              title={items.length === 0 ? 'No activity yet' : 'No events match your filters'}
              description={
                items.length === 0
                  ? 'Actions across the workspace such as plan edits, reconciliation runs, and sign-offs will appear here.'
                  : 'Adjust the search or filters to see more events.'
              }
            />
          ) : (
            <div className="space-y-8">
              {grouped.map(([day, rows]) => (
                <div key={day}>
                  <div className="mb-3 flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{day}</span>
                    <span className="text-xs text-zinc-600">{rows.length} event{rows.length === 1 ? '' : 's'}</span>
                    <div className="h-px flex-1 bg-zinc-800" />
                  </div>
                  <ol className="relative space-y-4 border-l border-zinc-800 pl-6">
                    {rows.map((a) => (
                      <li key={a.id} className="relative">
                        <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-xs text-zinc-400">
                          {entityGlyph(a.entity_type)}
                        </span>
                        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge tone={actionTone(a.action)}>{a.action}</Badge>
                            {a.entity_type && (
                              <span className="text-sm text-zinc-300">
                                {a.entity_type.replace(/_/g, ' ')}
                              </span>
                            )}
                            {a.entity_id && (
                              <span className="font-mono text-xs text-zinc-500">{a.entity_id.slice(0, 8)}</span>
                            )}
                            <span className="ml-auto text-xs text-zinc-500" title={new Date(a.created_at).toLocaleString()}>
                              {relativeTime(a.created_at)}
                            </span>
                          </div>
                          {a.user_id && (
                            <div className="mt-1 text-xs text-zinc-500">
                              by <span className="font-mono">{a.user_id.slice(0, 12)}</span>
                            </div>
                          )}
                          {a.detail && Object.keys(a.detail).length > 0 && (
                            <DetailBlock detail={a.detail} />
                          )}
                        </div>
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function DetailBlock({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail).slice(0, 8)
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-400">
      {entries.map(([k, v]) => (
        <span key={k}>
          <span className="text-zinc-500">{k}:</span>{' '}
          <span className="text-zinc-300">
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </span>
        </span>
      ))}
    </div>
  )
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Activity</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          A chronological audit trail of every change across the workspace.
        </p>
      </div>
      {right}
    </div>
  )
}
