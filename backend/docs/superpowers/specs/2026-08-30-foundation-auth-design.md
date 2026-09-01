# Foundation & Auth — Design Spec

Date: 2026-08-30
Status: Approved for planning
Scope: Sub-project 1 of 4 for the Bus Ticket Management customer-facing system.

## Context

This is the first of four planned sub-projects that together deliver the full
Customer module described in the product spec (register/login → search →
select bus → select seat → passenger info → review → pay → e-ticket → my
bookings → cancel/refund → notifications).

The four sub-projects, in build order:

1. **Foundation & Auth** (this spec) — repo scaffolding, Docker/docker-compose,
   database schema + seed data for the static catalog (operators, buses,
   routes, schedules, seats), and the full auth module.
2. Search & Booking Flow — search/filter API + UI, seat layout display, seat
   hold-with-expiry, passenger info, booking review.
3. Payment & E-Ticket — Stripe (test mode) integration, webhook-verified
   confirmation, e-ticket generation with QR, view/download/print.
4. My Bookings, Cancellation/Refund & Notifications — bookings list,
   configurable cancellation policy engine, refund calculation, SMTP email
   notifications wired into all events from earlier phases.

Each sub-project gets its own design → spec → plan → implementation cycle.
This document covers sub-project 1 only.

## Goals

- Stand up two independent, dockerized projects (`/backend`, `/frontend`)
  with no shared code between them, connected only by a documented REST/OpenAPI
  contract.
- Provide a working, secure customer auth flow: register, login, logout,
  forgot password, reset password.
- Provide the database schema and seed data for the static bus/route/schedule
  catalog that sub-project 2 will search against.
- `docker compose up` brings up Postgres + backend + frontend with migrations
  and seed data applied automatically.

## Non-goals (deferred to later sub-projects)

- Bus search/filter endpoints and UI.
- Seat selection, holds, passenger info, booking review.
- Payment processing.
- E-ticket generation, QR codes.
- My Bookings, cancellation, refunds.
- Notifications (email sending infrastructure for password reset is in scope;
  the general notification system for booking/payment/ticket/cancellation
  events is not).
- Any operator/admin-facing API for managing buses/routes/schedules — this
  data is seeded directly via a Prisma seed script.

## Architecture

```
Bus Ticket Management/
├── backend/          # NestJS + Prisma + PostgreSQL
├── frontend/          # React + Vite + TypeScript
├── docker-compose.yml
├── .env.example
└── docs/
```

- `backend` and `frontend` are independent Node projects — separate
  `package.json`, `node_modules`, lockfiles. No npm workspaces, no shared
  types package.
- Contract between them is documented via NestJS Swagger (`/api/docs`), not
  enforced by shared code.
- Backend is the only component that talks to Postgres.
- In local dev, frontend (Vite dev server) and backend (Nest dev server) run
  on different ports; CORS with credentials is configured on the backend for
  this case.
- In the dockerized stack, Nginx (serving the built frontend) proxies `/api/*`
  to the backend container, so the containerized app is same-origin and does
  not depend on CORS.

## Data model (Prisma schema, Phase 1 scope)

### Auth-related

- `User`
  - `id` (uuid, pk)
  - `name` (string)
  - `phone` (string)
  - `email` (string, unique)
  - `passwordHash` (string)
  - `role` (enum: `CUSTOMER`; default `CUSTOMER` — no other roles are used by
    this module, the field exists so later modules don't require a breaking
    migration)
  - `createdAt`, `updatedAt`
- `RefreshToken`
  - `id` (uuid, pk)
  - `userId` (fk → User)
  - `tokenHash` (string) — the raw token is never stored
  - `expiresAt` (datetime)
  - `revokedAt` (datetime, nullable)
  - `createdAt`
- `PasswordResetToken`
  - `id` (uuid, pk)
  - `userId` (fk → User)
  - `tokenHash` (string)
  - `expiresAt` (datetime)
  - `usedAt` (datetime, nullable)
  - `createdAt`

### Static catalog (owned by this phase, consumed by later phases)

- `Operator` (id, name)
- `Bus` (id, operatorId fk, name, busType enum: `AC_SEATER` | `AC_SLEEPER` |
  `NON_AC_SEATER` | `NON_AC_SLEEPER`, totalSeats)
- `Seat` (id, busId fk, seatNumber, deck enum: `LOWER` | `UPPER`, seatType
  enum: `SEATER` | `SLEEPER`, row, column) — static physical layout, one row
  per physical seat on a bus
- `Route` (id, source, destination, distanceKm nullable)
- `Schedule` (id, busId fk, routeId fk, departureTime, arrivalTime, fare
  decimal, serviceCharge decimal default 0)
- `BoardingPoint` (id, scheduleId fk, name, time)
- `DroppingPoint` (id, scheduleId fk, name, time)

No per-schedule seat-availability table is created in this phase — that table
(`ScheduleSeat` with status Available/Booked/Held) belongs to sub-project 2,
since seat state only becomes meaningful once booking exists. Adding it later
is a normal additive migration, not a breaking one.

### Seed data

`backend/prisma/seed.ts` creates (idempotently, safe to re-run):
- 2 operators
- 5 buses across the 4 bus types with realistic seat layouts (30–40 seats
  each)
- 4 routes between a handful of cities
- Schedules for each route/bus combination spanning the next 14 days, with
  varying fares and 2–3 boarding/dropping points each

## Auth module

Endpoints (all under `/auth`):

- `POST /auth/register` — body: name, phone, email, password. Validates
  (email format, password strength, phone format), hashes password with
  bcrypt, creates `User` with role `CUSTOMER`. Returns access token in body +
  sets refresh token cookie (auto-login after register).
- `POST /auth/login` — body: email, password. Verifies credentials with a
  generic "invalid email or password" error on failure (no enumeration).
  Issues access token (JWT, 15 min expiry) in response body and a refresh
  token (7 day expiry) as an httpOnly, secure, sameSite cookie.
- `POST /auth/logout` — revokes the refresh token (marks `revokedAt`) and
  clears the cookie. Requires a valid access token.
- `POST /auth/refresh` — reads the refresh cookie, validates it's unexpired
  and unrevoked, issues a new access token. Used by the frontend's
  silent-refresh-on-401 flow.
- `POST /auth/forgot-password` — body: email. Always returns the same generic
  success message regardless of whether the email exists. If it exists,
  generates a random token, stores only its hash with a 30-minute expiry, and
  emails a reset link via SMTP (nodemailer).
- `POST /auth/reset-password` — body: token, newPassword. Validates the
  token's hash matches an unused, unexpired `PasswordResetToken`, updates the
  password, marks the token used, and revokes all of that user's existing
  refresh tokens (forces re-login everywhere after a password change).

Cross-cutting:

- `JwtAuthGuard` validates the access token on all routes by default; routes
  are opt-in public via an `@Public()` decorator (used only by
  register/login/forgot-password/reset-password/refresh).
- A `CustomerOnlyGuard` (checks `role === CUSTOMER`) is applied globally
  alongside the JWT guard, so this module structurally cannot leak into
  non-customer data even though no other roles exist yet.
- Rate limiting (`@nestjs/throttler`) on `login` and `forgot-password`
  (e.g. 5 requests/minute per IP) to blunt brute force and email-bombing.
- All request bodies validated via `class-validator` DTOs with
  `whitelist: true, forbidNonWhitelisted: true`.
- Passwords hashed with bcrypt (cost factor 12).

## Frontend (Phase 1 scope)

- Vite + React + TypeScript, `react-router` for routing.
- Pages: `Register`, `Login`, `ForgotPassword`, `ResetPassword`, and a stub
  authenticated `Home` page (placeholder for sub-project 2's search UI).
- `ProtectedRoute` wrapper redirects unauthenticated users to `Login`.
- Forms built with `react-hook-form` + `zod` schemas mirroring backend
  validation rules (so users get instant feedback before hitting the API).
- Axios instance configured with `withCredentials: true` (for the refresh
  cookie) and a response interceptor that, on a 401, attempts
  `POST /auth/refresh` once and retries the original request before forcing
  logout.
- Auth state held in a React context (`AuthProvider`), exposing
  `user`, `login()`, `register()`, `logout()`.

## Error handling

- A global NestJS exception filter normalizes all errors to:
  `{ statusCode, message, error, path, timestamp }`.
- Validation errors surface field-level messages from `class-validator`.
- Auth failures never reveal whether an email is registered.
- Frontend: an `ErrorBoundary` catches render errors; API errors are mapped to
  inline field errors (validation) or a toast (everything else).

## Docker

- `docker-compose.yml` services:
  - `postgres` — `postgres:16-alpine`, named volume `pgdata`, healthcheck via
    `pg_isready`, credentials from `.env`.
  - `backend` — multi-stage Dockerfile (`deps` → `build` → slim
    `node:20-alpine` runtime). Entrypoint script runs
    `npx prisma migrate deploy && npx prisma db seed` then starts the app.
    `depends_on: postgres` with `condition: service_healthy`. Reads all config
    (DB URL, JWT secret, SMTP creds, Stripe test keys placeholder) from env.
  - `frontend` — multi-stage Dockerfile: `node:20-alpine` build stage running
    `vite build`, served by `nginx:alpine`. Nginx config proxies `/api/*` to
    `http://backend:3000`.
- `.env.example` at repo root documents all required variables with empty/
  placeholder values (`POSTGRES_PASSWORD`, `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`,
  `STRIPE_SECRET_KEY` reserved for sub-project 3). Real `.env` is gitignored.
- `docker compose up --build` is sufficient to get a fully working stack from
  a clean checkout.

## Testing

- Backend (Jest):
  - Unit tests: password hashing/verification, JWT issuance/validation,
    reset-token generation/validation logic.
  - E2E tests (against a real Postgres via a docker-compose test override or
    an ephemeral test database): register → login → forgot-password →
    reset-password happy path; duplicate email on register; wrong password on
    login; expired reset token; already-used reset token; accessing a
    protected route without a token; rate-limit triggering on repeated login
    failures.
- Frontend (Vitest + React Testing Library):
  - Form validation (empty fields, invalid email/phone/password format).
  - `ProtectedRoute` redirect behavior for unauthenticated users.
  - Auth context: login sets user state, logout clears it.

## Open questions / assumptions carried forward

- None blocking — all decisions needed to implement this sub-project have
  been made above. Sub-project 2 will need to decide the exact seat-hold
  expiry duration and sweep-job interval; not addressed here.
