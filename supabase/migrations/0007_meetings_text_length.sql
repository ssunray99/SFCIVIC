-- Add text_length to meetings so we can audit how much collected text is
-- being truncated before reaching the LLM.  Populated by scrapers going
-- forward; NULL on rows inserted before this migration.
ALTER TABLE meetings ADD COLUMN text_length integer;
