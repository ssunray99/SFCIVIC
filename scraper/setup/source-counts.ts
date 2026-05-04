// One-off: print meeting count per source.
import { createAdminClient } from '@/lib/supabase/admin.ts';
import { SOURCES } from '@/lib/constants.ts';

async function main() {
  const supabase = createAdminClient();
  const results: { name: string; id: string; count: number }[] = [];

  for (const s of SOURCES) {
    const { count, error } = await supabase
      .from('meetings')
      .select('id', { count: 'exact', head: true })
      .eq('source_id', s.id);
    if (error) {
      console.error(`${s.id}: ERROR ${error.message}`);
      continue;
    }
    results.push({ name: s.name, id: s.id, count: count ?? 0 });
  }

  results.sort((a, b) => b.count - a.count);
  const total = results.reduce((sum, r) => sum + r.count, 0);

  const nameW = Math.max(...results.map((r) => r.name.length));
  console.log('');
  console.log('Source'.padEnd(nameW), '  Meetings');
  console.log('-'.repeat(nameW + 12));
  for (const r of results) {
    console.log(r.name.padEnd(nameW), '  ', String(r.count).padStart(6));
  }
  console.log('-'.repeat(nameW + 12));
  console.log('TOTAL'.padEnd(nameW), '  ', String(total).padStart(6));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
