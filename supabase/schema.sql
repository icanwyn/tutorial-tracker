-- Tutorial Tracker — run this once in Supabase SQL Editor
-- Dashboard → SQL Editor → New query → paste → Run

create table if not exists public.app_state (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Single document row used by the app
insert into public.app_state (id, data)
values ('main', '{}'::jsonb)
on conflict (id) do nothing;

-- Server uses the service_role key (bypasses RLS).
-- Lock down so anon/authenticated cannot read/write the blob.
alter table public.app_state enable row level security;

-- No policies for anon/authenticated → client-side keys cannot access this table.
-- Only service_role (used by Next.js API routes) can read/write.

comment on table public.app_state is
  'Full Tutorial Tracker JSON database (one row). Written only by server with service role.';
