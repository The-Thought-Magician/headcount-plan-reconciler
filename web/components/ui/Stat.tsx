import type { ReactNode } from 'react'

interface StatProps {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'default' | 'sky' | 'green' | 'amber' | 'rose' | 'slate'
}

const valueTones: Record<NonNullable<StatProps['tone']>, string> = {
  default: 'text-zinc-100',
  slate: 'text-zinc-300',
  sky: 'text-teal-300',
  green: 'text-emerald-300',
  amber: 'text-amber-300',
  rose: 'text-rose-300',
}

export function Stat({ label, value, hint, tone = 'default' }: StatProps) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-5 py-4">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold ${valueTones[tone]}`}>{value}</div>
      {hint !== undefined && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  )
}

export default Stat
