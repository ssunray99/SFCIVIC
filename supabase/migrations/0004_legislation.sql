-- M14: cross-committee project tracking
-- legislation rows are keyed on matter_file_number extracted from BOS agendas.
-- The enrichment scraper (scraper/setup/legistar-html-enrich.ts) populates these
-- from sfgov.legistar.com HTML matter detail pages.

create table legislation (
  matter_file_number  text primary key,
  title               text,
  matter_type         text,
  status              text,
  current_body        text,
  sponsor             text,
  intro_date          date,
  final_action_date   date,
  url                 text,
  enriched_at         timestamptz,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now()
);

create table legislation_history (
  id                  uuid primary key default gen_random_uuid(),
  matter_file_number  text not null references legislation(matter_file_number) on delete cascade,
  action_date         date,
  action              text,
  body                text,
  result              text,
  created_at          timestamptz default now()
);

create index legislation_intro_date_idx  on legislation         (intro_date desc);
create index legislation_status_idx      on legislation         (status);
create index legislation_history_file_idx on legislation_history (matter_file_number);
create index legislation_history_date_idx on legislation_history (action_date desc);

alter table legislation         enable row level security;
alter table legislation_history enable row level security;

create policy "public select" on legislation         for select using (true);
create policy "public select" on legislation_history for select using (true);
