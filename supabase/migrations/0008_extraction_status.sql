-- Decouple "fetched" from "extracted" on meetings rows.
--
-- Background: the only re-run guard before this migration was content_hash
-- uniqueness. A meeting whose extraction returned 0 items (LLM 5xx, scanned
-- PDF, partial gather) was permanently locked at 0 items because the next
-- run saw the same hash and skipped it.
--
-- This migration adds an extraction state machine so the scraper can:
--   - retry rows that previously failed,
--   - retry rows extracted under an older prompt version,
--   - distinguish a meeting that genuinely had no items from one we never
--     successfully extracted,
--   - and surface partial gathers (some PDFs missing) on /analytics.

alter table meetings
  add column extraction_status text not null default 'pending'
    check (extraction_status in ('pending','success','partial','failed','stale')),
  add column extraction_error text,
  add column extraction_attempt_count int not null default 0,
  add column last_extracted_at timestamptz,
  add column last_prompt_version text,
  add column expected_pdf_count int,
  add column fetched_pdf_count int,
  add column fetch_warnings jsonb not null default '[]'::jsonb;

create index meetings_extraction_status_idx
  on meetings (extraction_status)
  where extraction_status <> 'success';

-- Backfill: assume rows that already exist were successfully extracted under
-- their stamped prompt_version. The nightly backfill script will progressively
-- move them to v4 quality.
update meetings m
   set extraction_status = case
     when m.needs_ocr then 'partial'
     when exists (select 1 from agenda_items ai where ai.meeting_id = m.id) then 'success'
     else 'partial'
   end,
   last_extracted_at = m.scraped_at,
   extraction_attempt_count = 1
 where last_extracted_at is null;
