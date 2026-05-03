// One-shot smoke test for SF's Legistar Web API. Run with: npm run smoke:legistar.
//
// Status (as of v3, 2026-05): SF's `/Events` listing endpoint is misconfigured
// server-side and returns HTTP 400 on date-filter queries
// ("'Agenda Draft Status' ... is not setup in settings"). This script probes
// alternative paths to determine what's still salvageable:
//   - Are recent matters reachable at all (or is data frozen pre-2021)?
//   - Does Histories work on real legislation, or only some matter types?
//   - Does Events listing work without a filter?
//   - Does direct /Events/{id} fetch bypass the broken filter?

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

type EventRow = {
  EventId: number;
  EventDate: string;
  EventLocation: string | null;
  EventBodyName?: string | null;
  EventInSiteURL: string | null;
};

type EventItem = {
  EventItemId: number;
  EventItemMatterId: number | null;
};

type EventDetail = EventRow & {
  EventItems?: EventItem[];
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

async function probeBodies(): Promise<void> {
  console.log(`\n[A] GET ${BASE}/Bodies?$top=200`);
  const bodies = await get<LegistarBody[]>(`${BASE}/Bodies?$top=200`);
  console.log(`Received ${bodies.length} bodies.\n`);

  const types = new Map<string, number>();
  for (const b of bodies) types.set(b.BodyTypeName, (types.get(b.BodyTypeName) ?? 0) + 1);

  console.log(`Distinct BodyTypeName values:`);
  for (const [type, count] of [...types.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${pad(String(count), 6)}${type}`);
  }

  const bosFamily = bodies.filter(
    (b) => b.BodyActiveFlag === 1 && /(supervis|committee)/i.test(b.BodyName),
  );
  console.log(`\nBOS-family bodies (active, name contains "supervis" or "committee"): ${bosFamily.length}`);
  for (const b of bosFamily) {
    console.log(`  ${pad(String(b.BodyId), 5)} ${pad(b.BodyTypeName, 28)} ${b.BodyName}`);
  }
}

function printMattersTable(matters: Matter[]): void {
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
}

async function probeMatters(orderBy: string, label: string): Promise<Matter[]> {
  const url = `${BASE}/Matters?$top=5&$orderby=${encodeURIComponent(orderBy)}`;
  console.log(`\n[B/${label}] GET ${url}`);
  const matters = await get<Matter[]>(url);
  console.log(`Received ${matters.length} matter(s).\n`);
  printMattersTable(matters);
  return matters;
}

async function probeMattersSince2025(): Promise<Matter[]> {
  const filter = `MatterIntroDate ge datetime'2025-01-01'`;
  const url = `${BASE}/Matters?$filter=${encodeURIComponent(filter)}&$top=5&$orderby=${encodeURIComponent('MatterIntroDate desc')}`;
  console.log(`\n[B/since-2025] GET ${url}`);
  const matters = await get<Matter[]>(url);
  console.log(`Received ${matters.length} matter(s) introduced since 2025-01-01.\n`);
  if (matters.length > 0) printMattersTable(matters);
  else console.log('  (no recent matters returned by API)');
  return matters;
}

async function probeHistories(matterId: number, matterFile: string): Promise<number | undefined> {
  const url = `${BASE}/Matters/${matterId}/Histories?$top=10&$orderby=${encodeURIComponent('MatterHistoryActionDate desc')}`;
  console.log(`\n[C/${matterFile}] GET ${url}`);
  const hist = await get<MatterHistory[]>(url);
  console.log(`Received ${hist.length} history record(s).\n`);
  if (hist.length > 0) {
    console.log(`${pad('Date', 14)}${pad('EventId', 10)}${pad('Body', 32)}Action`);
    console.log('-'.repeat(120));
    for (const h of hist) {
      console.log(
        `${pad((h.MatterHistoryActionDate ?? '').slice(0, 10), 14)}${pad(String(h.MatterHistoryEventId ?? '-'), 10)}${pad((h.MatterHistoryActionBodyName ?? '').slice(0, 30), 32)}${h.MatterHistoryActionName ?? ''}`,
      );
    }
  }
  const withEvent = hist.find((h) => h.MatterHistoryEventId != null);
  return withEvent?.MatterHistoryEventId ?? undefined;
}

async function probeEventsListing(): Promise<EventRow[]> {
  const url = `${BASE}/Events?$top=5`;
  console.log(`\n[D] GET ${url}`);
  const events = await get<EventRow[]>(url);
  console.log(`Received ${events.length} event(s).\n`);
  console.log(`${pad('EventId', 10)}${pad('EventDate', 26)}${pad('Location', 30)}URL`);
  console.log('-'.repeat(120));
  for (const e of events) {
    console.log(
      `${pad(String(e.EventId), 10)}${pad((e.EventDate ?? '').slice(0, 24), 26)}${pad((e.EventLocation ?? '').slice(0, 28), 30)}${e.EventInSiteURL ?? ''}`,
    );
  }
  return events;
}

async function probeEventDirect(eventId: number): Promise<void> {
  const url = `${BASE}/Events/${eventId}?EventItems=1`;
  console.log(`\n[E] GET ${url}`);
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
  console.log('== SF Legistar API smoke test (v3) ==');

  await runStep('[A] /Bodies', probeBodies);

  const byIntro = await runStep(
    '[B1] /Matters by IntroDate desc',
    () => probeMatters('MatterIntroDate desc', 'IntroDate-desc'),
    (m) => (m[0] ? `newest IntroDate=${m[0].MatterIntroDate?.slice(0, 10) ?? '?'}` : 'empty'),
  );

  const byId = await runStep(
    '[B2] /Matters by MatterId desc',
    () => probeMatters('MatterId desc', 'MatterId-desc'),
    (m) =>
      m[0]
        ? `newest MatterId=${m[0].MatterId} IntroDate=${m[0].MatterIntroDate?.slice(0, 10) ?? '?'}`
        : 'empty',
  );

  const since2025 = await runStep(
    '[B3] /Matters since 2025',
    probeMattersSince2025,
    (m) => `${m.length} matter(s) post-2025`,
  );

  // [C] Try Histories on up to 3 matters in priority order:
  //   1. Newest by MatterId (likely real ordinance/resolution)
  //   2. Newest by IntroDate (might be Communication/Charter Amendment)
  //   3. A real ordinance from B1 (Type contains "Ordinance" or "Resolution")
  // Stop on first successful Histories call that returns an EventId.
  const seen = new Set<number>();
  const candidates: Matter[] = [];
  const addUnique = (list: Matter[] | undefined) => {
    for (const m of list ?? []) {
      if (!seen.has(m.MatterId)) {
        seen.add(m.MatterId);
        candidates.push(m);
      }
    }
  };
  addUnique(byId);
  addUnique(since2025);
  addUnique(byIntro);
  // Prefer real legislation if present
  candidates.sort((a, b) => {
    const aReal = /(ordinance|resolution)/i.test(a.MatterTypeName ?? '');
    const bReal = /(ordinance|resolution)/i.test(b.MatterTypeName ?? '');
    if (aReal !== bReal) return aReal ? -1 : 1;
    return 0;
  });

  let firstEventId: number | undefined;
  for (const m of candidates.slice(0, 3)) {
    const eventId = await runStep(
      `[C] /Matters/${m.MatterId}/Histories (${m.MatterFile} ${m.MatterTypeName ?? '?'})`,
      () => probeHistories(m.MatterId, m.MatterFile),
      (eid) => (eid ? `EventId ${eid} discovered` : 'no EventId in history records'),
    );
    if (eventId !== undefined) {
      firstEventId = eventId;
      break;
    }
  }

  await runStep('[D] /Events listing (no filter)', probeEventsListing, (ev) => `${ev.length} event(s)`);

  if (firstEventId) {
    await runStep(`[E] /Events/${firstEventId} direct`, () => probeEventDirect(firstEventId!));
  } else {
    results.push({ name: '[E] /Events/{id} direct', ok: false, note: 'skipped (no EventId from any C probe)' });
  }

  console.log('\n== Summary ==');
  console.log(`${pad('Step', 56)}${pad('Status', 8)}Note`);
  console.log('-'.repeat(140));
  for (const r of results) {
    console.log(`${pad(r.name, 56)}${pad(r.ok ? 'OK' : 'FAIL', 8)}${r.note ?? ''}`);
  }

  console.log('\n== Verdict ==');
  const okSteps = new Set(results.filter((r) => r.ok).map((r) => r.name.split(' ')[0]));
  if (okSteps.has('[D]') || okSteps.has('[E]')) {
    console.log('Events are reachable somehow → API ingest path is viable.');
  } else if ([...okSteps].some((s) => s.startsWith('[C]'))) {
    console.log('Histories works but Events do not → can build Matters-only ingest, no agenda items.');
  } else {
    console.log('Only Bodies and/or Matters work → API is not viable for ingest. Plan to scrape sfgov.legistar.com HTML instead.');
  }
}

main();
