import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from '../db/index.js'
import {
  imports,
  workspace_members,
  teams,
  plan_lines,
  requisitions,
  filled_positions,
  terminations,
} from '../db/schema.js'
import { eq, and, desc } from 'drizzle-orm'
import { authMiddleware, getUserId } from '../lib/auth.js'

const router = new Hono()

async function isMember(workspaceId: string, userId: string): Promise<boolean> {
  if (!workspaceId || !userId) return false
  const [m] = await db
    .select()
    .from(workspace_members)
    .where(and(eq(workspace_members.workspace_id, workspaceId), eq(workspace_members.user_id, userId)))
  return !!m
}

type ImportError = { row: number; message: string }

const SUPPORTED = ['teams', 'plan_lines', 'requisitions', 'filled_positions', 'terminations'] as const
type EntityType = (typeof SUPPORTED)[number]

function asString(v: unknown): string | null {
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return null
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return null
}

function asDate(v: unknown): Date | null {
  const s = asString(v)
  if (!s) return null
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t)
}

// Validate one row for the given entity type; return error message or null.
function validateRow(entity: EntityType, row: Record<string, unknown>): string | null {
  if (row === null || typeof row !== 'object') return 'Row is not an object'
  switch (entity) {
    case 'teams':
      if (!asString(row.name)) return 'Missing required field "name"'
      return null
    case 'plan_lines':
      if (!asString(row.plan_id)) return 'Missing required field "plan_id"'
      if (!asString(row.level)) return 'Missing required field "level"'
      if (!asString(row.role_title)) return 'Missing required field "role_title"'
      if (asNumber(row.quarter) === null) return 'Missing or invalid "quarter"'
      if (asNumber(row.planned_start_quarter) === null)
        return 'Missing or invalid "planned_start_quarter"'
      return null
    case 'requisitions':
      if (!asString(row.title)) return 'Missing required field "title"'
      if (!asString(row.level)) return 'Missing required field "level"'
      return null
    case 'filled_positions':
      if (!asString(row.person_name)) return 'Missing required field "person_name"'
      if (!asString(row.title)) return 'Missing required field "title"'
      if (!asString(row.level)) return 'Missing required field "level"'
      return null
    case 'terminations':
      if (!asString(row.person_name)) return 'Missing required field "person_name"'
      if (!asString(row.level)) return 'Missing required field "level"'
      if (!asString(row.title)) return 'Missing required field "title"'
      return null
    default:
      return 'Unsupported entity_type'
  }
}

// Build a typed insert value for a validated row.
function buildValue(entity: EntityType, ws: string, row: Record<string, unknown>): Record<string, unknown> {
  switch (entity) {
    case 'teams':
      return {
        workspace_id: ws,
        name: asString(row.name)!,
        parent_id: asString(row.parent_id),
        cost_center: asString(row.cost_center),
        owner_user_id: asString(row.owner_user_id),
      }
    case 'plan_lines':
      return {
        workspace_id: ws,
        plan_id: asString(row.plan_id)!,
        team_id: asString(row.team_id),
        level: asString(row.level)!,
        role_title: asString(row.role_title)!,
        quarter: asNumber(row.quarter)!,
        count: asNumber(row.count) ?? 1,
        budgeted_base: asNumber(row.budgeted_base) ?? 0,
        budgeted_variable: asNumber(row.budgeted_variable) ?? 0,
        burden_rate: asNumber(row.burden_rate) ?? 0.25,
        planned_start_quarter: asNumber(row.planned_start_quarter)!,
        hire_type: asString(row.hire_type) ?? 'growth',
        justification: asString(row.justification) ?? '',
      }
    case 'requisitions':
      return {
        workspace_id: ws,
        team_id: asString(row.team_id),
        plan_line_id: asString(row.plan_line_id),
        title: asString(row.title)!,
        level: asString(row.level)!,
        status: asString(row.status) ?? 'open',
        target_start: asDate(row.target_start),
        fill_by: asDate(row.fill_by),
        recruiter: asString(row.recruiter),
        hiring_manager: asString(row.hiring_manager),
        hire_type: asString(row.hire_type) ?? 'growth',
        budgeted_base: asNumber(row.budgeted_base) ?? 0,
      }
    case 'filled_positions':
      return {
        workspace_id: ws,
        team_id: asString(row.team_id),
        req_id: asString(row.req_id),
        plan_line_id: asString(row.plan_line_id),
        person_name: asString(row.person_name)!,
        title: asString(row.title)!,
        level: asString(row.level)!,
        actual_start: asDate(row.actual_start),
        actual_base: asNumber(row.actual_base) ?? 0,
        actual_variable: asNumber(row.actual_variable) ?? 0,
        burden_rate: asNumber(row.burden_rate) ?? 0.25,
        hire_type: asString(row.hire_type) ?? 'growth',
        backfill_of: asString(row.backfill_of),
      }
    case 'terminations':
      return {
        workspace_id: ws,
        team_id: asString(row.team_id),
        person_name: asString(row.person_name)!,
        level: asString(row.level)!,
        title: asString(row.title)!,
        term_date: asDate(row.term_date),
        reason: asString(row.reason) ?? '',
        base: asNumber(row.base) ?? 0,
      }
  }
}

function tableFor(entity: EntityType) {
  switch (entity) {
    case 'teams':
      return teams
    case 'plan_lines':
      return plan_lines
    case 'requisitions':
      return requisitions
    case 'filled_positions':
      return filled_positions
    case 'terminations':
      return terminations
  }
}

// Public: list import jobs for a workspace. GET /?workspace_id=...
router.get('/', async (c) => {
  const workspaceId = c.req.query('workspace_id')
  if (!workspaceId) return c.json({ error: 'workspace_id is required' }, 400)
  const rows = await db
    .select()
    .from(imports)
    .where(eq(imports.workspace_id, workspaceId))
    .orderBy(desc(imports.created_at))
  return c.json(rows)
})

const payloadSchema = z.object({
  workspace_id: z.string().min(1),
  entity_type: z.enum(SUPPORTED),
  rows: z.array(z.record(z.unknown())),
})

// Auth: validate a payload without committing. Records a dry_run import job.
router.post('/dry-run', authMiddleware, zValidator('json', payloadSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const entity = body.entity_type as EntityType
  const errors: ImportError[] = []
  body.rows.forEach((row, i) => {
    const msg = validateRow(entity, row as Record<string, unknown>)
    if (msg) errors.push({ row: i, message: msg })
  })

  const [job] = await db
    .insert(imports)
    .values({
      workspace_id: body.workspace_id,
      entity_type: body.entity_type,
      status: 'dry_run',
      row_count: body.rows.length,
      error_count: errors.length,
      errors,
      created_by: userId,
    })
    .returning()

  return c.json(job)
})

// Auth: validate then commit a payload, inserting valid rows into the target table.
router.post('/commit', authMiddleware, zValidator('json', payloadSchema), async (c) => {
  const userId = getUserId(c)
  const body = c.req.valid('json')
  if (!(await isMember(body.workspace_id, userId))) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const entity = body.entity_type as EntityType
  const ws = body.workspace_id
  const errors: ImportError[] = []
  const valid: Record<string, unknown>[] = []

  body.rows.forEach((row, i) => {
    const msg = validateRow(entity, row as Record<string, unknown>)
    if (msg) {
      errors.push({ row: i, message: msg })
    } else {
      valid.push(buildValue(entity, ws, row as Record<string, unknown>))
    }
  })

  if (errors.length > 0) {
    const [job] = await db
      .insert(imports)
      .values({
        workspace_id: ws,
        entity_type: body.entity_type,
        status: 'failed',
        row_count: body.rows.length,
        error_count: errors.length,
        errors,
        created_by: userId,
      })
      .returning()
    return c.json({ ...job, inserted: 0, error: 'Validation failed; nothing committed' }, 400)
  }

  const table = tableFor(entity)
  let inserted: any[] = []
  if (valid.length > 0) {
    inserted = (await db
      .insert(table as any)
      .values(valid as any)
      .returning()) as any[]
  }

  const [job] = await db
    .insert(imports)
    .values({
      workspace_id: ws,
      entity_type: body.entity_type,
      status: 'committed',
      row_count: body.rows.length,
      error_count: 0,
      errors: [],
      created_by: userId,
    })
    .returning()

  return c.json({ ...job, inserted }, 201)
})

export default router
