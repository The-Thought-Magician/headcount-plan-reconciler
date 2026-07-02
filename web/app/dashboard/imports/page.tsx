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

type ImportJob = {
  id: string
  workspace_id: string
  entity_type: string
  status: string
  row_count: number | null
  error_count: number | null
  errors: ImportError[] | null
  created_by: string | null
  created_at: string
}

type ImportError = { row?: number; field?: string; message?: string } | Record<string, unknown>

type DryRunResult = ImportJob & { errors: ImportError[] | null }

type CommitResult = ImportJob & { inserted?: number }

// Entity types importable via CSV, with their expected column headers.
const ENTITY_TYPES: { value: string; label: string; columns: string[]; sample: string }[] = [
  {
    value: 'teams',
    label: 'Teams',
    columns: ['name', 'parent_name', 'cost_center', 'owner_user_id'],
    sample: 'name,parent_name,cost_center,owner_user_id\nEngineering,,CC-100,\nPlatform,Engineering,CC-101,',
  },
  {
    value: 'plan_lines',
    label: 'Plan lines',
    columns: ['team', 'level', 'role_title', 'quarter', 'count', 'budgeted_base', 'budgeted_variable', 'hire_type'],
    sample:
      'team,level,role_title,quarter,count,budgeted_base,budgeted_variable,hire_type\nEngineering,L4,Software Engineer,Q1,3,180000,20000,growth',
  },
  {
    value: 'requisitions',
    label: 'Requisitions',
    columns: ['team', 'title', 'level', 'status', 'target_start', 'recruiter', 'hiring_manager', 'budgeted_base'],
    sample:
      'team,title,level,status,target_start,recruiter,hiring_manager,budgeted_base\nEngineering,Senior Engineer,L5,open,2026-02-01,Jane R,Sam HM,210000',
  },
  {
    value: 'filled_positions',
    label: 'Filled positions',
    columns: ['team', 'person_name', 'title', 'level', 'actual_start', 'actual_base', 'actual_variable', 'hire_type'],
    sample:
      'team,person_name,title,level,actual_start,actual_base,actual_variable,hire_type\nEngineering,Alex Hire,Software Engineer,L4,2026-01-15,178000,18000,growth',
  },
  {
    value: 'terminations',
    label: 'Terminations',
    columns: ['team', 'person_name', 'level', 'title', 'term_date', 'reason', 'base'],
    sample:
      'team,person_name,level,title,term_date,reason,base\nEngineering,Pat Leaver,L4,Software Engineer,2026-03-01,voluntary,176000',
  },
]

function statusTone(status: string): 'sky' | 'green' | 'amber' | 'rose' | 'slate' {
  const s = status.toLowerCase()
  if (s.includes('commit') || s.includes('success') || s.includes('done') || s.includes('complete')) return 'green'
  if (s.includes('error') || s.includes('fail') || s.includes('invalid')) return 'rose'
  if (s.includes('dry') || s.includes('valid') || s.includes('pending')) return 'amber'
  return 'slate'
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString()
}

// Minimal CSV parser: splits on newlines and commas, trims, supports a header row.
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length === 0) return { headers: [], rows: [] }
  const splitLine = (line: string) => line.split(',').map((c) => c.trim())
  const headers = splitLine(lines[0])
  const rows = lines.slice(1).map((line) => {
    const cells = splitLine(line)
    const row: Record<string, string> = {}
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? ''
    })
    return row
  })
  return { headers, rows }
}

export default function ImportsPage() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [wsId, setWsId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [imports, setImports] = useState<ImportJob[]>([])

  // import builder
  const [entityType, setEntityType] = useState(ENTITY_TYPES[0].value)
  const [csvText, setCsvText] = useState('')
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null)

  // detail viewer
  const [detail, setDetail] = useState<ImportJob | null>(null)

  // reset confirm
  const [resetOpen, setResetOpen] = useState(false)

  const activeEntity = useMemo(
    () => ENTITY_TYPES.find((e) => e.value === entityType) ?? ENTITY_TYPES[0],
    [entityType],
  )

  const parsed = useMemo(() => parseCsv(csvText), [csvText])

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
      setImports([])
      return
    }
    const rows = await api.listImports(id)
    setImports(Array.isArray(rows) ? rows : [])
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
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load imports')
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
    setDryRun(null)
    try {
      setLoading(true)
      setError(null)
      await loadData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load imports')
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

  const loadSample = () => {
    setCsvText(activeEntity.sample)
    setDryRun(null)
    setNotice(null)
    setError(null)
  }

  const runDryRun = async () => {
    if (!wsId || parsed.rows.length === 0) return
    setBusy(true)
    setError(null)
    setNotice(null)
    setDryRun(null)
    try {
      const res = await api.dryRunImport({
        workspace_id: wsId,
        entity_type: entityType,
        rows: parsed.rows,
      })
      setDryRun(res)
      const errs = res?.error_count ?? (res?.errors?.length ?? 0)
      if (errs > 0) {
        setNotice(`Dry-run found ${errs} issue${errs === 1 ? '' : 's'} across ${res?.row_count ?? parsed.rows.length} rows.`)
      } else {
        setNotice(`Dry-run validated ${res?.row_count ?? parsed.rows.length} rows with no errors. Ready to commit.`)
      }
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dry-run failed')
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!wsId || parsed.rows.length === 0) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res: CommitResult = await api.commitImport({
        workspace_id: wsId,
        entity_type: entityType,
        rows: parsed.rows,
      })
      const inserted = res?.inserted ?? res?.row_count ?? parsed.rows.length
      setNotice(`Committed import — ${inserted} ${activeEntity.label.toLowerCase()} inserted.`)
      setDryRun(null)
      setCsvText('')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Commit failed')
    } finally {
      setBusy(false)
    }
  }

  const seed = async () => {
    if (!wsId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await api.seedSample({ workspace_id: wsId })
      const counts = res?.counts ? Object.entries(res.counts).map(([k, v]) => `${v} ${k}`).join(', ') : ''
      setNotice(counts ? `Seeded sample company: ${counts}.` : 'Seeded sample company data.')
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Seeding failed')
    } finally {
      setBusy(false)
    }
  }

  const reset = async () => {
    if (!wsId) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.resetWorkspace({ workspace_id: wsId })
      setNotice('Workspace data cleared.')
      setResetOpen(false)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Reset failed')
    } finally {
      setBusy(false)
    }
  }

  const stats = useMemo(() => {
    const total = imports.length
    const committed = imports.filter((i) => statusTone(i.status) === 'green').length
    const rows = imports.reduce((acc, i) => acc + (i.row_count ?? 0), 0)
    const errors = imports.reduce((acc, i) => acc + (i.error_count ?? 0), 0)
    return { total, committed, rows, errors }
  }, [imports])

  if (loading) return <PageSpinner label="Loading imports..." />

  if (!wsId) {
    return (
      <div className="space-y-6">
        <Header />
        <EmptyState
          title="No workspace found"
          description="Create a workspace first, then seed sample data or import CSVs here."
        />
      </div>
    )
  }

  const dryRunErrors = dryRun?.errors ?? []
  const dryRunErrorCount = dryRun?.error_count ?? dryRunErrors.length
  const dryRunClean = dryRun !== null && dryRunErrorCount === 0

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
        <Stat label="Import jobs" value={stats.total} hint="Dry-runs + commits" />
        <Stat label="Committed" value={stats.committed} tone="green" hint="Successful commits" />
        <Stat label="Rows processed" value={stats.rows} tone="sky" hint="Across all jobs" />
        <Stat label="Validation errors" value={stats.errors} tone={stats.errors > 0 ? 'rose' : 'default'} hint="Flagged rows" />
      </div>

      {/* Sample seeder / reset */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-200">Quick start</h2>
        </CardHeader>
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm text-zinc-300">Populate a realistic sample company or clear this workspace to start over.</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              Seeding creates teams, fiscal periods, a plan with lines, requisitions, hires, terminations, and budget baselines.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button onClick={seed} disabled={busy}>
              {busy ? 'Working...' : 'Seed sample company'}
            </Button>
            <Button variant="danger" onClick={() => setResetOpen(true)} disabled={busy}>
              Reset workspace
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* CSV import builder */}
      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">CSV import</h2>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={entityType}
              onChange={(e) => {
                setEntityType(e.target.value)
                setDryRun(null)
              }}
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200"
            >
              {ENTITY_TYPES.map((e) => (
                <option key={e.value} value={e.value}>
                  {e.label}
                </option>
              ))}
            </select>
            <Button variant="ghost" size="sm" onClick={loadSample}>
              Load sample CSV
            </Button>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="flex flex-wrap gap-1.5">
            <span className="text-xs text-zinc-500">Expected columns:</span>
            {activeEntity.columns.map((c) => (
              <Badge key={c} tone="slate">
                {c}
              </Badge>
            ))}
          </div>

          <textarea
            value={csvText}
            onChange={(e) => {
              setCsvText(e.target.value)
              setDryRun(null)
            }}
            rows={8}
            placeholder={`Paste CSV with a header row, e.g.\n${activeEntity.columns.join(',')}`}
            className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-200 placeholder:text-zinc-600"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-zinc-500">
              {parsed.rows.length > 0 ? (
                <span>
                  {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} parsed · columns:{' '}
                  <span className="text-zinc-400">{parsed.headers.join(', ')}</span>
                </span>
              ) : (
                <span>Paste CSV above or load a sample to begin.</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={runDryRun} disabled={busy || parsed.rows.length === 0}>
                {busy ? 'Validating...' : 'Dry-run'}
              </Button>
              <Button onClick={commit} disabled={busy || parsed.rows.length === 0 || (dryRun !== null && !dryRunClean)}>
                {busy ? 'Committing...' : 'Commit import'}
              </Button>
            </div>
          </div>

          {/* Parsed preview */}
          {parsed.rows.length > 0 && (
            <div className="rounded-lg border border-zinc-800">
              <div className="border-b border-zinc-800 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
                Preview (first {Math.min(5, parsed.rows.length)} rows)
              </div>
              <Table>
                <THead>
                  <TR>
                    {parsed.headers.map((h) => (
                      <TH key={h}>{h}</TH>
                    ))}
                  </TR>
                </THead>
                <TBody>
                  {parsed.rows.slice(0, 5).map((row, i) => (
                    <TR key={i}>
                      {parsed.headers.map((h) => (
                        <TD key={h} className="text-zinc-400">
                          {row[h] || <span className="text-zinc-600">—</span>}
                        </TD>
                      ))}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </div>
          )}

          {/* Dry-run result */}
          {dryRun && (
            <div
              className={`rounded-lg border px-4 py-3 ${
                dryRunClean ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-amber-500/30 bg-amber-500/10'
              }`}
            >
              <div className="flex items-center gap-2 text-sm">
                <Badge tone={dryRunClean ? 'green' : 'amber'}>{dryRun.status || (dryRunClean ? 'valid' : 'has errors')}</Badge>
                <span className={dryRunClean ? 'text-emerald-300' : 'text-amber-300'}>
                  {dryRun.row_count ?? parsed.rows.length} rows · {dryRunErrorCount} error
                  {dryRunErrorCount === 1 ? '' : 's'}
                </span>
              </div>
              {dryRunErrors.length > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-amber-200">
                  {dryRunErrors.slice(0, 20).map((err, i) => (
                    <li key={i}>{formatError(err)}</li>
                  ))}
                  {dryRunErrors.length > 20 && (
                    <li className="text-amber-300/70">+ {dryRunErrors.length - 20} more...</li>
                  )}
                </ul>
              )}
              {dryRunClean && <p className="mt-1 text-xs text-emerald-300/80">No issues found. You can commit this import.</p>}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Import history */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-zinc-200">Import history</h2>
        </CardHeader>
        <CardBody className="p-0">
          {imports.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="No imports yet"
                description="Run a dry-run or commit an import above, or seed sample data, to populate this workspace."
              />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH>Entity</TH>
                  <TH>Status</TH>
                  <TH>Rows</TH>
                  <TH>Errors</TH>
                  <TH>Created</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {imports.map((job) => (
                  <TR key={job.id}>
                    <TD className="font-medium text-zinc-200">{job.entity_type.replace(/_/g, ' ')}</TD>
                    <TD>
                      <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                    </TD>
                    <TD className="text-zinc-400">{job.row_count ?? 0}</TD>
                    <TD>
                      {job.error_count && job.error_count > 0 ? (
                        <span className="text-rose-300">{job.error_count}</span>
                      ) : (
                        <span className="text-zinc-500">0</span>
                      )}
                    </TD>
                    <TD className="text-zinc-400">{fmtDate(job.created_at)}</TD>
                    <TD>
                      <div className="flex justify-end">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDetail(job)}
                          disabled={!job.errors || job.errors.length === 0}
                        >
                          {job.errors && job.errors.length > 0 ? 'View errors' : '—'}
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

      {/* Error detail modal */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        size="lg"
        title={detail ? `Import errors · ${detail.entity_type.replace(/_/g, ' ')}` : 'Import errors'}
        footer={
          <Button variant="ghost" onClick={() => setDetail(null)}>
            Close
          </Button>
        }
      >
        {detail && detail.errors && detail.errors.length > 0 ? (
          <ul className="space-y-1.5 text-sm text-zinc-300">
            {detail.errors.map((err, i) => (
              <li key={i} className="rounded-md border border-zinc-800 bg-zinc-950/40 px-3 py-2 text-xs">
                {formatError(err)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No errors recorded for this job.</p>
        )}
      </Modal>

      {/* Reset confirm modal */}
      <Modal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        title="Reset workspace data"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={reset} disabled={busy}>
              {busy ? 'Clearing...' : 'Clear all data'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-zinc-300">
          This permanently clears all teams, plans, requisitions, hires, terminations, budgets, reconciliations, and related
          records in this workspace. This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

function formatError(err: ImportError): string {
  if (typeof err === 'string') return err
  const o = err as { row?: number; field?: string; message?: string }
  const parts: string[] = []
  if (o.row !== undefined) parts.push(`Row ${o.row}`)
  if (o.field) parts.push(`[${o.field}]`)
  if (o.message) parts.push(o.message)
  if (parts.length > 0) return parts.join(' ')
  return JSON.stringify(err)
}

function Header({ right }: { right?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 className="text-xl font-semibold text-zinc-100">Imports &amp; Seed</h1>
        <p className="mt-0.5 text-sm text-zinc-500">
          Validate and commit CSV data, seed a sample company, or reset the workspace.
        </p>
      </div>
      {right}
    </div>
  )
}
