import Link from 'next/link'

const features = [
  {
    title: 'Three-Way Reconciliation',
    body: 'Reconcile planned, open-req, and filled headcount across every team, level, and quarter in a single deterministic run. Over-hire, under-hire, and at-risk positions are flagged automatically, with full cost variance and line-level drill-down.',
  },
  {
    title: 'Ghost-Req Detector',
    body: 'Identify requisitions with no approved plan line, opens that have blown past their fill-by date, and abandoned reqs before they distort your numbers. A severity-scored triage queue routes each one to resolution.',
  },
  {
    title: 'Backfill vs Growth Classifier',
    body: 'Automatically match terminations to opens on the same team and level so leadership sees true net headcount expansion, growth hires net of backfills, without manual reconciliation.',
  },
  {
    title: 'Personnel-Cost Burn Forecast',
    body: 'Project personnel spend to year-end using actual start dates, scheduled starts, and open-req expected starts, modeled across optimistic, expected, and conservative scenarios.',
  },
  {
    title: 'Hiring-Velocity Tracker',
    body: 'Benchmark time-to-fill by team, level, and recruiter. Bottleneck attribution pinpoints exactly where requisitions stall, with forecast fill dates derived from historical velocity.',
  },
  {
    title: 'Finance-Ready Variance Pack',
    body: 'Generate a monthly bridge from starting budget to ending actual, line by line, with dual sign-off from People Ops and Finance and locked, auditable period snapshots.',
  },
  {
    title: 'Scenario Planning',
    body: 'Model what-if scenarios by overriding counts, start dates, and salaries. Compare projected burn and net headcount against the base plan, then promote a scenario to the working plan.',
  },
  {
    title: 'Alerts & Thresholds',
    body: 'Configure thresholds, such as a team exceeding five percent over plan cost, so every reconciliation run surfaces severity-scored alerts your team can acknowledge, assign, and resolve.',
  },
  {
    title: 'Sample-Data Seeder',
    body: 'Populate a realistic sample company in one step, complete with teams, periods, a versioned plan, requisitions, hires, terminations, and budget, so your team can evaluate the platform immediately.',
  },
]

const steps = [
  { num: '1', label: 'Approved Plan', body: 'A versioned headcount plan, broken out by team, level, and quarter, with budgeted fully-loaded cost as the source of truth.' },
  { num: '2', label: 'Open Reqs', body: 'Requisitions in flight, aged against fill-by dates and linked back to the plan line that authorized them.' },
  { num: '3', label: 'Filled Positions', body: 'Actual hires and terminations sourced from payroll, phased by start date to produce an accurate burn.' },
]

export default function Home() {
  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <nav className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-600 text-sm font-bold text-white">
            HR
          </span>
          <span className="text-lg font-bold tracking-tight text-zinc-100">HeadcountPlanReconciler</span>
        </span>
        <div className="flex items-center gap-4">
          <Link href="/pricing" className="text-sm text-zinc-300 hover:text-teal-400">
            Pricing
          </Link>
          <Link href="/auth/sign-in" className="text-sm text-zinc-300 hover:text-teal-400">
            Sign In
          </Link>
          <Link
            href="/auth/sign-up"
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500"
          >
            Get Started
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 py-24 text-center">
        <span className="inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-300">
          Built for HR and Finance leaders who own the same number
        </span>
        <h1 className="mt-6 text-4xl font-bold tracking-tight text-white sm:text-5xl">
          Bring your headcount plan and your actuals into agreement, before the business review
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-zinc-400">
          HeadcountPlanReconciler runs a three-way match between your approved plan, open requisitions, and actual
          hires, surfacing overruns, ghost reqs, and misclassified backfills as they happen. The output is a
          finance-ready variance pack that People and Finance leadership can sign off on together.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-md bg-teal-600 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-500"
          >
            Start free
          </Link>
          <Link
            href="/auth/sign-in"
            className="rounded-md border border-zinc-700 px-6 py-3 text-sm font-semibold text-zinc-200 hover:border-teal-600 hover:text-teal-400"
          >
            Sign in
          </Link>
        </div>
      </section>

      {/* Problem */}
      <section className="border-y border-zinc-800 bg-zinc-900/40 px-6 py-16">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold text-white">Personnel cost is the largest line on the P&L, and the plan drifts every quarter</h2>
          <p className="mt-4 text-zinc-400">
            Managers open requisitions that were never budgeted. Backfills get counted as growth. Reqs sit open well
            past their fill-by date. Left unmanaged, reconciliation becomes a manual, last-minute spreadsheet
            exercise that misses material overruns, and when Finance asks why compensation spend is over plan,
            nobody can trace the variance back to a specific requisition, hire, or plan line.
          </p>
        </div>
      </section>

      {/* Three-way match explainer */}
      <section className="mx-auto max-w-5xl px-6 py-20">
        <h2 className="text-center text-2xl font-bold text-white">How the three-way match works</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-zinc-400">
          One deterministic reconciliation across the three systems of record that rarely agree on their own.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.num} className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-500/15 text-sm font-bold text-teal-300">
                {s.num}
              </div>
              <h3 className="mt-4 text-lg font-semibold text-white">{s.label}</h3>
              <p className="mt-2 text-sm text-zinc-400">{s.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section className="border-t border-zinc-800 bg-zinc-900/40 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <h2 className="text-center text-2xl font-bold text-white">A single system of record for plan-to-actual headcount</h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-6">
                <h3 className="text-base font-semibold text-teal-300">{f.title}</h3>
                <p className="mt-2 text-sm text-zinc-400">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h2 className="text-3xl font-bold text-white">Give Finance and People leadership the same number</h2>
        <p className="mt-4 text-zinc-400">
          Free for every signed-in user. Seed a realistic sample company and run your first reconciliation in under a
          minute.
        </p>
        <div className="mt-8 flex items-center justify-center gap-4">
          <Link
            href="/auth/sign-up"
            className="rounded-md bg-teal-600 px-6 py-3 text-sm font-semibold text-white hover:bg-teal-500"
          >
            Create your workspace
          </Link>
          <Link
            href="/pricing"
            className="rounded-md border border-zinc-700 px-6 py-3 text-sm font-semibold text-zinc-200 hover:border-teal-600 hover:text-teal-400"
          >
            See pricing
          </Link>
        </div>
      </section>

      <footer className="border-t border-zinc-800 py-8 text-center text-sm text-zinc-600">
        <p>HeadcountPlanReconciler — the HR-Finance three-way headcount match.</p>
      </footer>
    </main>
  )
}
