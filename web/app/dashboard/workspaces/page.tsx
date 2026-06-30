'use client'

import { useCallback, useEffect, useState } from 'react'
import api from '@/lib/api'
import { Card, CardBody, CardHeader } from '@/components/ui/card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { PageSpinner, Spinner } from '@/components/ui/Spinner'
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table'

const WS_KEY = 'hpr.workspace_id'

type Workspace = {
  id: string
  name: string
  owner_id?: string
  fiscal_year_start_month?: number
  currency?: string
  default_burden_rate?: number | string
  planning_granularity?: string
  created_at?: string
}

type Member = {
  id: string
  workspace_id: string
  user_id: string
  role?: string
  created_at?: string
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]
const ROLES = ['owner', 'admin', 'editor', 'viewer']
const GRANULARITIES = ['quarter', 'month', 'year']

type WsForm = {
  name: string
  currency: string
  fiscal_year_start_month: number
  default_burden_rate: string
  planning_granularity: string
}

const emptyForm: WsForm = {
  name: '',
  currency: 'USD',
  fiscal_year_start_month: 1,
  default_burden_rate: '0.30',
  planning_granularity: 'quarter',
}

export default function WorkspacesPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [selectedId, setSelectedId] = useState<string>('')

  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<Workspace | null>(null)
  const [form, setForm] = useState<WsForm>(emptyForm)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const [members, setMembers] = useState<Member[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [memberUserId, setMemberUserId] = useState('')
  const [memberRole, setMemberRole] = useState('editor')
  const [memberBusy, setMemberBusy] = useState(false)
  const [memberError, setMemberError] = useState('')

  const [confirmDelete, setConfirmDelete] = useState<Workspace | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadWorkspaces = useCallback(async (preferId?: string) => {
    const ws: Workspace[] = await api.listWorkspaces()
    const list = Array.isArray(ws) ? ws : []
    setWorkspaces(list)
    if (list.length) {
      const stored = preferId ?? (typeof window !== 'undefined' ? localStorage.getItem(WS_KEY) : null)
      const active = list.find((w) => w.id === stored) ?? list[0]
      setSelectedId(active.id)
    } else {
      setSelectedId('')
    }
    return list
  }, [])

  const loadMembers = useCallback(async (wsId: string) => {
    if (!wsId) {
      setMembers([])
      return
    }
    setMembersLoading(true)
    setMemberError('')
    try {
      const m: Member[] = await api.listMembers(wsId)
      setMembers(Array.isArray(m) ? m : [])
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Failed to load members')
    } finally {
      setMembersLoading(false)
    }
  }, [])

  useEffect(() => {
    ;(async () => {
      setLoading(true)
      try {
        await loadWorkspaces()
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load workspaces')
      } finally {
        setLoading(false)
      }
    })()
  }, [loadWorkspaces])

  useEffect(() => {
    if (selectedId) {
      if (typeof window !== 'undefined') localStorage.setItem(WS_KEY, selectedId)
      loadMembers(selectedId)
    }
  }, [selectedId, loadMembers])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setFormError('')
    setEditorOpen(true)
  }

  const openEdit = (w: Workspace) => {
    setEditing(w)
    setForm({
      name: w.name ?? '',
      currency: w.currency ?? 'USD',
      fiscal_year_start_month: w.fiscal_year_start_month ?? 1,
      default_burden_rate: w.default_burden_rate != null ? String(w.default_burden_rate) : '0.30',
      planning_granularity: w.planning_granularity ?? 'quarter',
    })
    setFormError('')
    setEditorOpen(true)
  }

  const submitForm = async () => {
    if (!form.name.trim()) {
      setFormError('Name is required')
      return
    }
    setSaving(true)
    setFormError('')
    const payload = {
      name: form.name.trim(),
      currency: form.currency.trim() || 'USD',
      fiscal_year_start_month: Number(form.fiscal_year_start_month),
      default_burden_rate: parseFloat(form.default_burden_rate) || 0,
      planning_granularity: form.planning_granularity,
    }
    try {
      if (editing) {
        await api.updateWorkspace(editing.id, payload)
        await loadWorkspaces(editing.id)
      } else {
        const created: Workspace = await api.createWorkspace(payload)
        await loadWorkspaces(created?.id)
      }
      setEditorOpen(false)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Failed to save workspace')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async () => {
    if (!confirmDelete) return
    setDeleting(true)
    try {
      await api.deleteWorkspace(confirmDelete.id)
      const wasSelected = confirmDelete.id === selectedId
      const list = await loadWorkspaces()
      if (wasSelected && typeof window !== 'undefined') {
        localStorage.setItem(WS_KEY, list[0]?.id ?? '')
      }
      setConfirmDelete(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete workspace')
    } finally {
      setDeleting(false)
    }
  }

  const addMember = async () => {
    if (!memberUserId.trim()) {
      setMemberError('User ID is required')
      return
    }
    setMemberBusy(true)
    setMemberError('')
    try {
      await api.addMember({ workspace_id: selectedId, user_id: memberUserId.trim(), role: memberRole })
      setMemberUserId('')
      setMemberRole('editor')
      await loadMembers(selectedId)
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Failed to add member')
    } finally {
      setMemberBusy(false)
    }
  }

  const changeRole = async (m: Member, role: string) => {
    setMemberError('')
    try {
      await api.updateMember(m.id, { role })
      await loadMembers(selectedId)
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Failed to update role')
    }
  }

  const removeMember = async (m: Member) => {
    setMemberError('')
    try {
      await api.removeMember(m.id)
      await loadMembers(selectedId)
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'Failed to remove member')
    }
  }

  if (loading) return <PageSpinner label="Loading workspaces..." />

  const selected = workspaces.find((w) => w.id === selectedId) ?? null

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">Workspaces</h1>
          <p className="mt-1 text-sm text-slate-500">Planning environments, settings, and member access.</p>
        </div>
        <Button onClick={openCreate}>New workspace</Button>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-700 bg-rose-900/30 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {workspaces.length === 0 ? (
        <EmptyState
          title="No workspaces"
          description="Create your first planning workspace to define teams, plans, and reconciliations."
          action={<Button onClick={openCreate}>Create workspace</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <h2 className="text-sm font-semibold text-slate-100">All workspaces</h2>
              </CardHeader>
              <CardBody className="!px-0 !py-0">
                <ul className="divide-y divide-slate-800">
                  {workspaces.map((w) => (
                    <li key={w.id}>
                      <button
                        onClick={() => setSelectedId(w.id)}
                        className={`flex w-full items-center justify-between px-5 py-3 text-left transition-colors ${
                          w.id === selectedId ? 'bg-sky-500/10' : 'hover:bg-slate-800/40'
                        }`}
                      >
                        <div>
                          <div className="font-medium text-slate-100">{w.name}</div>
                          <div className="mt-0.5 text-xs text-slate-500">
                            {w.currency ?? 'USD'} · FY starts {MONTHS[(w.fiscal_year_start_month ?? 1) - 1] ?? '—'} ·{' '}
                            {w.planning_granularity ?? 'quarter'}
                          </div>
                        </div>
                        {w.id === selectedId && <Badge tone="sky">Active</Badge>}
                      </button>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          </div>

          <div className="space-y-6 lg:col-span-3">
            {selected && (
              <>
                <Card>
                  <CardHeader className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-100">Settings — {selected.name}</h2>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => openEdit(selected)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setConfirmDelete(selected)}>
                        Delete
                      </Button>
                    </div>
                  </CardHeader>
                  <CardBody>
                    <dl className="grid grid-cols-2 gap-4 text-sm">
                      <Field label="Currency" value={selected.currency ?? 'USD'} />
                      <Field
                        label="Fiscal year start"
                        value={MONTHS[(selected.fiscal_year_start_month ?? 1) - 1] ?? '—'}
                      />
                      <Field
                        label="Default burden rate"
                        value={`${(Number(selected.default_burden_rate ?? 0) * 100).toFixed(1)}%`}
                      />
                      <Field label="Planning granularity" value={selected.planning_granularity ?? 'quarter'} />
                    </dl>
                  </CardBody>
                </Card>

                <Card>
                  <CardHeader className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-slate-100">Members</h2>
                    <Badge tone="slate">{members.length}</Badge>
                  </CardHeader>
                  <CardBody className="space-y-4">
                    {memberError && (
                      <div className="rounded-lg border border-rose-700 bg-rose-900/30 px-3 py-2 text-xs text-rose-300">
                        {memberError}
                      </div>
                    )}

                    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
                      <div className="flex-1 min-w-[180px]">
                        <label className="mb-1 block text-xs font-medium text-slate-400">User ID</label>
                        <input
                          value={memberUserId}
                          onChange={(e) => setMemberUserId(e.target.value)}
                          placeholder="user_..."
                          className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-400">Role</label>
                        <select
                          value={memberRole}
                          onChange={(e) => setMemberRole(e.target.value)}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                      <Button size="sm" onClick={addMember} disabled={memberBusy}>
                        {memberBusy ? 'Adding...' : 'Add member'}
                      </Button>
                    </div>

                    {membersLoading ? (
                      <Spinner label="Loading members..." />
                    ) : members.length === 0 ? (
                      <p className="text-sm text-slate-500">No members yet. Add a user by their ID to grant access.</p>
                    ) : (
                      <Table>
                        <THead>
                          <TR className="hover:bg-transparent">
                            <TH className="pl-0">User</TH>
                            <TH>Role</TH>
                            <TH className="pr-0 text-right">Actions</TH>
                          </TR>
                        </THead>
                        <TBody>
                          {members.map((m) => (
                            <TR key={m.id}>
                              <TD className="pl-0 font-mono text-xs text-slate-300">{m.user_id}</TD>
                              <TD>
                                <select
                                  value={m.role ?? 'viewer'}
                                  onChange={(e) => changeRole(m, e.target.value)}
                                  disabled={m.user_id === selected.owner_id}
                                  className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-xs text-slate-200 focus:border-sky-500 focus:outline-none disabled:opacity-60"
                                >
                                  {ROLES.map((r) => (
                                    <option key={r} value={r}>
                                      {r}
                                    </option>
                                  ))}
                                </select>
                              </TD>
                              <TD className="pr-0 text-right">
                                {m.user_id === selected.owner_id ? (
                                  <Badge tone="sky">Owner</Badge>
                                ) : (
                                  <Button size="sm" variant="ghost" onClick={() => removeMember(m)}>
                                    Remove
                                  </Button>
                                )}
                              </TD>
                            </TR>
                          ))}
                        </TBody>
                      </Table>
                    )}
                  </CardBody>
                </Card>
              </>
            )}
          </div>
        </div>
      )}

      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? 'Edit workspace' : 'New workspace'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitForm} disabled={saving}>
              {saving ? 'Saving...' : editing ? 'Save changes' : 'Create'}
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
              placeholder="Acme FY26 Plan"
              className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Currency</label>
              <input
                value={form.currency}
                onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })}
                maxLength={3}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">FY start month</label>
              <select
                value={form.fiscal_year_start_month}
                onChange={(e) => setForm({ ...form, fiscal_year_start_month: Number(e.target.value) })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                {MONTHS.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Default burden rate</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.default_burden_rate}
                onChange={(e) => setForm({ ...form, default_burden_rate: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white focus:border-sky-500 focus:outline-none"
              />
              <p className="mt-1 text-xs text-slate-500">e.g. 0.30 = 30% loaded cost</p>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-300">Planning granularity</label>
              <select
                value={form.planning_granularity}
                onChange={(e) => setForm({ ...form, planning_granularity: e.target.value })}
                className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-200 focus:border-sky-500 focus:outline-none"
              >
                {GRANULARITIES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </Modal>

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title="Delete workspace"
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
          Delete <span className="font-semibold text-slate-100">{confirmDelete?.name}</span> and all of its plans, reqs,
          hires, and reconciliations? This cannot be undone.
        </p>
      </Modal>
    </div>
  )
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium text-slate-200">{value}</dd>
    </div>
  )
}
