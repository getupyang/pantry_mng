-- Pantry backend schema (v1 + v2)
-- Run in Supabase SQL editor.

create extension if not exists pgcrypto;

create table if not exists public.pantry_families (
  id uuid primary key default gen_random_uuid(),
  data_json jsonb not null default '{"items":[],"locations":[]}'::jsonb,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pantry_clients (
  client_id text primary key,
  family_id uuid not null references public.pantry_families(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create table if not exists public.pantry_join_tokens (
  token text primary key,
  family_id uuid not null references public.pantry_families(id) on delete cascade,
  created_by_client_id text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.pantry_recognition_usage (
  id bigserial primary key,
  family_id uuid,
  client_id text,
  req_type text not null check (req_type in ('photo', 'order')),
  status text not null check (status in ('ok', 'error')),
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_pantry_clients_family_id on public.pantry_clients(family_id);
create index if not exists idx_pantry_join_tokens_family_id on public.pantry_join_tokens(family_id);
create index if not exists idx_pantry_join_tokens_active on public.pantry_join_tokens(revoked_at, expires_at);
create index if not exists idx_pantry_recognition_usage_created_at on public.pantry_recognition_usage(created_at);

create or replace function public.pantry_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'trg_pantry_families_updated_at'
  ) then
    create trigger trg_pantry_families_updated_at
    before update on public.pantry_families
    for each row
    execute procedure public.pantry_set_updated_at();
  end if;
end
$$;

