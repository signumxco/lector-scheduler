<p align="center">
  <img src="./public/the-ministry-scheduler-social.png" alt="The Ministry Scheduler social banner" width="1100" />
</p>

# The Ministry Scheduler

The Ministry Scheduler is a free, parish-owned ministry scheduling system you can use in your own parish.

If you want help getting it deployed, want guidance tailoring it to your workflow, or want a more custom-made solution like this one, schedule time with SIGNUMZ at [signumz.com](https://signumz.com).

It starts with **Lectors** and **Eucharistic Ministers**, and the data model is ready for altar servers, choir, hospitality, or other ministries later.

The app is intentionally free-tier friendly:

- Supabase Postgres stores parish settings, ministries, volunteers, Mass times, availability, assignments, email logs, and audit logs.
- Supabase Auth magic links are used for parish admins.
- Volunteer availability links are simple token links sent by email.
- Resend sends transactional email and can start on the free plan.
- Every core app table has `parish_id`; ministry-scoped tables also have `ministry_id`.
- Admins can switch between all ministries, Lectors, and EMHC from the sidebar.
- The calendar tab gives a simple month-level view of who is doing what at each Mass.

> Free to clone, free to adapt, and free to run for your parish. If you'd like help or a custom version, the door is open at [signumz.com](https://signumz.com).

## Local Development

```bash
npm install
npm run dev
```

The frontend runs in demo mode when `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are blank, so the admin console and volunteer pages can be reviewed before Supabase is configured.

For production-style local testing, set both Supabase frontend env vars in `.env.local`. If only one is set, the app shows a configuration error instead of silently falling back to demo data. Demo previews are hidden in configured mode unless you explicitly set `VITE_ENABLE_DEMO_MODE=true`.

Before testing real auth in a browser that has been used for demos, clear stale local sessions:

```js
localStorage.removeItem('emhc-scheduler-session')
localStorage.removeItem('ministry-scheduler-session')
```

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
8. Make sure `.env.local` includes `VITE_ENABLE_DEMO_MODE=false`, then restart `npm run dev`.
9. Clear `emhc-scheduler-session` and `ministry-scheduler-session` from browser localStorage.
10. Open `/admin`; it should show `Coordinator sign in`, not the dashboard and not a demo console button.
11. Sign in as the staging admin, switch to the test ministry, and choose `More actions` → `Request availability`.
12. Confirm that the modal shows one active volunteer, then send.
13. Verify the real inbox email, click `Submit Availability`, submit the form, and confirm `email_events`, `availability_requests.submitted_at`, and `availability_responses` in Supabase.

Keep all real parish volunteers out of staging or inactive during this test.

## Tests

```bash
npm run test
```

The scheduler tests cover recurring/one-time Mass expansion, active volunteer filtering, insufficient availability, same-day double-booking prevention, and load balancing.
