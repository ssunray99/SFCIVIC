// One-shot smoke test for SF's Legistar Web API. Run with: npm run smoke:legistar.
//
// Probes three endpoints in sequence to confirm the API is open and healthy
// before the team commits to a typed client + BOS migration. No DB writes,
// no auth, no env vars.

const BASE = 'https://webapi.legistar.com/v1/sfgov';

type LegistarBody = {
  BodyId: number;
  BodyName: string;
  BodyTypeName: string;
  BodyActiveFlag: number;
};

type EventRow = {
  EventId: number;
  EventDate: string;
  EventLocation: string | null;
  EventInSiteURL: string | null;
};

type EventItem = {
  EventItemId: number;
  EventItemMatterId: number | null;
};

type EventWithItems = EventRow & {
  EventItems?: EventItem[];
};

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

async function step1(): Promise<LegistarBody> {
  console.log(`\n[step 1] GET ${BASE}/Bodies?$top=200`);
  const bodies = await get<LegistarBody[]>(`${BASE}/Bodies?$top=200`);
  const matching = bodies.filter(
    (b) => b.BodyTypeName === 'Primary Legislative Body' || b.BodyTypeName === 'Standing Committee',
  );
  console.log(`Received ${bodies.length} bodies; ${matching.length} match the type filter.\n`);
  console.log(
    `${pad('BodyId', 8)}${pad('BodyTypeName', 28)}${pad('Active', 8)}BodyName`,
  );
  console.log('-'.repeat(80));
  for (const b of matching) {
    console.log(
      `${pad(String(b.BodyId), 8)}${pad(b.BodyTypeName, 28)}${pad(String(b.BodyActiveFlag), 8)}${b.BodyName}`,
    );
  }
  if (matching.length === 0) {
    throw new Error('No Primary Legislative Body or Standing Committee found.');
  }
  return matching[0];
}

async function step2(body: LegistarBody): Promise<EventRow> {
  const filter = `EventBodyId eq ${body.BodyId} and EventDate ge datetime'2025-01-01'`;
  const url =
    `${BASE}/Events?` +
    `$filter=${encodeURIComponent(filter)}` +
    `&$top=5&$orderby=${encodeURIComponent('EventDate desc')}`;
  console.log(`\n[step 2] GET ${url}`);
  console.log(`(probing body "${body.BodyName}" id=${body.BodyId})`);
  const events = await get<EventRow[]>(url);
  console.log(`Received ${events.length} events.\n`);
  console.log(`${pad('EventId', 10)}${pad('EventDate', 26)}${pad('Location', 30)}URL`);
  console.log('-'.repeat(120));
  for (const e of events) {
    console.log(
      `${pad(String(e.EventId), 10)}${pad(e.EventDate ?? '', 26)}${pad((e.EventLocation ?? '').slice(0, 28), 30)}${e.EventInSiteURL ?? ''}`,
    );
  }
  if (events.length === 0) {
    throw new Error(`No events returned for body ${body.BodyId} since 2025-01-01.`);
  }
  return events[0];
}

async function step3(event: EventRow): Promise<void> {
  const url = `${BASE}/Events/${event.EventId}?EventItems=1`;
  console.log(`\n[step 3] GET ${url}`);
  const detail = await get<EventWithItems>(url);
  const items = detail.EventItems ?? [];
  const withMatter = items.filter((i) => i.EventItemMatterId !== null && i.EventItemMatterId !== undefined);
  console.log(`Event ${event.EventId}: ${items.length} EventItems, ${withMatter.length} with non-null EventItemMatterId.`);
}

async function main() {
  let stepNum = 0;
  try {
    stepNum = 1;
    const body = await step1();
    stepNum = 2;
    const event = await step2(body);
    stepNum = 3;
    await step3(event);
    console.log('\n✅ Legistar API healthy');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\n❌ Failed at step ${stepNum}: ${msg}`);
    process.exit(1);
  }
}

main();
