'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

type Workspace = {
  id: string
  name: string
  owner_id?: string
  fiscal_year_start_month?: number | null
  currency?: string | null
  default_burden_rate?: number | string | null
  planning_granularity?: string | null
  created_at?: string
  updated_at?: string
}

type Plan = { id: string; name: string; price_cents: number }
type Subscription = {
  id?: string
  user_id?: string
  plan_id?: string
  status?: string
  current_period_end?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
}
type BillingPlan = {
  subscription: Subscription | null
  plan: Plan | null
  stripeEnabled: boolean
}

const WS_KEY = 'hpr_ws'
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const GRANULARITIES = ['quarter', 'month', 'half']
const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'INR', 'JPY']

function fmtPrice(cents: number) {
  if (!cents) return 'Free'
  return `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}/mo`
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<{ id: string; name: string }[]>([])
  const [wsId, setWsId] = useState<string>('')

  const [workspace, setWorkspace] = useState<Workspace | null>(null)
  const [billing, setBilling] = useState<BillingPlan | null>(null)

  const [form, setForm] = useState({
    name: '',
    fiscal_year_start_month: 1,
    currency: 'USD',
    default_burden_rate: '',
    planning_granularity: 'quarter',
  })
  const [saving, setSaving] = useState(false)
  const [billingBusy, setBillingBusy] = useState(false)

  const syncForm = useCallback((ws: Workspace | null) => {
    if (!ws) return
    setForm({
      name: ws.name ?? '',
      fiscal_year_start_month: Number(ws.fiscal_year_start_month ?? 1),
      currency: ws.currency ?? 'USD',
      default_burden_rate: ws.default_burden_rate === null || ws.default_burden_rate === undefined ? '' : String(ws.default_burden_rate),
      planning_granularity: ws.planning_granularity ?? 'quarter',
    })
  }, [])

  const loadWorkspaces = useCallback(async () => {
    const ws = (await api.listWorkspaces()) as { id: string; name: string }[]
    setWorkspaces(ws || [])
    if (!ws || ws.length === 0) {
      setWsId('')
      return ''
    }
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem(WS_KEY) : null
    const chosen = stored && ws.some((w) => w.id === stored) ? stored : ws[0].id
    setWsId(chosen)
    return chosen
  }, [])

  const loadData = useCallback(
    async (workspaceId: string) => {
      const [w, b] = await Promise.all([
        workspaceId ? (api.getWorkspace(workspaceId) as Promise<Workspace>) : Promise.resolve(null),
        api.getBillingPlan() as Promise<BillingPlan>,
      ])
      setWorkspace(w)
      syncForm(w)
      setBilling(b || null)
    },
    [syncForm],
  )

  useEffect(() => {
    let alive = true
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const chosen = await loadWorkspaces()
        await loadData(chosen)
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Failed to load settings')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadWorkspaces, loadData])

  const onSelectWorkspace = async (id: string) => {
    setWsId(id)
    if (typeof window !== 'undefined') window.localStorage.setItem(WS_KEY, id)
    setNotice(null)
    setLoading(true)
    try {
      await loadData(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workspace')
    } finally {
      setLoading(false)
    }
  }

  const onSave = async () => {
    if (!wsId) return
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const updated = (await api.updateWorkspace(wsId, {
        name: form.name.trim(),
        fiscal_year_start_month: Number(form.fiscal_year_start_month),
        currency: form.currency || null,
        default_burden_rate: form.default_burden_rate === '' ? null : Number(form.default_burden_rate),
        planning_granularity: form.planning_granularity || null,
      })) as Workspace
      setWorkspace(updated)
      syncForm(updated)
      setWorkspaces((prev) => prev.map((w) => (w.id === wsId ? { ...w, name: updated.name } : w)))
      setNotice('Workspace settings saved.')
      // record an activity entry for the change
      try {
        await api.recordActivity({
          workspace_id: wsId,
          action: 'update',
          entity_type: 'workspace',
          entity_id: wsId,
          detail: { settings: 'updated', name: updated.name },
        })
      } catch {
        // activity logging is best-effort; ignore failures
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const onCheckout = async () => {
    setBillingBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = (await api.startCheckout({ workspace_id: wsId || undefined })) as { url?: string }
      if (res && res.url) {
        window.location.href = res.url
      } else {
        setNotice('Checkout is not configured in this environment.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Billing is not configured (Stripe disabled).')
    } finally {
      setBillingBusy(false)
    }
  }

  const onPortal = async () => {
    setBillingBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = (await api.openBillingPortal({ workspace_id: wsId || undefined })) as { url?: string }
      if (res && res.url) {
        window.location.href = res.url
      } else {
        setNotice('Billing portal is not configured in this environment.')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Billing portal is not available (Stripe disabled).')
    } finally {
      setBillingBusy(false)
    }
  }

  if (loading) return <PageSpinner label="Loading settings..." />

  const dirty =
    !!workspace &&
    (form.name.trim() !== (workspace.name ?? '') ||
      Number(form.fiscal_year_start_month) !== Number(workspace.fiscal_year_start_month ?? 1) ||
      (form.currency || null) !== (workspace.currency ?? 'USD') ||
      (form.default_burden_rate === '' ? null : Number(form.default_burden_rate)) !==
        (workspace.default_burden_rate === null || workspace.default_burden_rate === undefined
          ? null
          : Number(workspace.default_burden_rate)) ||
      (form.planning_granularity || null) !== (workspace.planning_granularity ?? 'quarter'))

  const sub = billing?.subscription
  const planName = billing?.plan?.name ?? (sub?.plan_id ? sub.plan_id : 'Free')
  const isPro = (sub?.plan_id ?? billing?.plan?.id ?? 'free').toLowerCase() !== 'free'

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Settings</h1>
          <p className="mt-0.5 text-sm text-slate-500">Workspace configuration and billing.</p>
        </div>
        {workspaces.length > 1 && (
          <select
            value={wsId}
            onChange={(e) => onSelectWorkspace(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      {/* Workspace settings */}
      <Card>
        <CardHeader>
          <h2 className="text-sm font-semibold text-slate-100">Workspace</h2>
          <p className="mt-0.5 text-xs text-slate-500">Fiscal calendar, currency, and planning defaults used across plans and reconciliation.</p>
        </CardHeader>
        <CardBody>
          {!workspace ? (
            <EmptyState
              title="No workspace selected"
              description="Create a workspace from the Workspaces page to configure fiscal settings."
            />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Workspace name">
                  <input
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Acme FP&A"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                </Field>
                <Field label="Fiscal year start month">
                  <select
                    value={form.fiscal_year_start_month}
                    onChange={(e) => setForm({ ...form, fiscal_year_start_month: Number(e.target.value) })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Currency">
                  <select
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Default burden rate">
                  <input
                    type="number"
                    step="0.01"
                    value={form.default_burden_rate}
                    onChange={(e) => setForm({ ...form, default_burden_rate: e.target.value })}
                    placeholder="e.g. 0.30 for 30%"
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:border-sky-500 focus:outline-none"
                  />
                </Field>
                <Field label="Planning granularity">
                  <select
                    value={form.planning_granularity}
                    onChange={(e) => setForm({ ...form, planning_granularity: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    {GRANULARITIES.map((g) => (
                      <option key={g} value={g}>
                        {g.charAt(0).toUpperCase() + g.slice(1)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-4">
                <div className="text-xs text-slate-500">
                  Workspace ID <span className="font-mono text-slate-400">{workspace.id}</span>
                  {workspace.created_at && (
                    <> · created {new Date(workspace.created_at).toLocaleDateString()}</>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" onClick={() => syncForm(workspace)} disabled={saving || !dirty}>
                    Reset
                  </Button>
                  <Button onClick={onSave} disabled={saving || !dirty || !form.name.trim()}>
                    {saving ? 'Saving...' : 'Save settings'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Billing */}
      <Card>
        <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Billing</h2>
            <p className="mt-0.5 text-xs text-slate-500">Subscription plan and payment management.</p>
          </div>
          {billing && (
            <Badge tone={billing.stripeEnabled ? 'sky' : 'slate'}>
              {billing.stripeEnabled ? 'Stripe enabled' : 'Stripe disabled'}
            </Badge>
          )}
        </CardHeader>
        <CardBody>
          {!billing ? (
            <p className="text-sm text-slate-500">Billing information unavailable.</p>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-4">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 px-5 py-4">
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Current plan</div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <span className="text-2xl font-semibold text-slate-100">{planName}</span>
                    <Badge tone={isPro ? 'green' : 'slate'}>{isPro ? 'Pro' : 'Free'}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {billing.plan ? fmtPrice(billing.plan.price_cents) : '—'}
                    {sub?.status && <> · status {sub.status}</>}
                  </div>
                  {sub?.current_period_end && (
                    <div className="mt-1 text-xs text-slate-500">
                      Renews {new Date(sub.current_period_end).toLocaleDateString()}
                    </div>
                  )}
                </div>
              </div>

              {!billing.stripeEnabled && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                  Stripe billing is not configured in this environment. Checkout and the billing portal are unavailable
                  until Stripe keys are set on the backend.
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {!isPro && (
                  <Button onClick={onCheckout} disabled={billingBusy || !billing.stripeEnabled}>
                    {billingBusy ? 'Redirecting...' : 'Upgrade to Pro'}
                  </Button>
                )}
                <Button variant="secondary" onClick={onPortal} disabled={billingBusy || !billing.stripeEnabled}>
                  {billingBusy ? 'Opening...' : 'Manage billing'}
                </Button>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-400">{label}</span>
      {children}
    </label>
  )
}
