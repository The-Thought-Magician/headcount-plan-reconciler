interface SpinnerProps {
  className?: string
  label?: string
}

export function Spinner({ className = '', label }: SpinnerProps) {
  return (
    <div className={`flex items-center gap-3 text-zinc-400 ${className}`}>
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-zinc-700 border-t-teal-500" />
      {label && <span className="text-sm">{label}</span>}
    </div>
  )
}

export function PageSpinner({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <Spinner label={label} />
    </div>
  )
}

export default Spinner
