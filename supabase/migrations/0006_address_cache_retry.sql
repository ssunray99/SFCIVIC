-- Add a timestamp so we can re-attempt stale negative-cache entries.
-- Old failures (lat/lng null) older than 30 days will be retried instead
-- of permanently treated as ungeocodable.

alter table address_cache
  add column last_attempted_at timestamptz not null default now();

-- Backfill existing rows so the new column matches their original creation time.
update address_cache set last_attempted_at = created_at;
