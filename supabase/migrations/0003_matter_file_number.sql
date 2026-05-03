-- M14 prep: matter file number on agenda items.
-- BOS agendas print a Legistar/BOS file number (e.g. "250604") next to each
-- item; the LLM extraction now pulls this when present. The number serves as
-- the cross-committee join key — the same ordinance heard in Land Use and
-- Full Board carries the same matter_file_number on both rows.
--
-- Planning Commission and HPC items typically don't carry file numbers, so
-- this column is nullable. The index is partial (only non-null) since most
-- queries will look up "all items for matter X" rather than scan nulls.

alter table agenda_items
  add column matter_file_number text;

create index agenda_items_matter_file_idx
  on agenda_items (matter_file_number)
  where matter_file_number is not null;
