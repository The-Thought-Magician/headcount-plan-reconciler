'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/Badge'
import { Stat } from '@/components/ui/Stat'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageSpinner } from '@/components/ui/Spinner'

type Notification = {
  id: string
  workspace_id: string | null
  user_id: string | null
  type: string | null
  title: string
  body: string | null
  link: string | null
  is_read: boolean
  created_at: string
}

function typeTone(t: string | null) {
  switch (t) {
    case 'alert':
    case 'error':
      return 'rose' as const
    case 'warning':
    case 'exception':
      return 'amber' as const
    case 'success':
    case 'approval':
      return 'green' as const
    case 'info':
    case 'reconciliation':
      return 'sky' as const
    default:
      return 'slate' as const
  }
}

function fmtRelative(s: string) {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day}d ago`
  return d.toLocaleDateString()
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'unread' | 'read'>('all')

  const load = useCallback(async () => {
    const data = await api.listNotifications()
    setNotifications(Array.isArray(data) ? data : [])
  }, [])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        setLoading(true)
        await load()
      } catch (e) {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load notifications')
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [load])

  const refresh = useCallback(async () => {
    try {
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Refresh failed')
    }
  }, [load])

  const markRead = async (n: Notification) => {
    if (n.is_read) return
    // optimistic
    setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)))
    try {
      await api.markNotificationRead(n.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark read')
      await refresh()
    }
  }

  const markAll = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = (await api.markAllNotificationsRead()) as { count?: number } | null
      const count = res && typeof res.count === 'number' ? res.count : undefined
      setNotice(count !== undefined ? `Marked ${count} notification${count === 1 ? '' : 's'} as read.` : 'All notifications marked as read.')
      setNotifications((prev) => prev.map((x) => ({ ...x, is_read: true })))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark all read')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return notifications.filter((n) => {
      if (filter === 'unread' && n.is_read) return false
      if (filter === 'read' && !n.is_read) return false
      if (!q) return true
      const hay = [n.title, n.body, n.type].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [notifications, search, filter])

  const unreadCount = useMemo(() => notifications.filter((n) => !n.is_read).length, [notifications])

  if (loading) return <PageSpinner label="Loading notifications..." />

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-zinc-100">Notifications</h1>
          <p className="mt-0.5 text-sm text-zinc-500">
            Alerts, approvals, and reconciliation events across your workspaces.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={refresh} disabled={busy}>
            Refresh
          </Button>
          <Button size="sm" onClick={markAll} disabled={busy || unreadCount === 0}>
            {busy ? 'Working...' : 'Mark all read'}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}
      {notice && (
        <div className="rounded-lg border border-teal-500/30 bg-teal-500/10 px-4 py-3 text-sm text-teal-300">{notice}</div>
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Stat label="Unread" value={unreadCount} tone={unreadCount > 0 ? 'amber' : 'green'} hint="Need attention" />
        <Stat label="Read" value={notifications.length - unreadCount} tone="default" hint="Reviewed" />
        <Stat label="Total" value={notifications.length} tone="sky" hint="All notifications" />
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-semibold text-zinc-200">Inbox</h2>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search notifications..."
              className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder:text-zinc-500"
            />
            <div className="flex rounded-lg border border-zinc-700 bg-zinc-900 p-0.5">
              {(['all', 'unread', 'read'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    filter === f ? 'bg-teal-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardBody className="p-0">
          {filtered.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={notifications.length === 0 ? 'No notifications' : 'Nothing matches your filters'}
                description={
                  notifications.length === 0
                    ? 'You are all caught up. New alerts, approvals, and reconciliation events will appear here.'
                    : 'Adjust the search or filter to see more notifications.'
                }
              />
            </div>
          ) : (
            <ul className="divide-y divide-zinc-800">
              {filtered.map((n) => (
                <li
                  key={n.id}
                  className={`flex items-start gap-3 px-5 py-4 transition-colors hover:bg-zinc-800/40 ${
                    n.is_read ? '' : 'bg-teal-500/5'
                  }`}
                >
                  <span
                    className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${
                      n.is_read ? 'bg-zinc-700' : 'bg-teal-400'
                    }`}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {n.type && <Badge tone={typeTone(n.type)}>{n.type}</Badge>}
                      <span className={`text-sm font-medium ${n.is_read ? 'text-zinc-300' : 'text-zinc-100'}`}>
                        {n.title}
                      </span>
                      <span className="text-xs text-zinc-500">{fmtRelative(n.created_at)}</span>
                    </div>
                    {n.body && <p className="mt-1 text-sm text-zinc-400">{n.body}</p>}
                    {n.link && (
                      <Link
                        href={n.link}
                        className="mt-1.5 inline-block text-xs font-medium text-teal-400 hover:text-teal-300"
                      >
                        View details →
                      </Link>
                    )}
                  </div>
                  {!n.is_read && (
                    <Button size="sm" variant="ghost" onClick={() => markRead(n)}>
                      Mark read
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
