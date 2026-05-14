create extension if not exists pgcrypto;

create table public.parishes (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  -- Kept for backward-compatible defaults; per-ministry configuration lives in public.ministries.
  ministry_name text not null default 'Eucharistic Ministers',
  ministry_short_name text not null default 'EMHC',
  timezone text not null default 'America/Los_Angeles',
  from_name text not null,
  reply_to_email text not null,
  coordinator_email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.ministries (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  key text not null,
  name text not null,
  short_name text not null,
  role_singular text not null,
  role_plural text not null,
  accent_color text not null default '#ff7033',
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parish_id, key)
);

create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid references auth.users(id) on delete cascade,
  email text not null unique,
  display_name text,
  created_at timestamptz not null default now()
);

create table public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  ministry_id uuid references public.ministries(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  role text not null check (role in ('owner', 'coordinator', 'assistant')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (parish_id, admin_user_id)
);

create table public.volunteers (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  name text not null,
  email text not null,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parish_id, email)
);

create table public.volunteer_ministries (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  volunteer_id uuid not null references public.volunteers(id) on delete cascade,
  ministry_id uuid not null references public.ministries(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (volunteer_id, ministry_id)
);

create table public.mass_times (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  ministry_id uuid not null references public.ministries(id) on delete cascade,
  label text not null,
  day_of_week integer check (day_of_week between 0 and 6),
  specific_date date,
  service_time time not null,
  ministers_needed integer not null default 4 check (ministers_needed > 0),
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (day_of_week is not null and specific_date is null)
    or (day_of_week is null and specific_date is not null)
  )
);

create table public.mass_instances (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  ministry_id uuid not null references public.ministries(id) on delete cascade,
  mass_time_id uuid references public.mass_times(id) on delete set null,
  service_date date not null,
  service_time time not null,
  label text not null,
  ministers_needed integer not null check (ministers_needed > 0),
  status text not null default 'draft' check (status in ('draft', 'needs_attention', 'approved', 'cancelled', 'published')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parish_id, ministry_id, service_date, service_time, label)
);

create table public.availability_requests (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  ministry_id uuid not null references public.ministries(id) on delete cascade,
  volunteer_id uuid not null references public.volunteers(id) on delete cascade,
  month date not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (volunteer_id, ministry_id, month)
);

create table public.availability_responses (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  ministry_id uuid not null references public.ministries(id) on delete cascade,
  volunteer_id uuid not null references public.volunteers(id) on delete cascade,
  mass_instance_id uuid not null references public.mass_instances(id) on delete cascade,
  availability_request_id uuid not null references public.availability_requests(id) on delete cascade,
  available boolean not null,
  created_at timestamptz not null default now(),
  unique (availability_request_id, mass_instance_id)
);

create table public.schedule_runs (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  ministry_id uuid references public.ministries(id) on delete cascade,
  month date not null,
  status text not null default 'draft' check (status in ('draft', 'reviewing', 'published', 'cancelled')),
  generated_by uuid references public.admin_users(id) on delete set null,
  generated_at timestamptz not null default now()
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  ministry_id uuid not null references public.ministries(id) on delete cascade,
  mass_instance_id uuid not null references public.mass_instances(id) on delete cascade,
  volunteer_id uuid not null references public.volunteers(id) on delete cascade,
  schedule_run_id uuid references public.schedule_runs(id) on delete set null,
  position_label text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'coverage_requested', 'cancelled')),
  coverage_token_hash text unique,
  coverage_requested_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mass_instance_id, volunteer_id)
);

create table public.email_events (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  type text not null,
  recipient_email text not null,
  subject text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  provider_id text,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  parish_id uuid not null references public.parishes(id) on delete cascade,
  actor_admin_user_id uuid references public.admin_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index idx_volunteers_parish on public.volunteers(parish_id);
create index idx_volunteer_ministries_parish on public.volunteer_ministries(parish_id, ministry_id);
create index idx_ministries_parish on public.ministries(parish_id, sort_order);
create index idx_mass_times_parish on public.mass_times(parish_id);
create index idx_mass_instances_month on public.mass_instances(parish_id, service_date);
create index idx_availability_requests_token on public.availability_requests(token_hash);
create index idx_availability_responses_mass on public.availability_responses(mass_instance_id);
create index idx_assignments_mass on public.assignments(mass_instance_id);
create index idx_email_events_parish_created on public.email_events(parish_id, created_at desc);
create index idx_audit_log_parish_created on public.audit_log(parish_id, created_at desc);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger touch_parishes_updated_at before update on public.parishes
for each row execute function public.touch_updated_at();

create trigger touch_ministries_updated_at before update on public.ministries
for each row execute function public.touch_updated_at();

create trigger touch_volunteers_updated_at before update on public.volunteers
for each row execute function public.touch_updated_at();

create trigger touch_mass_times_updated_at before update on public.mass_times
for each row execute function public.touch_updated_at();

create trigger touch_mass_instances_updated_at before update on public.mass_instances
for each row execute function public.touch_updated_at();

create trigger touch_assignments_updated_at before update on public.assignments
for each row execute function public.touch_updated_at();

create or replace function public.current_admin_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select au.id
  from public.admin_users au
  where au.auth_user_id = auth.uid()
  limit 1;
$$;

create or replace function public.is_parish_admin(target_parish_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles ar
    join public.admin_users au on au.id = ar.admin_user_id
    where au.auth_user_id = auth.uid()
      and ar.parish_id = target_parish_id
      and ar.active = true
  );
$$;

create or replace function public.is_parish_owner_or_coordinator(target_parish_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_roles ar
    join public.admin_users au on au.id = ar.admin_user_id
    where au.auth_user_id = auth.uid()
      and ar.parish_id = target_parish_id
      and ar.active = true
      and ar.role in ('owner', 'coordinator')
  );
$$;

alter table public.parishes enable row level security;
alter table public.ministries enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_roles enable row level security;
alter table public.volunteers enable row level security;
alter table public.volunteer_ministries enable row level security;
alter table public.mass_times enable row level security;
alter table public.mass_instances enable row level security;
alter table public.availability_requests enable row level security;
alter table public.availability_responses enable row level security;
alter table public.schedule_runs enable row level security;
alter table public.assignments enable row level security;
alter table public.email_events enable row level security;
alter table public.audit_log enable row level security;

create policy "admins can read their parishes" on public.parishes
for select to authenticated using (public.is_parish_admin(id));

create policy "admins can update parish settings" on public.parishes
for update to authenticated using (public.is_parish_owner_or_coordinator(id))
with check (public.is_parish_owner_or_coordinator(id));

create policy "admins can read ministries" on public.ministries
for select to authenticated using (public.is_parish_admin(parish_id));
create policy "coordinators can mutate ministries" on public.ministries
for all to authenticated using (public.is_parish_owner_or_coordinator(parish_id))
with check (public.is_parish_owner_or_coordinator(parish_id));

create policy "admins can read admin users" on public.admin_users
for select to authenticated using (
  exists (
    select 1
    from public.admin_roles ar
    where ar.admin_user_id = admin_users.id
      and public.is_parish_admin(ar.parish_id)
  )
);

create policy "admins can read roles" on public.admin_roles
for select to authenticated using (public.is_parish_admin(parish_id));

create policy "admins can read volunteers" on public.volunteers
for select to authenticated using (public.is_parish_admin(parish_id));
create policy "coordinators can mutate volunteers" on public.volunteers
for all to authenticated using (public.is_parish_owner_or_coordinator(parish_id))
with check (public.is_parish_owner_or_coordinator(parish_id));

create policy "admins can read volunteer ministry memberships" on public.volunteer_ministries
for select to authenticated using (public.is_parish_admin(parish_id));
create policy "coordinators can mutate volunteer ministry memberships" on public.volunteer_ministries
for all to authenticated using (public.is_parish_owner_or_coordinator(parish_id))
with check (public.is_parish_owner_or_coordinator(parish_id));

create policy "admins can read mass times" on public.mass_times
for select to authenticated using (public.is_parish_admin(parish_id));
create policy "coordinators can mutate mass times" on public.mass_times
for all to authenticated using (public.is_parish_owner_or_coordinator(parish_id))
with check (public.is_parish_owner_or_coordinator(parish_id));

create policy "admins can read mass instances" on public.mass_instances
for select to authenticated using (public.is_parish_admin(parish_id));
create policy "coordinators can mutate mass instances" on public.mass_instances
for all to authenticated using (public.is_parish_owner_or_coordinator(parish_id))
with check (public.is_parish_owner_or_coordinator(parish_id));

create policy "admins can read availability requests" on public.availability_requests
for select to authenticated using (public.is_parish_admin(parish_id));

create policy "admins can read availability responses" on public.availability_responses
for select to authenticated using (public.is_parish_admin(parish_id));

create policy "admins can read schedule runs" on public.schedule_runs
for select to authenticated using (public.is_parish_admin(parish_id));
create policy "coordinators can mutate schedule runs" on public.schedule_runs
for all to authenticated using (public.is_parish_owner_or_coordinator(parish_id))
with check (public.is_parish_owner_or_coordinator(parish_id));

create policy "admins can read assignments" on public.assignments
for select to authenticated using (public.is_parish_admin(parish_id));
create policy "coordinators can mutate assignments" on public.assignments
for all to authenticated using (public.is_parish_owner_or_coordinator(parish_id))
with check (public.is_parish_owner_or_coordinator(parish_id));

create policy "admins can read email events" on public.email_events
for select to authenticated using (public.is_parish_admin(parish_id));

create policy "admins can read audit log" on public.audit_log
for select to authenticated using (public.is_parish_admin(parish_id));

-- Service-role Edge Functions perform public token flows and scheduled jobs.
-- They bypass RLS by design, while admin UI access remains protected by policies above.
