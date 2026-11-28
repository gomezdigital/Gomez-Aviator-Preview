-- Gomez Aviator Intelligence: time-anchored next-round prediction ledger.
-- All timestamps are stored as timestamptz (UTC internally); clients render them
-- in the recorded IANA timezone, currently Africa/Gaborone.
create table if not exists public.aviator_predictions (
  id uuid primary key default gen_random_uuid(),
  game text not null default 'aviator' check (game = 'aviator'),
  source text not null default 'gamedata365',
  as_of_at timestamptz not null,
  display_timezone text not null default 'Africa/Gaborone',
  data_cutoff_round_id text,
  data_cutoff_ended_at timestamptz,
  data_freshness_seconds integer check (data_freshness_seconds is null or data_freshness_seconds >= 0),
  sample_size integer not null default 0 check (sample_size >= 0),
  model_version text not null,
  prediction jsonb not null check (jsonb_typeof(prediction) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'resolved', 'expired', 'unscorable')),
  target_round_id text,
  actual_multiplier numeric(14,4) check (actual_multiplier is null or actual_multiplier >= 1),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint aviator_predictions_resolution_consistency check (
    (status = 'resolved' and target_round_id is not null and actual_multiplier is not null and resolved_at is not null)
    or
    (status <> 'resolved' and actual_multiplier is null and resolved_at is null)
  )
);

create index if not exists aviator_predictions_created_at_idx
  on public.aviator_predictions (created_at desc);
create index if not exists aviator_predictions_pending_idx
  on public.aviator_predictions (as_of_at asc)
  where status = 'pending';

alter table public.aviator_predictions enable row level security;

-- No anon/authenticated policies: prediction records are accessed only by
-- the collector backend using its server-side Supabase service key.
comment on table public.aviator_predictions is
  'Time-anchored predictions targeting the first subsequent observed Aviator round; timestamps stored as timestamptz and rendered in display_timezone.';
