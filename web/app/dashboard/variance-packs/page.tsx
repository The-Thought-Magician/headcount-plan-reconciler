'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
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

type VariancePack = {
  id: string
  workspace_id: string
  fiscal_year: number | null
  period_label: string | null
  status: string | null
  starting_budget: number | null
  ending_actual: number | null
  total_variance: number | null
  people_signed_by: string | null
  people_signed_at: string | null
  finance_signed_by: string | null
  finance_signed_at: string | null
  created_by: string | null
  created_at: string
}

function money(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

function signedMoney(n: number | null | undefined) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return '—'
  const v = Number(n)
  return `${v >= 0 ? '+' : ''}${money(v)}`
}

function statusTone(s: string | null) {
  switch ((s ?? '').toLowerCase()) {
    case 'signed':
    case 'closed':
    case 'final':
      return 'green' as const
    case 'pending':
    case 'in_review':
    case 'draft':
      return 'amber' as const
    default:
      return 'slate' as const
  }
}

function signStage(pack: VariancePack) {
  const people = !!pack.people_signed_at
  const finance = !!pack.finance_signed_at
  if (people && finance) return { label: 'Dual signed', tone: 'green' as const }
  if (people || finance) return { label: 'Partial', tone: 'amber' as const }
  return { label: 'Unsigned', tone: 'slate' as const }
}

export default function VariancePacksPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [packs, setPacks] = useState<VariancePack[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'unsigned' | 'partial' | 'signed'>('all')

  const [genOpen, setGenOpen] = useState(false)
  const [genYear, setGenYear] = useState<string>(String(new Date().getFullYear()))
  const [genPeriod, setGenPeriod] = useState<string>('FY')

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
      setPacks([])
      return
    }
    const list = await api.listVariancePacks(id)
    setPacks(Array.isArray(list) ? list : [])
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
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load variance packs')
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
      setError(e instanceof Error ? e.message : 'Failed to load variance packs')
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

  const generate = async () => {
    if (!wsId) return
    if (!genPeriod.trim()) {
      setError('Period label is required')
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.generateVariancePack({
        workspace_id: wsId,
        fiscal_year: Number(genYear),
        period_label: genPeriod.trim(),
      })
      setGenOpen(false)
      setNotice(`Generated variance pack for ${genPeriod.trim()} ${genYear}.`)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Generate failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (p: VariancePack) => {
    if (typeof window !== 'undefined' && !window.confirm('Delete this variance pack and its bridge lines?')) return
    setBusy(true)
    setError(null)
    try {
      await api.deleteVariancePack(p.id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    } finally {
      setBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return packs.filter((p) => {
      const stage = signStage(p)
      if (filter === 'unsigned' && stage.label !== 'Unsigned') return false
      if (filter === 'partial' && stage.label !== 'Partial') return false
      if (filter === 'signed' && stage.label !== 'Dual signed') return false
      if (!q) return true
      const hay = [p.period_label, p.fiscal_year, p.status, p.id].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [packs, search, filter])

  const summary = useMemo(() => {
    let signed = 0
    let pending = 0
    let totalVariance = 0
    for (const p of packs) {
      const stage = signStage(p)
      if (stage.label === 'Dual signed') signed++
      else pending++
      totalVariance += Number(p.total_variance ?? 0)
    }
    return { signed, pending, totalVariance, count: packs.length }
  }, [packs])

  if (loading) return <PageSpinner label="Loading variance packs..." />

  if (!wsId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create a workspace and seed sample data from the Imports & Seed page to begin building variance packs."
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
            <Button size="sm" onClick={() => setGenOpen(true)} disabled={busy}>
              Generate pack
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
        <Stat label="Total packs" value={summary.count} tone="sky" hint="Board-ready bridges" />
        <Stat label="Dual signed" value={summary.signed} tone="green" hint="People + Finance" />
        <Stat label="Awaiting sign-off" value={summary.pending} tone="amber" hint="Missing a signature" />
        <Stat
          label="Aggregate variance"
          value={signedMoney(summary.totalVariance)}
          tone={summary.totalVariance > 0 ? 'rose' : 'green'}
          hint="Sum across all packs"
        />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Variance packs</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search period / year..."
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as typeof filter)}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
            >
              <option value="all">All sign-off</option>
              <option value="unsigned">Unsigned</option>
              <option value="partial">Partial</option>
              <option value="signed">Dual signed</option>
            </select>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={packs.length === 0 ? 'No variance packs yet' : 'No packs match your filters'}
                description={
                  packs.length === 0
                    ? 'Generate a budget-to-actual bridge for a fiscal period to route it through People and Finance sign-off.'
                    : 'Adjust the search or filter to see more packs.'
                }
                action={
                  packs.length === 0 ? (
                    <Button size="sm" onClick={() => setGenOpen(true)} disabled={busy}>
                      Generate pack
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
                  <TH>FY</TH>
                  <TH className="text-right">Starting budget</TH>
                  <TH className="text-right">Ending actual</TH>
                  <TH className="text-right">Variance</TH>
                  <TH>Sign-off</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((p) => {
                  const stage = signStage(p)
                  const variance = Number(p.total_variance ?? 0)
                  return (
                    <TR key={p.id}>
                      <TD>
                        <Link
                          href={`/dashboard/variance-packs/${p.id}`}
                          className="font-medium text-teal-300 hover:text-teal-200"
                        >
                          {p.period_label ?? 'Untitled period'}
                        </Link>
                      </TD>
                      <TD className="text-zinc-400">{p.fiscal_year ?? '—'}</TD>
                      <TD className="text-right text-zinc-300">{money(p.starting_budget)}</TD>
                      <TD className="text-right text-zinc-300">{money(p.ending_actual)}</TD>
                      <TD className={`text-right font-medium ${variance > 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {signedMoney(p.total_variance)}
                      </TD>
                      <TD>
                        <Badge tone={stage.tone}>{stage.label}</Badge>
                      </TD>
                      <TD>
                        <Badge tone={statusTone(p.status)}>{p.status ?? 'draft'}</Badge>
                      </TD>
                      <TD>
                        <div className="flex justify-end gap-1.5">
                          <Link href={`/dashboard/variance-packs/${p.id}`}>
                            <Button size="sm" variant="secondary">
                              Open bridge
                            </Button>
                          </Link>
                          <Button size="sm" variant="ghost" onClick={() => remove(p)} disabled={busy}>
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
        open={genOpen}
        onClose={() => setGenOpen(false)}
        title="Generate variance pack"
        footer={
          <>
            <Button variant="ghost" onClick={() => setGenOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={generate} disabled={busy}>
              {busy ? 'Generating...' : 'Generate'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-zinc-400">
            Builds a starting-budget to ending-actual bridge from the workspace plan, hires, and budget baselines for the
            selected period.
          </p>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Fiscal year</label>
            <input
              type="number"
              value={genYear}
              onChange={(e) => setGenYear(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-zinc-500">Period label</label>
            <select
              value={genPeriod}
              onChange={(e) => setGenPeriod(e.target.value)}
              className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200"
            >
              <option value="FY">FY (full year)</option>
              <option value="Q1">Q1</option>
              <option value="Q2">Q2</option>
              <option value="Q3">Q3</option>
              <option value="Q4">Q4</option>
              <option value="H1">H1</option>
              <option value="H2">H2</option>
            </select>
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
        <h1 className="text-xl font-semibold text-zinc-100">Variance Packs</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Board-ready budget-to-actual bridges with dual People and Finance sign-off.
        </p>
      </div>
      {right}
    </div>
  )
}
