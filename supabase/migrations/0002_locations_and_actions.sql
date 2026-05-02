-- M9: address geocoding + per-item action layer
-- Adds:
--   * agenda_item_locations  (one row per geocoded address mention)
--   * address_cache          (geocoder result cache, keyed by normalized address)
--   * agenda_items.comment_*, in_person_slot  (action-layer fields)

create table agenda_item_locations (
  id              uuid primary key default gen_random_uuid(),
  agenda_item_id  uuid not null references agenda_items(id) on delete cascade,
  raw_address     text not null,
  lat             double precision,
  lng             double precision,
  neighborhood    text,
  district        int,
  geocoded_at     timestamptz,
  geocode_source  text
);
create index agenda_item_locations_item_idx  on agenda_item_locations (agenda_item_id);
create index agenda_item_locations_neigh_idx on agenda_item_locations (neighborhood);
create index agenda_item_locations_latlng_idx on agenda_item_locations (lat, lng);

create table address_cache (
  address_norm  text primary key,
  lat           double precision,
  lng           double precision,
  source        text,
  created_at    timestamptz not null default now()
);

alter table agenda_items
  add column comment_deadline    date,
  add column comment_email       text,
  add column comment_portal_url  text,
  add column in_person_slot      text;

create index agenda_items_comment_deadline_idx
  on agenda_items (comment_deadline)
  where comment_deadline is not null;

alter table agenda_item_locations enable row level security;
alter table address_cache         enable row level security;

create policy "public read agenda_item_locations" on agenda_item_locations for select using (true);
-- address_cache is service-role-only (no public select policy) — internal cache.
