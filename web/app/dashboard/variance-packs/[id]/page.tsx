'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

type PackLine = {
  id: string
  variance_pack_id: string
  workspace_id: string
  bucket: string | null
  label: string | null
  amount: number | null
  sort_order: number | null
  created_at: string
}

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
  lines?: PackLine[]
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

function fmtDate(s: string | null) {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function bucketTone(bucket: string | null) {
  const b = (bucket ?? '').toLowerCase()
  if (b.includes('start') || b.includes('budget') || b.includes('baseline')) return 'slate' as const
  if (b.includes('end') || b.includes('actual') || b.includes('final')) return 'sky' as const
  if (b.includes('save') || b.includes('favor') || b.includes('under') || b.includes('reduc')) return 'green' as const
  return 'amber' as const
}

export default function VariancePackDetailPage() {
  const params = useParams<{ id: string }>()
  const id = params?.id as string

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pack, setPack] = useState<VariancePack | null>(null)

  const load = useCallback(async () => {
    const data = await api.getVariancePack(id)
    setPack(data)
  }, [id])

  useEffect(() => {
    if (!id) return
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        await load()
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load variance pack')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [id, load])

  const sign = async (role: 'people' | 'finance') => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.signVariancePack(id, { role })
      setNotice(`${role === 'people' ? 'People' : 'Finance'} sign-off recorded.`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-off failed')
    } finally {
      setBusy(false)
    }
  }

  const lines = useMemo(() => {
    const ls = pack?.lines ?? []
    return [...ls].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
  }, [pack])

  // Build a running-total waterfall from starting budget through each bridge line.
  const waterfall = useMemo(() => {
    const start = Number(pack?.starting_budget ?? 0)
    let running = start
    const steps = lines.map((l) => {
      const amount = Number(l.amount ?? 0)
      const from = running
      running += amount
      return { line: l, amount, from, to: running }
    })
    const end = Number(pack?.ending_actual ?? running)
    const maxAbs = Math.max(
      Math.abs(start),
      Math.abs(end),
      ...steps.map((s) => Math.max(Math.abs(s.from), Math.abs(s.to))),
      1,
    )
    return { start, end, steps, maxAbs }
  }, [lines, pack])

  if (loading) return <PageSpinner label="Loading variance pack..." />

  if (error && !pack) {
    return (
      <div className="space-y-6">
        <BackLink />
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      </div>
    )
  }

  if (!pack) {
    return (
      <div className="space-y-6">
        <BackLink />
        <EmptyState title="Variance pack not found" description="It may have been deleted." />
      </div>
    )
  }

  const peopleSigned = !!pack.people_signed_at
  const financeSigned = !!pack.finance_signed_at
  const variance = Number(pack.total_variance ?? 0)

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">
            {pack.period_label ?? 'Variance pack'} {pack.fiscal_year ?? ''}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">
            Budget-to-actual bridge for the period, with dual sign-off governance.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={() => load()} disabled={busy}>
          Refresh
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-300">{notice}</div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Starting budget" value={money(pack.starting_budget)} hint="Approved baseline" />
        <Stat label="Ending actual" value={money(pack.ending_actual)} tone="sky" hint="Realized comp cost" />
        <Stat
          label="Total variance"
          value={signedMoney(pack.total_variance)}
          tone={variance > 0 ? 'rose' : 'green'}
          hint={variance > 0 ? 'Over budget' : 'Under / on budget'}
        />
        <Stat
          label="Sign-off"
          value={peopleSigned && financeSigned ? 'Complete' : peopleSigned || financeSigned ? 'Partial' : 'Pending'}
          tone={peopleSigned && financeSigned ? 'green' : peopleSigned || financeSigned ? 'amber' : 'default'}
          hint="People + Finance"
        />
      </div>

      {/* Sign-off panel */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Dual sign-off</h2>
        </CardHeader>
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <SignoffCard
              title="People / HR"
              signedBy={pack.people_signed_by}
              signedAt={pack.people_signed_at}
              onSign={() => sign('people')}
              busy={busy}
            />
            <SignoffCard
              title="Finance / FP&A"
              signedBy={pack.finance_signed_by}
              signedAt={pack.finance_signed_at}
              onSign={() => sign('finance')}
              busy={busy}
            />
          </div>
          {peopleSigned && financeSigned && (
            <div className="mt-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
              Both parties have signed. This pack is locked for the board package.
            </div>
          )}
        </CardBody>
      </Card>

      {/* Waterfall */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Bridge waterfall</h2>
        </CardHeader>
        <CardBody>
          {lines.length === 0 ? (
            <EmptyState
              title="No bridge lines"
              description="This pack has no bucketed variance lines. Regenerate it from the variance packs list once plan, hire, and budget data exist."
            />
          ) : (
            <Waterfall
              start={waterfall.start}
              end={waterfall.end}
              steps={waterfall.steps}
              maxAbs={waterfall.maxAbs}
            />
          )}
        </CardBody>
      </Card>

      {/* Bridge table */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-200">Bridge detail</h2>
        </CardHeader>
        <CardBody className="p-0">
          {lines.length === 0 ? (
            <div className="p-5">
              <EmptyState title="No bridge lines" description="Nothing to itemize for this period yet." />
            </div>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-12">#</TH>
                  <TH>Bucket</TH>
                  <TH>Label</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Running total</TH>
                </TR>
              </THead>
              <TBody>
                <TR>
                  <TD className="text-slate-500">—</TD>
                  <TD>
                    <Badge tone="slate">starting</Badge>
                  </TD>
                  <TD className="font-medium text-slate-200">Starting budget</TD>
                  <TD className="text-right text-slate-400">—</TD>
                  <TD className="text-right font-medium text-slate-200">{money(waterfall.start)}</TD>
                </TR>
                {waterfall.steps.map((s, i) => {
                  const amt = s.amount
                  return (
                    <TR key={s.line.id}>
                      <TD className="text-slate-500">{i + 1}</TD>
                      <TD>
                        <Badge tone={bucketTone(s.line.bucket)}>{s.line.bucket ?? 'adjustment'}</Badge>
                      </TD>
                      <TD className="text-slate-300">{s.line.label ?? '—'}</TD>
                      <TD className={`text-right font-medium ${amt >= 0 ? 'text-rose-300' : 'text-emerald-300'}`}>
                        {signedMoney(amt)}
                      </TD>
                      <TD className="text-right text-slate-300">{money(s.to)}</TD>
                    </TR>
                  )
                })}
                <TR>
                  <TD className="text-slate-500">—</TD>
                  <TD>
                    <Badge tone="sky">ending</Badge>
                  </TD>
                  <TD className="font-medium text-slate-200">Ending actual</TD>
                  <TD className="text-right text-slate-400">—</TD>
                  <TD className="text-right font-medium text-sky-300">{money(waterfall.end)}</TD>
                </TR>
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function BackLink() {
  return (
    <Link href="/dashboard/variance-packs" className="inline-flex items-center text-sm text-slate-400 hover:text-slate-200">
      &larr; Back to variance packs
    </Link>
  )
}

function SignoffCard({
  title,
  signedBy,
  signedAt,
  onSign,
  busy,
}: {
  title: string
  signedBy: string | null
  signedAt: string | null
  onSign: () => void
  busy: boolean
}) {
  const signed = !!signedAt
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">{title}</span>
        {signed ? <Badge tone="green">Signed</Badge> : <Badge tone="amber">Pending</Badge>}
      </div>
      {signed ? (
        <div className="mt-3 space-y-0.5 text-xs text-slate-500">
          <div>
            By <span className="font-mono text-slate-300">{signedBy ?? 'unknown'}</span>
          </div>
          <div>{fmtDate(signedAt)}</div>
        </div>
      ) : (
        <div className="mt-3">
          <Button size="sm" onClick={onSign} disabled={busy}>
            {busy ? 'Signing...' : 'Sign off'}
          </Button>
        </div>
      )}
    </div>
  )
}

function Waterfall({
  start,
  end,
  steps,
  maxAbs,
}: {
  start: number
  end: number
  steps: { line: PackLine; amount: number; from: number; to: number }[]
  maxAbs: number
}) {
  const scale = (v: number) => `${(Math.abs(v) / maxAbs) * 100}%`
  const offset = (lo: number) => `${(Math.max(0, lo) / maxAbs) * 100}%`

  const bars: { key: string; label: string; lo: number; hi: number; tone: string }[] = []
  bars.push({ key: 'start', label: 'Start', lo: 0, hi: start, tone: 'bg-slate-500/70' })
  for (const s of steps) {
    const lo = Math.min(s.from, s.to)
    const hi = Math.max(s.from, s.to)
    bars.push({
      key: s.line.id,
      label: s.line.label ?? s.line.bucket ?? 'step',
      lo,
      hi,
      tone: s.amount >= 0 ? 'bg-rose-500/70' : 'bg-emerald-500/70',
    })
  }
  bars.push({ key: 'end', label: 'End', lo: 0, hi: end, tone: 'bg-sky-500/70' })

  return (
    <div className="space-y-2">
      {bars.map((b) => {
        const segLo = Math.min(b.lo, b.hi)
        const segLen = Math.abs(b.hi - b.lo)
        return (
          <div key={b.key} className="flex items-center gap-3">
            <div className="w-40 shrink-0 truncate text-xs text-slate-400" title={b.label}>
              {b.label}
            </div>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-slate-900/60">
              <div
                className={`absolute top-0 h-full ${b.tone}`}
                style={{ left: offset(segLo), width: scale(segLen || maxAbs * 0.002) }}
              />
            </div>
            <div className="w-24 shrink-0 text-right text-xs font-medium text-slate-300">{money(b.hi)}</div>
          </div>
        )
      })}
      <div className="flex flex-wrap gap-4 pt-2 text-xs text-slate-400">
        <Legend color="bg-slate-500/70" label="Anchor" />
        <Legend color="bg-rose-500/70" label="Increases cost" />
        <Legend color="bg-emerald-500/70" label="Reduces cost" />
        <Legend color="bg-sky-500/70" label="Ending actual" />
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
