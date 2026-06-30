import Link from 'next/link'

const features = [
  {
    title: 'Three-Way Reconciliation',
    body: 'For every team / level / quarter, match planned vs open-req vs filled headcount. Over-hire, under-hire, and at-risk flags with full cost variance and drill-down.',
  },
  {
    title: 'Ghost-Req Detector',
    body: 'Surface reqs with no approved plan line, reqs blown past their fill-by date, and abandoned opens. Severity-scored triage queue with resolve workflow.',
  },
  {
    title: 'Backfill vs Growth Classifier',
    body: 'Auto-match terminations to opens in the same team and level. Get true net headcount expansion: growth hires minus departures, backfills excluded.',
  },
  {
    title: 'Personnel-Cost Burn Forecast',
    body: 'Phased burn to year-end using real start dates. Combine actuals, scheduled starts, and open-req expected starts across optimistic, expected, and conservative scenarios.',
  },
  {
    title: 'Hiring-Velocity Tracker',
    body: 'Time-to-fill by team, level, and recruiter. Bottleneck attribution shows exactly where reqs sit longest, with forecast fill dates from historical velocity.',
  },
  {
    title: 'Finance-Ready Variance Pack',
    body: 'A monthly bridge: starting budget to ending actual, line by line. Dual sign-off (People Ops + Finance) with locked, auditable period snapshots.',
  },
  {
    title: 'Scenario Planning',
    body: 'Override counts, start dates, and salaries in a what-if scenario. Compare burn and net headcount against the base plan, then freeze it as the working plan.',
  },
  {
    title: 'Alerts & Thresholds',
    body: 'Configurable thresholds (e.g. team >5% over plan cost). Reconciliation runs raise severity-scored alerts you can acknowledge, assign, and resolve.',
  },
  {
    title: 'Sample-Data Seeder',
    body: 'One click populates a realistic company: teams, periods, a versioned plan, reqs, hires, terminations, and budget. Fully demoable on first login.',
  },
]

const steps = [
  { num: '1', label: 'Approved Plan', body: 'Versioned headcount plan lines by team, level, and quarter with budgeted fully-loaded cost.' },
  { num: '2', label: 'Open Reqs', body: 'Requisitions in the pipeline, aged against fill-by dates and linked to plan lines.' },
  { num: '3', label: 'Filled Positions', body: 'Actual hires and terminations from payroll, with start-date phasing for true burn.' },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <nav className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sky-600 text-sm font-bold text-white">
            HR
          </span>
          <span className="text-lg font-bold tracking-tight text-slate-100">HeadcountPlanReconciler</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-slate-300 hover:text-white">
            Pricing
          </Link>
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

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs font-medium text-sky-300">
          HR + Finance, reconciled to one number
        </span>
        <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Reconcile your headcount plan before Finance does
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-slate-400">
          HeadcountPlanReconciler runs a three-way match between your approved plan, open reqs, and actual hires,
          catching overruns, ghost reqs, and misclassified backfills, then ships a Finance-ready variance pack the
          CFO and Head of People can sign together.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white hover:bg-sky-500"
          >
            Start free
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-lg border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-slate-800 bg-slate-900/40 px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold text-white">Personnel cost is the largest line item, and the plan drifts every quarter</h2>
          <p className="mt-4 text-slate-400">
            Managers open unbudgeted reqs. Backfills get counted as growth. Reqs sit open past their fill-by date.
            Today the reconciliation is a manual, 11pm-before-the-business-review spreadsheet ritual that misses
            six-figure overruns. When the CFO asks why comp is $1.4M over plan, nobody can tie the variance to a
            specific req, hire, or plan line.
          </p>
        </div>
      </section>

      {/* Three-way match explainer */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-white">The three-way match</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-400">
          One deterministic reconciliation across the three sources that never agree on their own.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.num} className="rounded-xl border border-slate-800 bg-slate-900/60 p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sm font-bold text-sky-300">
                {s.num}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{s.label}</h3>
              <p className="mt-2 text-sm text-slate-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section className="border-t border-slate-800 bg-slate-900/40 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-2xl font-bold text-white">Everything you need to own the drift</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-xl border border-slate-800 bg-slate-950/60 p-6">
                <h3 className="text-base font-semibold text-sky-300">{f.title}</h3>
                <p className="mt-2 text-sm text-slate-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h2 className="text-3xl font-bold text-white">Sign the same number as Finance</h2>
        <p className="mt-4 text-slate-400">
          Free for every signed-in user. Seed a realistic sample company and run your first reconciliation in under a
          minute.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-lg bg-sky-600 px-6 py-3 text-sm font-semibold text-white hover:bg-sky-500"
          >
            Create your workspace
          </Link>
          <Link
            href="/pricing"
            className="rounded-lg border border-slate-700 px-6 py-3 text-sm font-semibold text-slate-200 hover:bg-slate-800"
          >
            See pricing
          </Link>
        </div>
      </section>

      <footer className="border-t border-slate-800 py-8 text-center text-sm text-slate-600">
        <p>HeadcountPlanReconciler — the HR-Finance three-way headcount match.</p>
      </footer>
    </main>
  )
}
