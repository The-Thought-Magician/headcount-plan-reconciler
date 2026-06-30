'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'

const freeFeatures = [
  'Multi-workspace planning environments',
  'Versioned headcount plans with approval workflow',
  'Three-way reconciliation engine (plan / open / filled)',
  'Ghost-req detection and triage',
  'Backfill-vs-growth classifier and net headcount',
  'Personnel-cost burn forecast with start-date phasing',
  'Hiring-velocity and bottleneck attribution',
  'Finance-ready variance packs with dual sign-off',
  'Scenario planning and what-if overrides',
  'Alerts, thresholds, exceptions, and approvals',
  'Period-close snapshots and audit trail',
  'CSV import, connectors, and one-click sample seeder',
]

export default function Pricing() {
  const [stripeEnabled, setStripeEnabled] = useState<boolean | null>(null)

  useEffect(() => {
    let mounted = true
    api
      .getBillingPlan()
      .then((res: any) => {
        if (mounted) setStripeEnabled(Boolean(res?.stripeEnabled))
      })
      .catch(() => {
        if (mounted) setStripeEnabled(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white">
            HR
          </span>
          <span className="text-lg font-bold tracking-tight text-slate-100">HeadcountPlanReconciler</span>
        </Link>
        <div className="flex items-center gap-4">
          <Link href="/auth/sign-in" className="text-sm text-slate-300 hover:text-white">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      <section className="mx-auto max-w-4xl px-6 py-20 text-center">
        <h1 className="text-3xl font-bold text-white sm:text-4xl">Simple pricing</h1>
        <p className="mt-4 text-lg text-slate-400">
          Everything is free for signed-in users. No credit card, no seats, no feature gates.
        </p>
      </section>

      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-2">
          {/* Free plan */}
          <div className="rounded-2xl border border-sky-500/40 bg-slate-900/60 p-8 ring-1 ring-sky-500/20">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Free</h2>
              <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
                Current
              </span>
            </div>
            <div className="mt-4">
              <span className="text-4xl font-bold text-white">$0</span>
              <span className="text-slate-500"> / forever</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">Full platform, every feature, unlimited workspaces.</p>
            <ul className="mt-6 space-y-2.5">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                  <span className="mt-0.5 text-sky-400">✓</span>
                  <span>{f}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/auth/sign-up"
              className="mt-8 block rounded-lg bg-sky-600 py-3 text-center text-sm font-semibold text-white hover:bg-sky-500"
            >
              Start free
            </Link>
          </div>

          {/* Pro plan (optional, 503-aware) */}
          <div className="rounded-2xl border border-slate-800 bg-slate-950/60 p-8">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">Pro</h2>
              <span className="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 text-xs font-medium text-slate-400">
                {stripeEnabled === null ? 'Checking...' : stripeEnabled ? 'Available' : 'Coming soon'}
              </span>
            </div>
            <div className="mt-4">
              <span className="text-4xl font-bold text-white">$99</span>
              <span className="text-slate-500"> / month</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">
              Reserved for future managed connectors, SSO, and dedicated support. Billing is optional and not yet
              required, every capability above stays free.
            </p>
            <ul className="mt-6 space-y-2.5">
              <li className="flex items-start gap-2 text-sm text-slate-400">
                <span className="mt-0.5 text-slate-500">•</span>
                <span>Everything in Free</span>
              </li>
              <li className="flex items-start gap-2 text-sm text-slate-400">
                <span className="mt-0.5 text-slate-500">•</span>
                <span>Managed HRIS / ATS connectors</span>
              </li>
              <li className="flex items-start gap-2 text-sm text-slate-400">
                <span className="mt-0.5 text-slate-500">•</span>
                <span>SSO and priority support</span>
              </li>
            </ul>
            <button
              disabled
              className="mt-8 w-full cursor-not-allowed rounded-lg border border-slate-700 py-3 text-center text-sm font-semibold text-slate-500"
            >
              {stripeEnabled ? 'Contact us' : 'Not yet available'}
            </button>
          </div>
        </div>
        <p className="mt-8 text-center text-sm text-slate-600">
          Manage billing from your workspace settings once signed in.
        </p>
      </section>
    </main>
  )
}
