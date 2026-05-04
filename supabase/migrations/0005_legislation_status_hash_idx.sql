-- Replace the B-tree index on legislation.status with a hash index.
-- B-tree indexes have a ~2704-byte row size limit; hash indexes do not,
-- and equality lookups on status (the only query pattern) don't need ordering.
drop index if exists legislation_status_idx;
create index legislation_status_idx on legislation using hash (status);
