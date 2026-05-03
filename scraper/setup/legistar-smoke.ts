// One-shot smoke test for SF's Legistar Web API. Run with: npm run smoke:legistar.
//
// SF's `/Events` listing endpoint is misconfigured server-side (HTTP 400 on
// any query — "'Agenda Draft Status' ... is not setup in settings").
// This v2 probes whether enough of the rest of the API works to build a
// Matters-first ingest path that bypasses the broken Events listing.

const BASE = 'https://webapi.legistar.com/v1/sfgov';

type LegistarBody = {
  BodyId: number;
  BodyName: string;
  BodyTypeName: string;
  BodyActiveFlag: number;
};

type Matter = {
  MatterId: number;
  MatterFile: string;
  MatterName: string | null;
  MatterTitle: string | null;
  MatterTypeName: string | null;
  MatterStatusName: string | null;
  MatterIntroDate: string | null;
  MatterBodyId: number | null;
};

type MatterHistory = {
  MatterHistoryId: number;
  MatterHistoryActionDate: string | null;
  MatterHistoryActionName: string | null;
  MatterHistoryActionBodyName: string | null;
  MatterHistoryEventId: number | null;
};

type EventItem = {
  EventItemId: number;
  EventItemMatterId: number | null;
};

type EventDetail = {
  EventId: number;
  EventDate: string;
  EventLocation: string | null;
  EventBodyName: string | null;
  EventInSiteURL: string | null;
  EventItems?: EventItem[];
};

type StepResult = { name: string; ok: boolean; note?: string };

async function get<T>(url: string): Promise<T> {
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '<unreadable>');
    throw new Error(`HTTP ${resp.status} ${resp.statusText} for ${url}\n${body.slice(0, 500)}`);
  }
  return (await resp.json()) as T;
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function shortErr(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split('\n')[0].slice(0, 200);
}

async function probeBodies(): Promise<void> {
  console.log(`\n[A] GET ${BASE}/Bodies?$top=200`);
  const bodies = await get<LegistarBody[]>(`${BASE}/Bodies?$top=200`);
  console.log(`Received ${bodies.length} bodies.\n`);

  const types = new Map<string, number>();
  for (const b of bodies) types.set(b.BodyTypeName, (types.get(b.BodyTypeName) ?? 0) + 1);

  console.log(`Distinct BodyTypeName values (sorted by count):`);
  console.log(`${pad('Count', 8)}BodyTypeName`);
  console.log('-'.repeat(60));
  for (const [type, count] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${pad(String(count), 8)}${type}`);
  }

  const bosFamily = bodies.filter(
    (b) => b.BodyActiveFlag === 1 && /(supervis|committee)/i.test(b.BodyName),
  );
  console.log(`\n${bosFamily.length} active bodies whose name contains "supervis" or "committee":`);
  console.log(`${pad('Id', 6)}${pad('TypeName', 32)}BodyName`);
  console.log('-'.repeat(90));
  for (const b of bosFamily) {
    console.log(`${pad(String(b.BodyId), 6)}${pad(b.BodyTypeName, 32)}${b.BodyName}`);
  }
}

async function probeMatters(): Promise<Matter | undefined> {
  const url = `${BASE}/Matters?$top=5&$orderby=${encodeURIComponent('MatterIntroDate desc')}`;
  console.log(`\n[B] GET ${url}`);
  const matters = await get<Matter[]>(url);
  console.log(`Received ${matters.length} matter(s).\n`);
  console.log(
    `${pad('MatterId', 10)}${pad('File', 12)}${pad('Type', 18)}${pad('Status', 24)}${pad('Intro', 12)}Title`,
  );
  console.log('-'.repeat(140));
  for (const m of matters) {
    const title = ((m.MatterTitle ?? m.MatterName) ?? '').replace(/\s+/g, ' ').slice(0, 60);
    console.log(
      `${pad(String(m.MatterId), 10)}${pad(m.MatterFile ?? '', 12)}${pad((m.MatterTypeName ?? '').slice(0, 16), 18)}${pad((m.MatterStatusName ?? '').slice(0, 22), 24)}${pad((m.MatterIntroDate ?? '').slice(0, 10), 12)}${title}`,
    );
  }
  return matters[0];
}

async function probeHistories(matterId: number): Promise<number | undefined> {
  const url = `${BASE}/Matters/${matterId}/Histories?$top=10&$orderby=${encodeURIComponent('MatterHistoryActionDate desc')}`;
  console.log(`\n[C] GET ${url}`);
  const hist = await get<MatterHistory[]>(url);
  console.log(`Received ${hist.length} history record(s).\n`);
  console.log(`${pad('Date', 14)}${pad('EventId', 10)}${pad('Body', 32)}Action`);
  console.log('-'.repeat(120));
  for (const h of hist) {
    console.log(
      `${pad((h.MatterHistoryActionDate ?? '').slice(0, 10), 14)}${pad(String(h.MatterHistoryEventId ?? '-'), 10)}${pad((h.MatterHistoryActionBodyName ?? '').slice(0, 30), 32)}${h.MatterHistoryActionName ?? ''}`,
    );
  }
  const withEvent = hist.find((h) => h.MatterHistoryEventId != null);
  return withEvent?.MatterHistoryEventId ?? undefined;
}

async function probeEvent(eventId: number): Promise<void> {
  const url = `${BASE}/Events/${eventId}?EventItems=1`;
  console.log(`\n[D] GET ${url}`);
  const detail = await get<EventDetail>(url);
  const items = detail.EventItems ?? [];
  const withMatter = items.filter((i) => i.EventItemMatterId != null);
  console.log(
    `Event ${detail.EventId}: date=${(detail.EventDate ?? '').slice(0, 10) || '?'}, body=${detail.EventBodyName ?? '?'}`,
  );
  console.log(`InSiteURL: ${detail.EventInSiteURL ?? '<none>'}`);
  console.log(`EventItems: ${items.length} total, ${withMatter.length} with non-null EventItemMatterId.`);
}

async function main() {
  console.log('== SF Legistar API smoke test (v2) ==');
  const results: StepResult[] = [];

  try {
    await probeBodies();
    results.push({ name: '[A] /Bodies', ok: true });
  } catch (err) {
    results.push({ name: '[A] /Bodies', ok: false, note: shortErr(err) });
    console.error(`\nStep A failed: ${shortErr(err)}`);
  }

  let firstMatter: Matter | undefined;
  try {
    firstMatter = await probeMatters();
    results.push({
      name: '[B] /Matters',
      ok: true,
      note: firstMatter ? `first MatterId=${firstMatter.MatterId} (file ${firstMatter.MatterFile})` : 'empty result',
    });
  } catch (err) {
    results.push({ name: '[B] /Matters', ok: false, note: shortErr(err) });
    console.error(`\nStep B failed: ${shortErr(err)}`);
  }

  let firstEventId: number | undefined;
  if (firstMatter) {
    try {
      firstEventId = await probeHistories(firstMatter.MatterId);
      results.push({
        name: '[C] /Matters/{id}/Histories',
        ok: true,
        note: firstEventId ? `EventId ${firstEventId} discovered` : 'no EventId in any history record',
      });
    } catch (err) {
      results.push({ name: '[C] /Matters/{id}/Histories', ok: false, note: shortErr(err) });
      console.error(`\nStep C failed: ${shortErr(err)}`);
    }
  } else {
    results.push({ name: '[C] /Matters/{id}/Histories', ok: false, note: 'skipped (no MatterId from B)' });
  }

  if (firstEventId) {
    try {
      await probeEvent(firstEventId);
      results.push({ name: '[D] /Events/{id} direct', ok: true });
    } catch (err) {
      results.push({ name: '[D] /Events/{id} direct', ok: false, note: shortErr(err) });
      console.error(`\nStep D failed: ${shortErr(err)}`);
    }
  } else {
    results.push({ name: '[D] /Events/{id} direct', ok: false, note: 'skipped (no EventId from C)' });
  }

  console.log('\n== Summary ==');
  console.log(`${pad('Step', 32)}${pad('Status', 8)}Note`);
  console.log('-'.repeat(100));
  for (const r of results) {
    console.log(`${pad(r.name, 32)}${pad(r.ok ? 'OK' : 'FAIL', 8)}${r.note ?? ''}`);
  }

  const allOk = results.every((r) => r.ok);
  console.log(allOk ? '\nAll probes succeeded.' : '\nSome probes failed or were skipped — see notes.');
}

main();
