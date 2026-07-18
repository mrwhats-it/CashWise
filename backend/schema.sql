-- Run this in the Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('income','expense')),
  title        text not null,
  category     text,
  amount       numeric(14,2) not null check (amount > 0),
  entry_date   date not null,
  memo         text,
  series_id    uuid,
  created_at   timestamptz not null default now()
);

create index if not exists entries_user_date_idx
  on public.entries (user_id, entry_date);
create index if not exists entries_series_idx
  on public.entries (series_id);

alter table public.entries enable row level security;

drop policy if exists "entries_select_own" on public.entries;
create policy "entries_select_own" on public.entries
  for select using (auth.uid() = user_id);

drop policy if exists "entries_insert_own" on public.entries;
create policy "entries_insert_own" on public.entries
  for insert with check (auth.uid() = user_id);

drop policy if exists "entries_update_own" on public.entries;
create policy "entries_update_own" on public.entries
  for update using (auth.uid() = user_id);

drop policy if exists "entries_delete_own" on public.entries;
create policy "entries_delete_own" on public.entries
  for delete using (auth.uid() = user_id);
