-- SF Civic Tracker — initial schema
-- Apply with: supabase db push  (after `supabase link --project-ref <ref>`)

create extension if not exists pgcrypto;

-- Source registry: 'planning' | 'bos' | 'hearings'
create table sources (
  id          text primary key,
  name        text not null,
  url         text not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- One row per scheduled meeting (or notice). Raw bytes go to Storage.
create table meetings (
  id                uuid primary key default gen_random_uuid(),
  source_id         text not null references sources(id),
  external_id       text,
  title             text not null,
  meeting_date      date not null,
  meeting_time      time,
  location          text,
  agenda_url        text,
  raw_storage_path  text,
  content_hash      text not null,
  needs_ocr         boolean not null default false,
  scraped_at        timestamptz not null default now(),
  unique (source_id, external_id),
  unique (source_id, content_hash)
);
create index meetings_date_idx on meetings (meeting_date desc);

-- LLM-extracted agenda items
create table agenda_items (
  id                uuid primary key default gen_random_uuid(),
  meeting_id        uuid not null references meetings(id) on delete cascade,
  position          int,
  title             text not null,
  summary           text,
  item_type         text,
  district          int check (district between 1 and 11),
  neighborhoods     text[] not null default '{}',
  topics            text[] not null default '{}',
  llm_model         text,
  prompt_version    text,
  llm_extracted_at  timestamptz,
  search_tsv        tsvector generated always as (
                      to_tsvector('english',
                        coalesce(title,'') || ' ' || coalesce(summary,''))) stored
);
create index agenda_items_search_idx   on agenda_items using gin (search_tsv);
create index agenda_items_topics_idx   on agenda_items using gin (topics);
create index agenda_items_neigh_idx    on agenda_items using gin (neighborhoods);
create index agenda_items_district_idx on agenda_items (district);
create index agenda_items_meeting_idx  on agenda_items (meeting_id);

-- Per-source scrape job tracking
create table scrape_runs (
  id           uuid primary key default gen_random_uuid(),
  source_id    text not null references sources(id),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null,
  items_found  int default 0,
  items_new    int default 0,
  error        text
);
create index scrape_runs_started_idx on scrape_runs (started_at desc);

-- Public read-only access. Writes happen via service_role key (bypasses RLS).
alter table sources       enable row level security;
alter table meetings      enable row level security;
alter table agenda_items  enable row level security;
alter table scrape_runs   enable row level security;

create policy "public read sources"      on sources      for select using (true);
create policy "public read meetings"     on meetings     for select using (true);
create policy "public read agenda_items" on agenda_items for select using (true);
create policy "public read scrape_runs"  on scrape_runs  for select using (true);
