// One-shot smoke test for SF DataSF's Legislation dataset (cz9b-x8ed).
// Run with: npm run smoke:datasf.
//
// Hypothesis: SF's open-data portal exposes a Legislation dataset via the
// SODA API. If it's current (post-2024 data) and includes matter file
// numbers + cross-committee history, it could replace the dropped Legistar
// API as the M14 project-tracking source — without any HTML scraping.
//
// Probes:
//   [A] Schema/metadata — what columns exist?
//   [B] Top 5 by intro date desc — is data current?
//   [C] Top 5 by id desc / created desc — alternate freshness probe
//   [D] Distinct sponsors / bodies — does it span all BOS committees?
//   [E] Sample row — full field dump for one recent record

const SODA_BASE = 'https://data.sfgov.org/resource/cz9b-x8ed.json';
const META_BASE = 'https://data.sfgov.org/api/views/cz9b-x8ed';

type SodaRow = Record<string, unknown>;

type ColumnMeta = {
  name: string;
  fieldName: string;
  dataTypeName: string;
  description?: string;
};

type ViewMeta = {
  id: string;
  name: string;
  description?: string;
  rowsUpdatedAt?: number;
  columns: ColumnMeta[];
};

type StepResult = { name: string; ok: boolean; note?: string };
const results: StepResult[] = [];

async function get<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '<unreadable>');
    throw new Error(`HTTP ${resp.status} ${resp.statusText} — ${body.slice(0, 300)}`);
  }
  return (await resp.json()) as T;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function shortErr(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200);
}

async function runStep<T>(
  name: string,
  fn: () => Promise<T>,
  noteFromResult?: (r: T) => string | undefined,
): Promise<T | undefined> {
  try {
    const r = await fn();
    results.push({ name, ok: true, note: noteFromResult?.(r) });
    return r;
  } catch (err) {
    results.push({ name, ok: false, note: shortErr(err) });
    console.error(`\n${name} failed: ${shortErr(err)}`);
    return undefined;
  }
}

async function probeMeta(): Promise<ViewMeta> {
  console.log(`\n[A] GET ${META_BASE}`);
  const meta = await get<ViewMeta>(META_BASE);
  console.log(`Dataset: ${meta.name} (id=${meta.id})`);
  if (meta.description) console.log(`Description: ${meta.description.slice(0, 200)}`);
  if (meta.rowsUpdatedAt) {
    const updated = new Date(meta.rowsUpdatedAt * 1000).toISOString().slice(0, 10);
    console.log(`Rows last updated: ${updated}`);
  }
  console.log(`\nColumns (${meta.columns.length}):`);
  for (const col of meta.columns) {
    console.log(`  ${pad(col.fieldName, 32)}${pad(col.dataTypeName, 14)}${col.name}`);
  }
  return meta;
}

function pickDateField(meta: ViewMeta): string | undefined {
  // Look for a column that smells like an intro/created/updated date
  const candidates = ['intro', 'introduce', 'created', 'date', 'updated'];
  for (const needle of candidates) {
    const col = meta.columns.find(
      (c) =>
        c.fieldName.toLowerCase().includes(needle) &&
        /date|timestamp/i.test(c.dataTypeName),
    );
    if (col) return col.fieldName;
  }
  return meta.columns.find((c) => /date|timestamp/i.test(c.dataTypeName))?.fieldName;
}

async function probeRecentByField(field: string, label: string): Promise<SodaRow[]> {
  const url = `${SODA_BASE}?$order=${encodeURIComponent(field)}+DESC&$limit=5`;
  console.log(`\n[${label}] GET ${url}`);
  const rows = await get<SodaRow[]>(url);
  console.log(`Received ${rows.length} row(s) ordered by ${field} desc.\n`);
  if (rows.length > 0) printSummaryRow(rows, field);
  return rows;
}

function printSummaryRow(rows: SodaRow[], emphasizeField?: string): void {
  // Print a compact view: emphasize date field, then a few key fields
  const keyFields = ['file_number', 'file_no', 'fileno', 'title', 'name', 'type', 'status', 'sponsor'];
  for (const row of rows) {
    const date = emphasizeField ? formatVal(row[emphasizeField]) : '';
    const parts: string[] = [];
    if (date) parts.push(`${emphasizeField}=${date}`);
    for (const f of keyFields) {
      if (row[f] !== undefined) {
        const v = formatVal(row[f]).slice(0, 60);
        if (v) parts.push(`${f}=${v}`);
      }
    }
    console.log(`  ${parts.join(' | ')}`);
  }
}

function formatVal(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v.slice(0, 80);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v).slice(0, 80);
}

async function probeDistinctValues(field: string, label: string): Promise<string[]> {
  const url = `${SODA_BASE}?$select=${encodeURIComponent(field)}&$group=${encodeURIComponent(field)}&$limit=200`;
  console.log(`\n[${label}] GET ${url}`);
  const rows = await get<SodaRow[]>(url);
  const values = rows.map((r) => formatVal(r[field])).filter((v) => v !== '');
  console.log(`Received ${values.length} distinct value(s) for ${field}.`);
  for (const v of values.slice(0, 20)) console.log(`  ${v}`);
  if (values.length > 20) console.log(`  ... (${values.length - 20} more)`);
  return values;
}

async function probeSampleRow(): Promise<SodaRow | undefined> {
  const url = `${SODA_BASE}?$limit=1`;
  console.log(`\n[E] GET ${url}`);
  const rows = await get<SodaRow[]>(url);
  if (rows.length === 0) {
    console.log('(no rows)');
    return undefined;
  }
  console.log('Full field dump for first row:');
  for (const [k, v] of Object.entries(rows[0])) {
    console.log(`  ${pad(k, 32)}${formatVal(v)}`);
  }
  return rows[0];
}

async function main() {
  console.log('== SF DataSF Legislation dataset smoke test (cz9b-x8ed) ==');

  const meta = await runStep(
    '[A] /api/views/cz9b-x8ed (schema)',
    probeMeta,
    (m) =>
      m.rowsUpdatedAt
        ? `${m.columns.length} columns, last updated ${new Date(m.rowsUpdatedAt * 1000).toISOString().slice(0, 10)}`
        : `${m.columns.length} columns`,
  );

  if (!meta) {
    finish();
    return;
  }

  const dateField = pickDateField(meta);
  console.log(`\nGuessed date field for ordering: ${dateField ?? '<none>'}`);

  let recent: SodaRow[] | undefined;
  if (dateField) {
    recent = await runStep(
      `[B] /resource by ${dateField} desc`,
      () => probeRecentByField(dateField, 'B'),
      (r) => {
        const top = r[0];
        const v = top ? formatVal(top[dateField]) : '<none>';
        return `top ${dateField}=${v}`;
      },
    );
  } else {
    results.push({ name: '[B] /resource recent', ok: false, note: 'skipped (no date field)' });
  }

  // Try ordering by :id (always present, monotonic)
  await runStep(
    '[C] /resource by :id desc',
    () => probeRecentByField(':id', 'C'),
    (r) => `${r.length} row(s)`,
  );

  // Distinct sponsors (or any "sponsor"/"body"-like column)
  const sponsorCol = meta.columns.find((c) => /sponsor|body|committee/i.test(c.fieldName));
  if (sponsorCol) {
    await runStep(
      `[D] distinct ${sponsorCol.fieldName}`,
      () => probeDistinctValues(sponsorCol.fieldName, 'D'),
      (v) => `${v.length} distinct`,
    );
  } else {
    results.push({ name: '[D] distinct sponsor/body', ok: false, note: 'skipped (no sponsor/body column)' });
  }

  await runStep('[E] sample row dump', probeSampleRow);

  finish(meta, recent);
}

function finish(meta?: ViewMeta, recent?: SodaRow[]) {
  console.log('\n== Summary ==');
  console.log(`${pad('Step', 56)}${pad('Status', 8)}Note`);
  console.log('-'.repeat(140));
  for (const r of results) {
    console.log(`${pad(r.name, 56)}${pad(r.ok ? 'OK' : 'FAIL', 8)}${r.note ?? ''}`);
  }

  console.log('\n== Verdict ==');
  if (!meta) {
    console.log('Schema fetch failed → dataset URL or access policy may have changed.');
    return;
  }
  // Did B return any rows with a recent date?
  const FRESH = '2024-01-01';
  const dateField = pickDateField(meta);
  const freshRow = recent?.find((row) => {
    if (!dateField) return false;
    const v = formatVal(row[dateField]);
    return v && v >= FRESH;
  });
  if (freshRow) {
    console.log(
      `Dataset has post-2024 data (${dateField}=${formatVal(freshRow[dateField as string])}) → DataSF SODA is a viable M14 source. Skip Path 3 if column coverage (file number, sponsor, body, status) is sufficient.`,
    );
  } else if (recent && recent.length > 0) {
    console.log(
      `Dataset is reachable but the newest row predates ${FRESH}. Likely stale like Legistar. Path 3 (sfgov.legistar.com HTML) becomes the recommended M14 source.`,
    );
  } else {
    console.log('Dataset reachable but no rows ordered by a date field. Inspect schema and re-run with explicit field choice.');
  }
}

main();

export {};
