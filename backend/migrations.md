# DB migrations

Supabase Postgres. Run each block **once**, in order, from the Supabase SQL
Editor (`+` icon → new query → paste → Run). All blocks are idempotent — safe
to re-run if you're not sure whether they've been applied.

`backend/schema.sql` is always the up-to-date "from scratch" version of the DB.
If you're starting fresh, run that file instead of the migrations below.

---

## 001 — Initial schema

Adds `entries` table, indexes and Row Level Security. Already applied when you
first ran `backend/schema.sql`.

```sql
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
  created_at   timestamptz not null default now()
);

create index if not exists entries_user_date_idx
  on public.entries (user_id, entry_date);

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
```

---

## 002 — Series ID for recurring entries

Added when the Cash-tab list started collapsing recurring occurrences into one
row and the Edit modal needed to propagate changes across a series.

- `series_id` is a nullable UUID.
- All occurrences created from one recurring insert share the same value.
- Non-recurring entries stay `NULL` and behave exactly as before.

```sql
alter table public.entries add column if not exists series_id uuid;
create index if not exists entries_series_idx on public.entries (series_id);
```

**How the app uses it**
- Backend (`routes_entries.py`):
  - `POST /api/entries` with `repeat != "never"` — generates one UUID and stamps every occurrence with it.
  - `PATCH /api/entries/{id}` — if the row has a `series_id`, non-date fields propagate to every row in the series; the date only updates the single occurrence.
  - `DELETE /api/entries/{id}` — deletes the whole series if the row has a `series_id`.
- Frontend Cash tab groups rows by `series_id` and shows one collapsed row per series with `recurring · N occurrences · through <last_date>`.
- Dashboard worksheet still shows every occurrence — grouping is only for the Cash tab.

---

## Adding a new migration

1. Append a new numbered section to this file with the SQL and a short "why".
2. Update `backend/schema.sql` so a fresh install includes the change.
3. Paste the SQL into a new Supabase SQL Editor query and run it on your project.
