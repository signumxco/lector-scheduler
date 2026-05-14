create table public.reading_cache (
  id uuid primary key default gen_random_uuid(),
  service_date date not null unique,
  url text not null,
  status text not null default 'parsed' check (status in ('parsed', 'failed')),
  readings jsonb not null default '[]'::jsonb,
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
