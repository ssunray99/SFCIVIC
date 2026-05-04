// One-off cleanup: delete the 5 BOS Full Board rows from 2026-01-06 →
// 2026-02-10 that were stored as zero-item due to the transient sf.gov fetch
// failures pre-fix.  After running this, re-run `npm run scrape:bos` to
// re-ingest them with the fetchBytes retry.

import { createAdminClient } from '@/lib/supabase/admin.ts';

const EXTERNAL_IDS = [
  'full-board-meeting-010626',
  'full-board-meeting-011326',
  'full-board-meeting-012726',
  'full-board-meeting-020326',
  'full-board-meeting-021026',
];

async function main() {
  const supabase = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;

  const { data: rows, error: selErr } = await db
    .from('meetings')
    .select('id, source_id, meeting_date, external_id')
    .eq('source_id', 'bos')
    .in('external_id', EXTERNAL_IDS);

  if (selErr) {
    console.error('select failed:', selErr);
    process.exit(1);
  }

  console.log(`Found ${rows.length} rows to delete:`);
  for (const r of rows) console.log(`  ${r.meeting_date}  ${r.external_id}  ${r.id}`);

  if (rows.length === 0) return;

  const { error: delErr } = await db
    .from('meetings')
    .delete()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .in('id', rows.map((r: any) => r.id));

  if (delErr) {
    console.error('delete failed:', delErr);
    process.exit(1);
  }

  console.log(`Deleted ${rows.length} rows.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
