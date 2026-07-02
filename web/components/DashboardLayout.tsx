'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth/client'

type NavItem = { label: string; href: string }
type NavSection = { title: string; items: NavItem[] }

const NAV: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', href: '/dashboard' },
      { label: 'Reports', href: '/dashboard/reports' },
    ],
  },
  {
    title: 'Plan',
    items: [
      { label: 'Headcount Plans', href: '/dashboard/plan' },
      { label: 'Scenarios', href: '/dashboard/scenarios' },
      { label: 'Budget Baseline', href: '/dashboard/budget' },
    ],
  },
  {
    title: 'Pipeline',
    items: [
      { label: 'Requisitions', href: '/dashboard/requisitions' },
      { label: 'Filled Positions', href: '/dashboard/filled' },
      { label: 'Terminations', href: '/dashboard/terminations' },
    ],
  },
  {
    title: 'Reconcile',
    items: [
      { label: 'Three-Way Reconciliation', href: '/dashboard/reconciliation' },
      { label: 'Ghost Reqs', href: '/dashboard/ghost-reqs' },
      { label: 'Backfill Classifier', href: '/dashboard/backfills' },
      { label: 'Variance Packs', href: '/dashboard/variance-packs' },
    ],
  },
  {
    title: 'Forecast & Velocity',
    items: [
      { label: 'Burn Forecast', href: '/dashboard/burn-forecast' },
      { label: 'Hiring Velocity', href: '/dashboard/velocity' },
    ],
  },
  {
    title: 'Governance',
    items: [
      { label: 'Alerts & Thresholds', href: '/dashboard/alerts' },
      { label: 'Exceptions', href: '/dashboard/exceptions' },
      { label: 'Snapshots', href: '/dashboard/snapshots' },
      { label: 'Activity', href: '/dashboard/activity' },
    ],
  },
  {
    title: 'Setup',
    items: [
      { label: 'Workspaces', href: '/dashboard/workspaces' },
      { label: 'Teams', href: '/dashboard/teams' },
      { label: 'Fiscal Periods', href: '/dashboard/periods' },
      { label: 'Imports & Seed', href: '/dashboard/imports' },
      { label: 'Notifications', href: '/dashboard/notifications' },
      { label: 'Settings', href: '/dashboard/settings' },
    ],
  },
]

function isActive(pathname: string, href: string) {
  if (href === '/dashboard') return pathname === '/dashboard'
  return pathname === href || pathname.startsWith(href + '/')
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [ready, setReady] = useState(false)
  const [user, setUser] = useState<{ name?: string; email?: string } | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const s = await authClient.getSession()
      if (!mounted) return
      const u = (s as any)?.data?.user ?? (s as any)?.user
      if (!u) {
        router.push('/auth/sign-in')
        return
      }
      setUser(u)
      setReady(true)
    })()
    return () => {
      mounted = false
    }
  }, [router])

  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  const signOut = async () => {
    await authClient.signOut()
    router.push('/')
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950">
        <div className="flex items-center gap-3 text-zinc-400">
          <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-teal-500" />
          <span className="text-sm">Loading workspace...</span>
        </div>
      </div>
    )
  }

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="flex items-center gap-2.5 border-b border-zinc-800 px-5 py-5">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-600 text-sm font-bold text-white">
          HR
        </span>
        <span className="text-sm font-semibold tracking-tight text-zinc-100">HeadcountPlanReconciler</span>
      </div>
      <div className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {NAV.map((section) => (
          <div key={section.title}>
            <div className="px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-widest text-zinc-500">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(pathname, item.href)
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`block rounded-md px-2.5 py-1.5 text-sm transition-colors ${
                        active
                          ? 'border-l-2 border-teal-500 bg-teal-500/10 pl-2 font-medium text-teal-300'
                          : 'border-l-2 border-transparent text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100'
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-zinc-950 text-zinc-100">
      {/* Desktop sidebar */}
      <aside className="hidden w-72 shrink-0 border-r border-zinc-800 bg-zinc-900/60 lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-72 border-r border-zinc-800 bg-zinc-900">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-zinc-800 bg-zinc-950/90 px-4 py-3.5 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setDrawerOpen(true)}
              className="rounded-md border border-zinc-700 px-2.5 py-1.5 text-zinc-300 hover:border-teal-600 hover:text-teal-400 lg:hidden"
              aria-label="Open navigation"
            >
              ☰
            </button>
            <span className="text-sm font-medium text-zinc-400">Workspace</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-zinc-200">{user?.name ?? user?.email ?? 'Account'}</div>
              {user?.email && <div className="text-xs text-zinc-500">{user.email}</div>}
            </div>
            <button
              onClick={signOut}
              className="rounded-md border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:border-teal-600 hover:text-teal-400"
            >
              Sign out
            </button>
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
