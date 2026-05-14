# Parish Ministry Scheduler

A parish-owned ministry scheduler with a simple admin console, no volunteer logins, and a Supabase + Resend backend. The current app starts with **Lectors** and **Eucharistic Ministers**, with the data model ready for altar servers, choir, hospitality, or other ministries later.

The app is intentionally free-tier friendly:

- Supabase Postgres stores parish settings, ministries, volunteers, Mass times, availability, assignments, email logs, and audit logs.
- Supabase Auth magic links are used for parish admins.
- Volunteer availability links are simple token links sent by email.
- Resend sends transactional email and can start on the free plan.
- Every core app table has `parish_id`; ministry-scoped tables also have `ministry_id`.
- Admins can switch between all ministries, Lectors, and EMHC from the sidebar.
- The calendar tab gives a simple month-level view of who is doing what at each Mass.

## Local Development

```bash
npm install
npm run dev
```

The frontend runs in demo mode when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are blank, so the admin console and volunteer pages can be reviewed before Supabase is configured.

Useful local URLs:

- Admin console: `http://localhost:5173/admin`
- EMHC availability: `http://localhost:5173/availability?token=demo&ministry=emhc`
- Lector availability: `http://localhost:5173/availability?token=demo&ministry=lector`
- Coverage request: `http://localhost:5173/coverage?token=demo`

## Supabase Setup

1. Create a Supabase project.
2. Apply `supabase/migrations/0001_initial_schema.sql`.
3. Deploy the Edge Functions in `supabase/functions`.
4. Set Edge Function secrets from `.env.example`.
5. Create the first parish row.
6. Create the first Supabase Auth user for the coordinator.
7. Insert matching `admin_users` and `admin_roles` rows for that Auth user.

The public token functions have `verify_jwt = false` in `supabase/config.toml` because they validate their own signed tokens. Admin functions also verify authorization internally so scheduled jobs can call them with `CRON_SECRET`.

## First Parish Seed Example

```sql
insert into public.parishes (
  name,
  from_name,
  reply_to_email,
  coordinator_email
) values (
  'St. Catherine Parish',
  'St. Catherine Ministry Schedule',
  'coordinator@parish.org',
  'coordinator@parish.org'
);

insert into public.ministries (
  parish_id,
  key,
  name,
  short_name,
  role_singular,
  role_plural,
  accent_color,
  sort_order
) values
  ('PARISH_UUID', 'lector', 'Lectors', 'Lectors', 'Lector', 'Lectors', '#356a9a', 1),
  ('PARISH_UUID', 'emhc', 'Eucharistic Ministers', 'EMHC', 'Minister', 'Ministers', '#d4a843', 2);
```

After creating the coordinator through Supabase Auth, connect them:

```sql
insert into public.admin_users (auth_user_id, email, display_name)
values ('AUTH_USER_UUID', 'coordinator@parish.org', 'Coordinator Name');

insert into public.admin_roles (parish_id, admin_user_id, role)
select 'PARISH_UUID', id, 'owner'
from public.admin_users
where email = 'coordinator@parish.org';
```

## Scheduled Jobs

Use Supabase scheduled functions or an external cron to call:

- `send-availability-requests` monthly, around the 16th.
- `generate-schedule` monthly, after availability is due.
- `send-reminders` weekly.

Cron requests should include:

```http
x-cron-secret: YOUR_CRON_SECRET
```

## Email Sender Model

Sender settings live in `parishes`, not code:

- `from_name`
- `reply_to_email`
- `coordinator_email`

That keeps setup simple for volunteers and lets a new coordinator take over without redeploying the app. For production deliverability, verify a parish or SIGNUM-owned sending domain in Resend.

## Real Email E2E: Availability Request

Use a staging Supabase project and a verified Resend test domain before sending to a human inbox.

1. Apply `supabase/migrations/0001_initial_schema.sql` to staging.
2. Deploy the Edge Functions in `supabase/functions`.
3. Set Supabase function secrets:

```bash
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
RESEND_API_KEY=
APP_BASE_URL=http://localhost:5173
DEFAULT_PARISH_ID=
CRON_SECRET=
```

4. Create one generic test parish with `from_name = Example Parish Ministry Schedule` and a `reply_to_email` on the verified Resend domain.
5. Create one admin Auth user and matching `admin_users` / `admin_roles` rows.
6. Seed Lectors and EMHC ministries, next-month weekend Mass times, and exactly one active volunteer in the ministry being tested using your real inbox.
7. Start the app locally with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set in `.env.local`.
8. Sign in as the staging admin, switch to the test ministry, and choose `More actions` → `Request availability`.
9. Confirm that the modal shows one active volunteer, then send.
10. Verify the real inbox email, click `Submit Availability`, submit the form, and confirm `email_events`, `availability_requests.submitted_at`, and `availability_responses` in Supabase.

Keep all real parish volunteers out of staging or inactive during this test.

## Tests

```bash
npm run test
```

The scheduler tests cover recurring/one-time Mass expansion, active volunteer filtering, insufficient availability, same-day double-booking prevention, and load balancing.
