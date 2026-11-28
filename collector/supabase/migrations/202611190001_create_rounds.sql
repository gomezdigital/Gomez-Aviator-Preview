-- Gomez Aviator Intelligence: persistent round observations.
-- Apply in the Supabase SQL Editor or through a reviewed migration workflow.
create table if not exists public.aviator_rounds (
  id bigint generated always as identity primary key,
  source text not null check (length(source) between 1 and 80),
  game text not null default 'aviator' check (game in ('aviator', 'high-flyer', 'jetx')),
  round_id text not null check (length(round_id) between 1 and 180),
  multiplier numeric(14, 4) not null check (multiplier >= 1 and multiplier <= 100000000),
  ended_at timestamptz not null,
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint aviator_rounds_source_game_round_unique unique (source, game, round_id)
);

create index if not exists aviator_rounds_game_ended_at_idx
  on public.aviator_rounds (game, ended_at desc);
create index if not exists aviator_rounds_source_game_ended_at_idx
  on public.aviator_rounds (source, game, ended_at desc);

alter table public.aviator_rounds enable row level security;

-- Intentionally create no anon/authenticated policies.
-- Only the server-side service-role key may write/read through the collector.
