'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'hpr.workspace_id'

type Workspace = { id: string; name: string }

type Team = {
  id: string
  workspace_id: string
  name: string
  parent_id?: string | null
  cost_center?: string | null
  owner_user_id?: string | null
  created_at?: string
}

type TeamForm = {
  name: string
  parent_id: string
  cost_center: string
  owner_user_id: string
}

const emptyForm: TeamForm = { name: '', parent_id: '', cost_center: '', owner_user_id: '' }

type TreeNode = Team & { children: TreeNode[]; depth: number }

function buildTree(teams: Team[]): TreeNode[] {
  const byId = new Map<string, TreeNode>()
  teams.forEach((t) => byId.set(t.id, { ...t, children: [], depth: 0 }))
  const roots: TreeNode[] = []
  byId.forEach((node) => {
    const parent = node.parent_id ? byId.get(node.parent_id) : undefined
    if (parent) {
      node.depth = parent.depth + 1
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  })
  // Fix depths for deeper nesting (parents may have been assigned after children)
  const assignDepth = (node: TreeNode, depth: number) => {
    node.depth = depth
    node.children.forEach((c) => assignDepth(c, depth + 1))
  }
  roots.forEach((r) => assignDepth(r, 0))
  const sortRec = (nodes: TreeNode[]) => {
    nodes.sort((a, b) => a.name.localeCompare(b.name))
    nodes.forEach((n) => sortRec(n.children))
  }
  sortRec(roots)
  return roots
}

function flatten(nodes: TreeNode[]): TreeNode[] {
  const out: TreeNode[] = []
  const walk = (ns: TreeNode[]) => {
    ns.forEach((n) => {
      out.push(n)
      walk(n.children)
    })
  }
  walk(nodes)
  return out
}

// Detect whether assigning `parentId` to `teamId` would create a cycle.
function wouldCycle(teams: Team[], teamId: string, parentId: string): boolean {
  if (!parentId) return false
  if (parentId === teamId) return true
  const byId = new Map(teams.map((t) => [t.id, t]))
  let cur: Team | undefined = byId.get(parentId)
  const seen = new Set<string>()
  while (cur) {
    if (cur.id === teamId) return true
    if (seen.has(cur.id)) break
    seen.add(cur.id)
    cur = cur.parent_id ? byId.get(cur.parent_id) : undefined
  }
  return false
}

export default function TeamsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [teams, setTeams] = useState<Team[]>([])
  const [search, setSearch] = useState('')
  const [view, setView] = useState<'tree' | 'table'>('tree')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Team | null>(null)
  const [form, setForm] = useState<TeamForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [confirmDelete, setConfirmDelete] = useState<Team | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadTeams = useCallback(async (wsId: string) => {
    const t: Team[] = await api.listTeams(wsId)
    setTeams(Array.isArray(t) ? t : [])
  }, [])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        const ws: Workspace[] = await api.listWorkspaces()
        const list = Array.isArray(ws) ? ws : []
        setWorkspaces(list)
        if (list.length) {
          const stored = typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null
          const active = list.find((w) => w.id === stored) ?? list[0]
          setWorkspaceId(active.id)
          await loadTeams(active.id)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load teams')
      } finally {
        setLoading(false)
      }
    })()
  }, [loadTeams])

  const onSelectWorkspace = async (id: string) => {
    setWorkspaceId(id)
    if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, id)
    setLoading(true)
    setError('')
    try {
      await loadTeams(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load teams')
    } finally {
      setLoading(false)
    }
  }

  const tree = useMemo(() => buildTree(teams), [teams])
  const flat = useMemo(() => flatten(tree), [tree])
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return flat
    return flat.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        (t.cost_center ?? '').toLowerCase().includes(q) ||
        (t.owner_user_id ?? '').toLowerCase().includes(q),
    )
  }, [flat, search])

  const openCreate = (parentId?: string) => {
    setEditing(null)
    setForm({ ...emptyForm, parent_id: parentId ?? '' })
    setFormError('')
    setEditorOpen(true)
  }

  const openEdit = (t: Team) => {
    setEditing(t)
    setForm({
      name: t.name ?? '',
      parent_id: t.parent_id ?? '',
      cost_center: t.cost_center ?? '',
      owner_user_id: t.owner_user_id ?? '',
    })
    setFormError('')
    setEditorOpen(true)
  }

  const submitForm = async () => {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    if (editing && wouldCycle(teams, editing.id, form.parent_id)) {
      setFormError('A team cannot be a descendant of itself')
      return
    }
    setSaving(true)
    setFormError('')
    const payload = {
      workspace_id: workspaceId,
      name: form.name.trim(),
      parent_id: form.parent_id || null,
      cost_center: form.cost_center.trim() || null,
      owner_user_id: form.owner_user_id.trim() || null,
    }
    try {
      if (editing) {
        await api.updateTeam(editing.id, payload)
      } else {
        await api.createTeam(payload)
      }
      await loadTeams(workspaceId)
      setEditorOpen(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save team')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await api.deleteTeam(confirmDelete.id)
      await loadTeams(workspaceId)
      setConfirmDelete(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete team')
    } finally {
      setDeleting(false)
    }
  }

  const childCount = (id: string) => teams.filter((t) => t.parent_id === id).length
  const nameOf = (id?: string | null) => teams.find((t) => t.id === id)?.name ?? '—'

  if (loading) return <PageSpinner label="Loading org structure..." />

  if (!workspaces.length) {
    return (
      <div className="space-y-6">
        <PageHeader workspaces={workspaces} workspaceId={workspaceId} onSelect={onSelectWorkspace} onNew={() => openCreate()} disableNew />
        <EmptyState
          title="No workspace"
          description={<>Create a workspace first, then build out your org tree.</>}
          action={
            <Link href="/dashboard/workspaces">
              <Button>Go to workspaces</Button>
            </Link>
          }
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        workspaces={workspaces}
        workspaceId={workspaceId}
        onSelect={onSelectWorkspace}
        onNew={() => openCreate()}
      />

      {error && (
        <div className="rounded-lg border border-rose-700 bg-rose-900/30 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search teams, cost centers, owners..."
          className="w-full max-w-sm rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
        />
        <div className="inline-flex rounded-lg border border-slate-700 bg-slate-800 p-0.5 text-xs">
          <button
            onClick={() => setView('tree')}
            className={`rounded-md px-3 py-1.5 font-medium ${view === 'tree' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Org tree
          </button>
          <button
            onClick={() => setView('table')}
            className={`rounded-md px-3 py-1.5 font-medium ${view === 'table' ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'}`}
          >
            Table
          </button>
        </div>
      </div>

      {teams.length === 0 ? (
        <EmptyState
          title="No teams yet"
          description="Build your org tree of teams, cost centers, and owners. Sub-teams roll up to their parent."
          action={<Button onClick={() => openCreate()}>Add first team</Button>}
        />
      ) : view === 'tree' ? (
        <Card>
          <CardHeader className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">Org tree</h2>
            <Badge tone="slate">{teams.length} teams</Badge>
          </CardHeader>
          <CardBody className="!px-0 !py-2">
            {(search ? filtered : flat).map((node) => (
              <div
                key={node.id}
                className="group flex items-center justify-between border-b border-slate-800/60 px-5 py-2.5 last:border-0 hover:bg-slate-800/30"
                style={{ paddingLeft: `${20 + (search ? 0 : node.depth * 22)}px` }}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {!search && node.depth > 0 && <span className="text-slate-600">└</span>}
                  <span className="truncate font-medium text-slate-100">{node.name}</span>
                  {node.cost_center && <Badge tone="sky">{node.cost_center}</Badge>}
                  {childCount(node.id) > 0 && (
                    <span className="text-xs text-slate-500">{childCount(node.id)} sub-team{childCount(node.id) > 1 ? 's' : ''}</span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {node.owner_user_id && (
                    <span className="hidden font-mono text-xs text-slate-500 sm:inline">{node.owner_user_id}</span>
                  )}
                  <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button size="sm" variant="ghost" onClick={() => openCreate(node.id)}>
                      + Sub
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => openEdit(node)}>
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(node)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="!px-0 !py-0">
            <Table>
              <THead>
                <TR className="hover:bg-transparent">
                  <TH className="pl-5">Team</TH>
                  <TH>Parent</TH>
                  <TH>Cost center</TH>
                  <TH>Owner</TH>
                  <TH className="pr-5 text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filtered.map((t) => (
                  <TR key={t.id}>
                    <TD className="pl-5 font-medium text-slate-100">{t.name}</TD>
                    <TD className="text-slate-400">{nameOf(t.parent_id)}</TD>
                    <TD>{t.cost_center ? <Badge tone="sky">{t.cost_center}</Badge> : <span className="text-slate-600">—</span>}</TD>
                    <TD className="font-mono text-xs text-slate-400">{t.owner_user_id ?? '—'}</TD>
                    <TD className="pr-5 text-right">
                      <div className="inline-flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>
                          Edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(t)}>
                          Delete
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
                {filtered.length === 0 && (
                  <TR className="hover:bg-transparent">
                    <td className="px-3 py-2.5 pl-5 text-slate-500" colSpan={5}>
                      No teams match &quot;{search}&quot;.
                    </td>
                  </TR>
                )}
              </TBody>
            </Table>
          </CardBody>
        </Card>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? `Edit team — ${editing.name}` : 'New team'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create team'}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {formError && (
            <div className="rounded-lg border border-rose-700 bg-rose-900/30 px-3 py-2 text-sm text-rose-300">
              {formError}
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Engineering"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-300">Parent team</label>
            <select
              value={form.parent_id}
              onChange={(e) => setForm({ ...form, parent_id: e.target.value })}
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
            >
              <option value="">— Top level —</option>
              {teams
                .filter((t) => !editing || t.id !== editing.id)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Cost center</label>
              <input
                value={form.cost_center}
                onChange={(e) => setForm({ ...form, cost_center: e.target.value })}
                placeholder="CC-1000"
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Owner user ID</label>
              <input
                value={form.owner_user_id}
                onChange={(e) => setForm({ ...form, owner_user_id: e.target.value })}
                placeholder="user_..."
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete team"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={doDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </>
        }
      >
        <p className="text-sm text-slate-300">
          Delete <span className="font-semibold text-slate-100">{confirmDelete?.name}</span>?
          {confirmDelete && childCount(confirmDelete.id) > 0 && (
            <span className="mt-2 block text-amber-300">
              This team has {childCount(confirmDelete.id)} sub-team{childCount(confirmDelete.id) > 1 ? 's' : ''}. Reassign or
              delete them first if the operation is blocked.
            </span>
          )}
        </p>
      </Modal>
    </div>
  )
}

function PageHeader({
  workspaces,
  workspaceId,
  onSelect,
  onNew,
  disableNew,
}: {
  workspaces: Workspace[]
  workspaceId: string
  onSelect: (id: string) => void
  onNew: () => void
  disableNew?: boolean
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-100">Teams &amp; org structure</h1>
        <p className="mt-1 text-sm text-slate-500">Org tree, cost centers, and team owners.</p>
      </div>
      <div className="flex items-center gap-3">
        {workspaces.length > 0 && (
          <select
            value={workspaceId}
            onChange={(e) => onSelect(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        )}
        <Button onClick={onNew} disabled={disableNew}>
          New team
        </Button>
      </div>
    </div>
  )
}
