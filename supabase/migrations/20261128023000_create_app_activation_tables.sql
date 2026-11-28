-- Secure server-managed activation records.
-- These tables are accessed only by the collector using the Supabase service role.
create table if not exists public.app_activation_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique check (code_hash ~ '^[a-f0-9]{64}$'),
  code_hint text not null check (length(code_hint) between 4 and 8),
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  constraint app_activation_codes_valid_expiry
    check (expires_at is null or expires_at > created_at)
);

create table if not exists public.app_activation_sessions (
  id uuid primary key default gen_random_uuid(),
  code_id uuid not null references public.app_activation_codes(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  last_seen_at timestamptz,
  constraint app_activation_sessions_valid_expiry
    check (expires_at > created_at)
);

create index if not exists app_activation_sessions_code_id_idx
  on public.app_activation_sessions(code_id);
create index if not exists app_activation_sessions_expiry_idx
  on public.app_activation_sessions(expires_at);

alter table public.app_activation_codes enable row level security;
alter table public.app_activation_sessions enable row level security;

revoke all on public.app_activation_codes from anon, authenticated, public;
revoke all on public.app_activation_sessions from anon, authenticated, public;
grant all on public.app_activation_codes to service_role;
grant all on public.app_activation_sessions to service_role;
