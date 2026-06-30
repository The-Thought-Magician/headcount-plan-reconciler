# HeadcountPlanReconciler

Reconcile your approved headcount plan against actual hires, backfills, and open reqs, catching overruns and ghost reqs before Finance does.

HeadcountPlanReconciler is an HR-Finance reconciliation platform that performs a three-way match between the approved headcount plan, the open requisitions in the pipeline, and the actually-filled roles. It runs deterministic analysis to flag over/under-hires, ghost reqs, misclassified backfills, personnel-cost burn drift, and hiring-velocity bottlenecks, then produces a Finance-ready monthly variance pack that reconciles cleanly to the comp budget.

See [`docs/idea.md`](docs/idea.md) for the full product specification and feature map.

## Features

- Workspace and organization setup with fiscal calendar, roles, and team org-tree
- Versioned headcount plan builder with approval workflow
- Requisition intake and management with aging and SLA tracking
- Filled-position / actuals ledger with start-date phasing
- Three-way reconciliation engine (plan vs open-req vs filled)
- Ghost-req detector with severity scoring and a triage queue
- Backfill-vs-growth classifier with net-headcount math
- Personnel-cost burn forecast with scenario phasing
- Hiring-velocity tracker with bottleneck attribution
- Finance-ready monthly variance pack

All features are free for signed-in users. Stripe billing is wired but optional and returns 503 when unconfigured. A built-in sample-data seeder makes the product fully demoable on first login.

## Stack

- **Backend:** Node.js + TypeScript, run directly via `tsx`. Postgres (Neon) for storage.
- **Frontend:** Next.js 15+, React 19+, TypeScript (strict), Tailwind 4, App Router. Located at `web/`.
- **Auth:** Neon Auth.
- **Package manager:** pnpm (Node), required everywhere.
- **Deploy:** Render (backend web service) + Vercel (web).

## Local Development

Prerequisites: Node.js 22.x, pnpm, and a Postgres database (Neon or local).

### Backend

```bash
cd backend
pnpm install
# create backend/.env with DATABASE_URL, PORT, FRONTEND_URL
node --import tsx/esm src/index.ts
```

The backend listens on `PORT` (3001 locally, 10000 on Render).

### Web

```bash
cd web
pnpm install
# create web/.env.local with NEXT_PUBLIC_API_URL and NEON_AUTH_* vars
pnpm dev
```

The web app runs at http://localhost:3000.

### Docker Compose

To bring backend and web up together:

```bash
docker compose up --build
```

## Environment Variables

### Backend

| Variable       | Required | Description                                           |
| -------------- | -------- | ----------------------------------------------------- |
| `DATABASE_URL` | yes      | Postgres connection string (Neon).                    |
| `PORT`         | yes      | Port to listen on (3001 local, 10000 on Render).      |
| `FRONTEND_URL` | yes      | Origin of the web app, used for CORS.                 |
| `NODE_ENV`     | no       | `production` in deployed environments.                |
| `STRIPE_*`     | no       | Optional. Billing returns 503 when unconfigured.      |

### Web

| Variable              | Required | Description                                  |
| --------------------- | -------- | -------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | yes      | Base URL of the backend API.                 |
| `NEON_AUTH_*`         | yes      | Neon Auth configuration for sign-in/sign-up. |

## Notes

- The app does not create its own tables at startup. Provision the schema separately (drizzle-kit push or the Neon console) before first boot.
- Billing is optional. With no Stripe configuration the platform is fully free for signed-in users.
