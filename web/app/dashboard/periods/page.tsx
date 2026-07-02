'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
type Period = {
  id: string
  workspace_id: string
  fiscal_year: number
  quarter: number
  label: string
  start_date: string | null
  end_date: string | null
  created_at: string
}

const WS_KEY = 'hpr.activeWorkspace'
const QUARTERS = [1, 2, 3, 4]

function fmtDate(d: string | null) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function PeriodsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [periods, setPeriods] = useState<Period[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // generate quarters
  const [genYear, setGenYear] = useState<number>(new Date().getFullYear())
  const [generating, setGenerating] = useState(false)

  // manual create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    fiscal_year: new Date().getFullYear(),
    quarter: 1,
    label: '',
    start_date: '',
    end_date: '',
  })

  const [busyId, setBusyId] = useState<string | null>(null)
  const [yearFilter, setYearFilter] = useState<string>('all')

  // Bootstrap workspaces
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

  const loadPeriods = useCallback(
    async (wsId: string, isRefresh = false) => {
      if (!wsId) return
      isRefresh ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const rows: Period[] = await api.listPeriods(wsId)
        setPeriods(rows || [])
      } catch (e: any) {
        setError(e?.message || 'Failed to load fiscal periods')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [],
  )

  useEffect(() => {
    if (!workspaceId) return
    if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, workspaceId)
    loadPeriods(workspaceId)
  }, [workspaceId, loadPeriods])

  const years = useMemo(() => {
    const s = new Set<number>()
    periods.forEach((p) => s.add(p.fiscal_year))
    return Array.from(s).sort((a, b) => b - a)
  }, [periods])

  const filtered = useMemo(() => {
    const rows = yearFilter === 'all' ? periods : periods.filter((p) => String(p.fiscal_year) === yearFilter)
    return [...rows].sort((a, b) => b.fiscal_year - a.fiscal_year || a.quarter - b.quarter)
  }, [periods, yearFilter])

  // group by fiscal year for the grid
  const byYear = useMemo(() => {
    const map = new Map<number, Map<number, Period>>()
    for (const p of periods) {
      if (!map.has(p.fiscal_year)) map.set(p.fiscal_year, new Map())
      map.get(p.fiscal_year)!.set(p.quarter, p)
    }
    return Array.from(map.entries()).sort((a, b) => b[0] - a[0])
  }, [periods])

  const handleGenerate = async () => {
    if (!workspaceId || !genYear) return
    setGenerating(true)
    setError(null)
    try {
      await api.generatePeriods({ workspace_id: workspaceId, fiscal_year: Number(genYear) })
      await loadPeriods(workspaceId, true)
    } catch (e: any) {
      setError(e?.message || 'Failed to generate quarters')
    } finally {
      setGenerating(false)
    }
  }

  const handleCreate = async () => {
    if (!workspaceId) return
    setSaving(true)
    setError(null)
    try {
      await api.createPeriod({
        workspace_id: workspaceId,
        fiscal_year: Number(form.fiscal_year),
        quarter: Number(form.quarter),
        label: form.label.trim() || `FY${form.fiscal_year} Q${form.quarter}`,
        start_date: form.start_date || null,
        end_date: form.end_date || null,
      })
      setCreateOpen(false)
      setForm({ fiscal_year: new Date().getFullYear(), quarter: 1, label: '', start_date: '', end_date: '' })
      await loadPeriods(workspaceId, true)
    } catch (e: any) {
      setError(e?.message || 'Failed to create period')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this fiscal period?')) return
    setBusyId(id)
    try {
      await api.deletePeriod(id)
      setPeriods((prev) => prev.filter((p) => p.id !== id))
    } catch (e: any) {
      setError(e?.message || 'Failed to delete period')
    } finally {
      setBusyId(null)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500'
  const labelCls = 'mb-1 block text-xs font-medium text-zinc-400'

  if (loading && !periods.length && !error) return <PageSpinner label="Loading fiscal periods..." />

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Fiscal Periods</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Define the quarters your plan, budget, and reconciliation runs roll up against.
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
          <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)} disabled={!workspaceId}>
            + Add period
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
          description="Create a workspace under Setup → Workspaces before defining fiscal periods."
        />
      ) : (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Total periods" value={periods.length} tone="sky" />
            <Stat label="Fiscal years" value={years.length} />
            <Stat label="Latest FY" value={years.length ? years[0] : '—'} tone="green" />
            <Stat
              label="Complete years"
              value={byYear.filter(([, q]) => q.size === 4).length}
              hint="all 4 quarters defined"
            />
          </div>

          {/* Generate quarters */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-zinc-200">Generate quarters</h2>
                {refreshing && <Spinner />}
              </div>
            </CardHeader>
            <CardBody>
              <p className="mb-3 text-sm text-zinc-500">
                Auto-create the four quarters (Q1–Q4) for a fiscal year. Existing quarters are preserved.
              </p>
              <div className="flex flex-wrap items-end gap-3">
                <div>
                  <label className={labelCls}>Fiscal year</label>
                  <input
                    type="number"
                    value={genYear}
                    onChange={(e) => setGenYear(Number(e.target.value))}
                    className={`${inputCls} w-32`}
                  />
                </div>
                <Button onClick={handleGenerate} disabled={generating || !genYear}>
                  {generating ? 'Generating...' : `Generate FY${genYear}`}
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Year-by-year quarter grid */}
          {byYear.length === 0 ? (
            <EmptyState
              title="No fiscal periods yet"
              description="Generate a fiscal year above, or add a single period manually."
              action={
                <Button onClick={handleGenerate} disabled={generating}>
                  {generating ? 'Generating...' : `Generate FY${genYear}`}
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {byYear.map(([fy, qmap]) => (
                <Card key={fy}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold text-zinc-100">FY{fy}</h3>
                        <Badge tone={qmap.size === 4 ? 'green' : 'amber'}>
                          {qmap.size}/4 quarters
                        </Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardBody>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {QUARTERS.map((q) => {
                        const p = qmap.get(q)
                        if (!p) {
                          return (
                            <div
                              key={q}
                              className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 px-3 py-5 text-center"
                            >
                              <div className="text-sm font-medium text-zinc-600">Q{q}</div>
                              <div className="mt-1 text-xs text-zinc-700">not defined</div>
                            </div>
                          )
                        }
                        return (
                          <div
                            key={q}
                            className="group relative rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-3"
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-semibold text-teal-300">Q{p.quarter}</span>
                              <button
                                onClick={() => handleDelete(p.id)}
                                disabled={busyId === p.id}
                                className="text-xs text-zinc-600 opacity-0 transition hover:text-rose-400 group-hover:opacity-100 disabled:opacity-40"
                                aria-label="Delete period"
                              >
                                {busyId === p.id ? '…' : '✕'}
                              </button>
                            </div>
                            <div className="mt-1 truncate text-xs font-medium text-zinc-300" title={p.label}>
                              {p.label}
                            </div>
                            <div className="mt-2 text-[11px] text-zinc-500">
                              {fmtDate(p.start_date)} → {fmtDate(p.end_date)}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}

          {/* Flat table */}
          {periods.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-zinc-200">All periods</h2>
                  <select
                    value={yearFilter}
                    onChange={(e) => setYearFilter(e.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1.5 text-xs text-zinc-200 focus:border-teal-500 focus:outline-none"
                  >
                    <option value="all">All years</option>
                    {years.map((y) => (
                      <option key={y} value={String(y)}>
                        FY{y}
                      </option>
                    ))}
                  </select>
                </div>
              </CardHeader>
              <CardBody className="px-0 py-0">
                <Table>
                  <THead>
                    <TR>
                      <TH className="pl-5">Label</TH>
                      <TH>Fiscal year</TH>
                      <TH>Quarter</TH>
                      <TH>Start</TH>
                      <TH>End</TH>
                      <TH className="pr-5 text-right">Actions</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {filtered.map((p) => (
                      <TR key={p.id}>
                        <TD className="pl-5 font-medium text-zinc-100">{p.label}</TD>
                        <TD>FY{p.fiscal_year}</TD>
                        <TD>
                          <Badge tone="slate">Q{p.quarter}</Badge>
                        </TD>
                        <TD>{fmtDate(p.start_date)}</TD>
                        <TD>{fmtDate(p.end_date)}</TD>
                        <TD className="pr-5 text-right">
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => handleDelete(p.id)}
                            disabled={busyId === p.id}
                          >
                            {busyId === p.id ? '...' : 'Delete'}
                          </Button>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              </CardBody>
            </Card>
          )}
        </>
      )}

      {/* Manual create modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Add fiscal period"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? 'Saving...' : 'Create period'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Fiscal year</label>
              <input
                type="number"
                value={form.fiscal_year}
                onChange={(e) => setForm({ ...form, fiscal_year: Number(e.target.value) })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Quarter</label>
              <select
                value={form.quarter}
                onChange={(e) => setForm({ ...form, quarter: Number(e.target.value) })}
                className={inputCls}
              >
                {QUARTERS.map((q) => (
                  <option key={q} value={q}>
                    Q{q}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>Label</label>
            <input
              value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })}
              placeholder={`FY${form.fiscal_year} Q${form.quarter}`}
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Start date</label>
              <input
                type="date"
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>End date</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className={inputCls}
              />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
