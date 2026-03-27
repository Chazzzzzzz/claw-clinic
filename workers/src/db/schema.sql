-- Claw Clinic Community Cure Forum
-- Run this in your Supabase SQL Editor

create table if not exists cases (
  id uuid default gen_random_uuid() primary key,
  icd_ai_code text not null,
  disease_name text not null,
  symptoms_text text not null,
  evidence_summary text,
  treatment_steps jsonb not null default '[]',
  outcome text not null default 'cured' check (outcome in ('cured', 'partial', 'failed')),
  source text not null default 'community' check (source in ('system', 'community')),
  framework text,
  created_by text,  -- anonymous clinic_id
  created_at timestamptz default now(),
  success_count integer default 0,
  last_verified_at timestamptz
);

-- Index for the primary query pattern
create index if not exists idx_cases_icd_code on cases (icd_ai_code);
create index if not exists idx_cases_created_at on cases (created_at desc);

-- For tracking successful reuse (idempotent per clinic_id per case)
create table if not exists case_successes (
  case_id uuid references cases(id) on delete cascade,
  clinic_id text not null,
  created_at timestamptz default now(),
  primary key (case_id, clinic_id)
);

-- Novel disease registry — AI-discovered ICD-AI codes
create table if not exists disease_registry (
  icd_ai_code text primary key,
  name text not null,
  department text,
  description text,
  source text not null default 'ai_discovered' check (source in ('catalog', 'ai_discovered')),
  first_seen_at timestamptz default now(),
  case_count integer default 0
);

-- Enable Row Level Security (open read, authenticated write)
alter table cases enable row level security;
alter table disease_registry enable row level security;

-- Anyone can read
create policy "Public read access" on cases for select using (true);
create policy "Public read diseases" on disease_registry for select using (true);

-- Anyone can insert (we use rate limiting at the API level, not RLS)
create policy "Public insert cases" on cases for insert with check (true);
create policy "Public insert diseases" on disease_registry for insert with check (true);
create policy "Public update diseases" on disease_registry for update using (true);

-- Allow success_count updates
create policy "Public update cases" on cases for update using (true);
