# CLAUDE.md

Guidance for Claude working in this repo. Read this before making changes.

## What this is

**SF Civic Tracker** — a Next.js + Supabase site that aggregates SF civic
activity from multiple sources (Planning Commission, Historic Preservation
Commission, Board of Supervisors + standing committees, SFMTA Board,
public hearing notices), runs each meeting's agenda through Claude
Haiku 4.5 to extract structured items, and lets visitors filter by
neighborhood, district, or topic and follow individual pieces of
legislation across committees.

This is a learning project. The full plan lives at
`/root/.claude/plans/i-want-to-build-silly-goblet.md` (also referenced from
the README). README lists milestones by name; this file is the source of
truth for progress and architectural detail.

## Status

**M12 complete.** SFMTA Board of Directors scraper added (`sfmta.com`
Playwright — BoardDocs blocks automated fetches). All sources are live:
Planning, HPC, BOS Full Board + 5 committees, SFMTA Board, and public
hearing notices. **M13 complete.** Browse-by-neighborhood (`/neighborhoods/[slug]`)
and browse-by-topic (`/topics/[slug]`) pages with static pre-generation.
**M15 (analytics) complete.** `/analytics` page shows year-to-date item
counts by neighborhood, topic, district, and source; cross-committee matter
tracking; scraper health table. **M14 complete** — `legislation` table
(migration 0004), Legistar HTML enrichment scraper
(`scraper/setup/legistar-html-enrich.ts`), and `/projects/[fileNumber]` page
are all live; 190 BOS matters enriched from `sfgov.legistar.com`. Re-run
`npm run enrich:legislation` periodically as new file numbers accumulate.
Supervisor vote/attendance accountability views require a data source not
yet identified.

| M   | Goal                                                              | State |
| --- | ----------------------------------------------------------------- | ----- |
| M1  | Skeleton, schema, shadcn walkthrough                              | ✅    |
| M2  | Planning Commission scraper end-to-end (no LLM)                   | ✅    |
| M3  | LLM extraction with Claude Haiku 4.5                              | ✅    |
| M4  | BOS + hearings sources                                            | ✅    |
| M5  | Frontend list page                                                | ✅    |
| M6  | Filters & search                                                  | ✅    |
| M7  | Detail pages + about                                              | ✅    |
| M8  | GitHub Actions cron                                               | ✅    |
| M9  | Vercel deploy                                                     | ✅    |
| M10 | Address geocoding + implicit neighborhoods + action layer         | ✅    |
| M11 | Address search UI (foreground for users)                          | ✅    |
| M12 | Source expansion (HPC ✅, BOS committees ✅, SFMTA ✅)             | ✅    |
| M13 | Browse-by-neighborhood / browse-by-topic pages                    | ✅    |
| M14 | Project tracking (legislation table + /projects/[id] + enrichment) | ✅    |
| M15 | Analytics ✅; supervisor vote/accountability needs data source    | 🔄    |

Architectural detail for M11–M15 lives below under "Planned architecture."

## About shadcn/ui

shadcn/ui is **not** a library you `npm install`. It's a CLI that *copies*
React + Tailwind + Radix component source code into your repo, where you own
and edit it directly. Think of it as "scaffolding" rather than a dependency.

**Why this matters:**

- You can customize any component by editing `src/components/ui/<name>.tsx`
  directly. No library version to fight.
- The scaffolding is small and tree-shakable — only the components you add
  ship with the app.
- The styling primitives (`cn` helper, CSS variables, Tailwind theme tokens)
  are standardized across all shadcn components.

**The deps are already installed** — `clsx`, `tailwind-merge`,
`class-variance-authority`, `lucide-react`. The `cn` helper lives at
`src/lib/utils.ts`.

**To add components in your local dev environment:**

```bash
npx shadcn@latest init           # one-time setup of components.json + theme
npx shadcn@latest add button badge card input select command popover
```

The CLI fetches templates from <https://ui.shadcn.com> and writes them into
`src/components/ui/`. (The current editorial redesign uses hand-built
primitives in `src/components/primitives.tsx` rather than shadcn templates;
this section stays for any future component additions that want the
standard scaffolding.)

## Stack

- **Frontend:** Next.js 16 (App Router, RSC) + Tailwind v4. Server components
  do all data fetching via the Supabase anon key; URL search params drive
  filters. No client-side data fetching.
- **DB:** Supabase Postgres. RLS enabled with public-select policies; writes
  go through the service-role client in the scraper. Generated types live at
  `src/lib/database.types.ts` (regenerate with `npm run db:types`).
- **Storage:** Supabase Storage bucket `raw` holds archival event-page HTML
  per meeting (path `raw/{source_id}/{yyyy}/{mm}/{content_hash}.html`).
- **Scraper:** Playwright Chromium + tsx, scheduled by GitHub Actions.
  All sources go through the same path — visit a grid, fetch agenda
  PDFs, pass text to `extractAgendaItems()`, persist via
  `lib/extract-pipeline.ts`. Sources: Planning Commission, HPC, BOS Full
  Board + 5 standing committees (Land Use, Budget, Rules, Public Safety,
  GAO), SFMTA Board of Directors, and public hearing notices. BOS-family
  scrapers share `lib/bos-shared.ts` and scrape `sf.gov`. SFMTA scrapes
  `sfmta.com` directly (BoardDocs blocks automated fetches). No Legistar
  API (non-viable for SF; see below).
- **LLM:** `claude-haiku-4-5-20251001` via `@anthropic-ai/sdk`. Tool-use with
  forced `record_agenda_items` tool for structured output. Prompt caching on
  system prompt + tool schema.

## Repo layout (the parts you'll touch)

```
scraper/
  run.ts                       CLI entrypoint (planning|bos|bos-*|hpc|extract)
  sources/planning.ts          SF Planning Commission scraper
  sources/bos.ts               SF Board of Supervisors — Full Board (thin caller)
  sources/bos-land-use.ts      BOS Land Use and Transportation Committee
  sources/bos-budget.ts        BOS Budget and Appropriations Committee
  sources/bos-rules.ts         BOS Rules Committee
  sources/bos-public-safety.ts BOS Public Safety and Neighborhood Services Committee
  sources/bos-gao.ts           BOS Government Audit and Oversight Committee
  sources/hpc.ts               SF Historic Preservation Commission scraper
  lib/bos-shared.ts            Shared BOS scraping logic — all bos-* scrapers
                               are thin callers into scrapeBosMeetings(opts).
                               Pagination stops on onPage===0 (not added===0)
                               so infrequent committees aren't under-collected.
                               Legistar View.ashx minutes links are routed
                               through fetchBytes, not page.goto.
  lib/playwright.ts            Browser bootstrap + fetchBytes()
  lib/pdf.ts                   pdf-parse wrapper (PINNED v1.1.1)
  lib/storage.ts               Supabase Storage upload helper
  lib/hash.ts                  sha256 helper
  lib/llm.ts                   extractAgendaItems() — Anthropic call
  lib/extract-pipeline.ts      persistExtractedItems() — shared post-LLM
                               pipeline (geocode → polygon-resolve → insert
                               agenda_items + agenda_item_locations)
  lib/geocode.ts               Nominatim geocoder (1.1s throttle, SF bbox)
                               with cache-first lookup against address_cache
  lib/geo.ts                   Hand-rolled point-in-polygon (handles
                               MultiPolygons + holes), haversine, bbox.
                               Uses scraper/data/{neighborhoods,districts}.geojson.
                               DATASF_TO_ENUM maps DataSF analysis-neighborhood
                               names to our closed enum.
                               Also imported by src/app/api/locate/route.ts.
  data/neighborhoods.geojson   DataSF Analysis Neighborhoods (4x4: ajp5-b2md)
  data/districts.geojson       DataSF Current Supervisor Districts (4x4: keex-zmn4)
  setup/fetch-geo.ts           One-shot polygon downloader; npm run fetch:geo
  prompts/extract.ts           SYSTEM_PROMPT + TOOL_SCHEMA + PROMPT_VERSION

src/
  app/page.tsx                 RSC homepage — Upcoming + Past sections
  app/api/locate/route.ts      GET /api/locate?address= — geocodes address via
                               Nominatim, resolves to neighborhood + district
                               via scraper/lib/geo.ts. No service-role key
                               needed (no cache writes from this path).
  app/layout.tsx               Root layout
  components/AddressSearch.tsx Client component — address input, calls
                               /api/locate, sets ?neighborhood= and ?district=
                               URL params (both when both resolve).
  components/FilterBar.tsx     Neighborhood/district/topic/source dropdowns
                               + keyword search; reads/writes URL params.
  components/MeetingCard.tsx   Meeting + its items (passes meetingUpcoming
                               down so ItemCard can hide stale CTAs)
  components/ItemCard.tsx      Single agenda item (with badges + amber
                               "Take action" CTA when action fields present)
  components/Badge.tsx         Tailwind-only badge primitive
  lib/constants.ts             NEIGHBORHOODS, TOPICS, DISTRICTS, SOURCES
                               (single source of truth — used by LLM prompt
                               AND filter UI; do NOT duplicate elsewhere)
  lib/database.types.ts        Generated from Supabase schema
  lib/supabase/server.ts       Anon client for RSC reads
  lib/supabase/admin.ts        Service-role client for scraper writes
  lib/utils.ts                 cn() helper

supabase/
  migrations/0001_init.sql                   Initial schema (4 tables, RLS, GIN)
  migrations/0002_locations_and_actions.sql  Adds agenda_item_locations,
                                             address_cache, and 4 action-layer
                                             columns on agenda_items
  seed.sql                                   sources rows
```

## Critical conventions

### Closed enums live in one place

`NEIGHBORHOODS`, `TOPICS`, `DISTRICTS`, and `SOURCES` are declared once in
`src/lib/constants.ts` and imported into both:
- the LLM prompt (`scraper/prompts/extract.ts`) and validator (`scraper/lib/llm.ts`)
- the frontend filter UI (and eventually the search query builder)

When the model returns a tag, `filterEnum()` in `scraper/lib/llm.ts` drops
anything not in the enum. Don't add a tag value anywhere else.

### Idempotency = sha256(event-page HTML)

The scraper hashes the **event page HTML** (not the agenda PDF, not the
packet HTML) and writes it as `meetings.content_hash`. Same hash → skip.
Re-scraping picks up new meetings but doesn't re-extract existing ones —
to force a re-extract, delete the row and re-scrape, or call
`extractExisting()` (only useful when storage has full text, which it
doesn't for packet/PDF cases).

### Scraping flow (Planning Commission)

1. Visit `/hearings-cpc-grid`. Use Playwright to switch the timing dropdown
   from "Upcoming Hearings" to "- Any -" and the sort to Descending. Click
   APPLY. Capture the resulting URL as `baseGridUrl`.
2. Paginate from `baseGridUrl` (each page appends `&page=N` to the
   **base** — never `page.url()`, that accumulates params). Stop when the
   current page contains no `Month YYYY` headers from `SCRAPE_FROM`'s year.
3. For each event URL: visit, extract `meeting_date`, look for AGENDA,
   SUPPORTING, MINUTES button links by visible text.
4. **LLM input strategy** (in `scraper/sources/planning.ts`):
   - **Past** meetings (`meeting_date < today`): AGENDA + MINUTES only.
     Skip SUPPORTING — the staff reports are bulky and largely redundant
     with what minutes already capture.
   - **Future** meetings: AGENDA if posted (canonical), else SUPPORTING
     (packet) for enrichment until the agenda PDF goes up ~6 days pre-hearing.
5. **agenda_url for the UI**:
   - Past: link to event page (where the user can navigate among the three
     buttons themselves).
   - Future: AGENDA → SUPPORTING → event-URL fallback chain.
6. `gatherTextFromLink()` handles both PDF URLs (downloads + parses directly)
   and resource pages (visits, lists `.pdf` links, downloads each, concatenates
   text capped at 20k chars/PDF and 80k chars/resource).
7. `SCRAPE_FROM` constant = `${current_year}-01-01`. Per-event date guard
   skips anything before that.

### pdf-parse is pinned to v1.1.1

`package.json` pins `"pdf-parse": "1.1.1"` (no caret) because:
- v1 has the stable default-callable export `pdfParse(buf) → { text }`
  which matches `@types/pdf-parse@^1.1.5`.
- v2 ships a class-based `PDFParse` API with no matching types — broken.

If `pdf-parse` ever drifts back to v2, every PDF throws
`pdfParse is not a function` at module load. Don't bump it without also
fixing the wrapper in `scraper/lib/pdf.ts`.

The package emits `Warning: TT: undefined function: 21/32` lines on stderr
for some SF Planning PDFs — those are pdf.js font-glyph warnings; text
still extracts fine. Cosmetic, ignore them.

### `meetings` schema constraints

- `unique (source_id, external_id)` — re-running the scraper for an
  already-stored event gets `23505` from the insert; we log `duplicate
  insert skipped` and move on.
- `unique (source_id, content_hash)` — same hash never inserted twice.

### Frontend split: Upcoming vs Past

`src/app/page.tsx` splits meetings around `today`:
- Upcoming: `meeting_date >= today`, sorted ascending (soonest first).
- Past: `meeting_date < today`, sorted descending (most recent first).
Default limits are 50 / 25.

Civic UX: foreground what's about to happen, then show recent history.

### Address geocoding pipeline (M10)

`scraper/lib/extract-pipeline.ts` is the shared post-LLM step both source
scrapers call. For each item the LLM emits:

1. Geocode each `addresses[]` entry via `geocodeAddress()` — cache-first
   lookup against `address_cache`, then Nominatim with SF bounding box and
   1.1s throttle. Negative results are cached too so we don't retry forever.
2. For each successful geocode, resolve the (lat, lng) to a closed-enum
   neighborhood via `neighborhoodFromPoint()` and a supervisor district 1–11
   via `districtFromPoint()`. Polygons live in `scraper/data/*.geojson`.
3. Insert `agenda_items` rows. The polygon-derived neighborhoods are
   **unioned** into `agenda_items.neighborhoods` (so the existing GIN index
   + filter UI keep working with no change), and `district` falls back to
   the polygon answer when the LLM left it null.
4. Insert one `agenda_item_locations` row per address (raw, lat/lng,
   resolved neighborhood, resolved district, geocode_source).

`DATASF_TO_ENUM` in `geo.ts` maps DataSF Analysis Neighborhood names to our
31-entry enum. DataSF names with no enum equivalent (Outer Mission, Presidio
Heights, etc.) intentionally return null neighborhood — district resolution
still works. Don't add new neighborhood values without updating both the
enum in `src/lib/constants.ts` AND the mapping in `geo.ts`.

The geo helpers and polygon assets live under `scraper/` rather than `src/`
because (a) they're shared between scraper and API routes and (b) the
.geojson files are 1.4MB + 460KB, which we don't want bundled into the
Next.js client. `src/app/api/locate/route.ts` imports from
`scraper/lib/geo.ts` directly (server-side only). `next.config.ts` sets
`outputFileTracingIncludes` for `/api/locate` so the geojson files are
included in the Vercel serverless bundle.

### Action layer (M10)

`agenda_items` has four optional fields populated by the LLM tool schema
when the source mentions them: `comment_deadline` (date), `comment_email`,
`comment_portal_url`, `in_person_slot` (free-form datetime+location).

`ItemCard` renders an amber "Take action by {date}" CTA when:
- the meeting is upcoming OR `comment_deadline` is in the future, AND
- at least one of the four fields is non-null

The CTA shows `mailto:` for `comment_email`, an external link for
`comment_portal_url`, and the raw text for `in_person_slot`. `MeetingCard`
computes `meetingUpcoming` once and passes it down to all child `ItemCard`s.

### Address search UI (M11)

`src/app/api/locate/route.ts` — GET handler. Accepts `?address=`, calls
Nominatim with `", San Francisco, CA"` appended and an SF bounding box
filter, then resolves the coordinates to a neighborhood and district via
`scraper/lib/geo.ts`. Returns `{ lat, lng, neighborhood, district }`.
Does **not** use the `address_cache` table (no service-role key needed
in the Next.js runtime; one-off lookups don't need caching).

`src/components/AddressSearch.tsx` — client component above FilterBar.
On submit: calls `/api/locate`, then sets **both** `?neighborhood=` and
`?district=` URL params when both resolve (one or the other when only
one resolves). The existing `applyItemFilters` in `page.tsx` handles the
rest with no changes.

Neighborhood assignments follow DataSF Analysis Neighborhood polygons,
which don't always match popular perception (e.g. City Hall → Tenderloin,
lower Nob Hill → Financial District). This is correct and intentional —
the same polygons drive the scraper-side geocoding pipeline, so results
are internally consistent.

### Anthropic SDK call

In `scraper/lib/llm.ts`:
- `system` is an array of one text block with `cache_control: { type: 'ephemeral' }`.
- `tools` is an array of one tool (`record_agenda_items`) also marked
  ephemeral. Both cache markers are required so prompt caching covers both
  blocks across meetings in one run.
- `tool_choice: { type: 'tool', name: TOOL_NAME }` forces structured output.
- The user message slices `text` to 50k chars defensively (the gathering
  step in planning.ts already caps at 100k–120k, but never trust the caller).
- Errors are caught — `extractAgendaItems` returns `{ items: [] }` rather
  than throwing, so one bad meeting can't kill a whole scrape run.

## Common commands

```bash
npm run dev                    # Next.js dev server on :3000
npm run typecheck              # tsc --noEmit
npm run lint                   # eslint
npm run scrape:planning        # full Planning Commission scrape
npm run scrape:bos             # BOS Full Board scrape
npm run scrape:bos-land-use    # Land Use and Transportation Committee
npm run scrape:bos-budget      # Budget and Appropriations Committee
npm run scrape:bos-rules       # Rules Committee
npm run scrape:bos-public-safety  # Public Safety Committee
npm run scrape:bos-gao         # Government Audit and Oversight Committee
npm run scrape:hpc             # Historic Preservation Commission
npm run extract                # re-run LLM on stored meetings (limited utility —
                               # storage holds event HTML, not packet PDF text)
npm run db:types               # regenerate src/lib/database.types.ts from cloud
npm run db:push                # apply migrations to linked cloud project
npm run fetch:geo              # re-download SF neighborhood + district polygons
                               # from DataSF into scraper/data/
npm run enrich:legislation     # populate legislation table from sfgov.legistar.com
                               # HTML (keyed on matter_file_number from agenda_items)
```

## Planned architecture (M11–M15)

This section captures the architectural decisions for upcoming milestones
so future work doesn't have to re-derive them. Update as milestones land
or as decisions change.

### Source taxonomy: two ingestion paths

Sources fall into two patterns. Both end at the same persistence step
(`lib/extract-pipeline.ts`), but the front half differs:

- **HTML/PDF scrape** (Playwright + LLM): Planning Commission, public
  hearing notices, future HPC + SFMTA scrapers, plus any long-tail
  commission additions (Recreation & Park, Port, Entertainment, Police,
  Board of Appeals). Each is a `scraper/sources/<name>.ts` that walks a
  grid, fetches agenda PDFs, and passes text to `extractAgendaItems()`.
  HPC clones `planning.ts` directly — same site, same shape.
- ~~**Legistar Web API**~~ — **dropped after smoke test (M12 step 2).**
  SF's Legistar instance has frozen data (2020), broken Histories, and
  broken Events listing. All BOS-family sources fall into the
  Playwright path instead. `scraper/lib/bos-shared.ts` is the shared
  module; `bos.ts` (Full Board) and five committee scrapers (Land Use,
  Budget, Rules, Public Safety, GAO) are thin callers. All ship as of
  M12. SFMTA Board (BoardDocs) is the remaining M12 item.

### M14: project tracking (PARTIALLY UNBLOCKED — file # extracted, enrichment pending)

Today `agenda_items` are island-meetings — the same ordinance appearing
on Land Use Committee 4/15 and Full Board 4/29 used to be two unrelated
rows. As of prompt v3 the LLM now extracts `matter_file_number` from
each item (BOS agendas print 6-digit file numbers like "250604"). Those
two rows now carry the same `matter_file_number`, giving us a stable
cross-committee join key with zero new scraping infrastructure.

What's still missing for the full M14 surface (`/projects/[id]` page
with sponsors, status, history timeline):

- **`sfgov.legistar.com` HTML enrichment scraper.** Take
  `select distinct matter_file_number from agenda_items`, fetch each
  matter's detail page from Legistar HTML (the website is current; only
  the v3 API is broken), parse status/sponsor/history.
- **`legislation` table.** Keyed on `matter_file_number`, populated by
  the enrichment scraper, FK target for `agenda_items.matter_file_number`.
- **`/projects/[fileNumber]` RSC page.** Joins the two tables.

Discovery (which file numbers exist) comes from the agenda PDFs we
already scrape. Enrichment (what each file number means) is the
remaining work. Architecture is "agenda PDFs discover, Legistar HTML
enriches" — not the original plan of "Legistar API as primary source."

Sources considered and rejected during M14 design:

- **Legistar v3 REST API** — dropped. Smoke test confirmed `/Matters`
  frozen at 2020-09-17 (max MatterId=34112), `/Histories` HTTP 500,
  `/Events` HTTP 400. Extended F/G probes (LastModifiedUtc desc,
  AgendaDate desc, direct ID-fetch at 40000/60000/100000) ruled out
  any salvage — the dataset is genuinely frozen, not just hidden behind
  the wrong ordering. See `scraper/setup/legistar-smoke.ts`.
- **DataSF SODA Legislation dataset (`cz9b-x8ed`)** — dropped. Last
  updated 2013-10-30; metadata returns 0 columns; data endpoint 403.
  Catalog search for SF BOS legislation found no current alternative.
  See `scraper/setup/datasf-legislation-smoke.ts`.

### Source platforms (which site each source lives on)

All scraping is Playwright/HTML; there is no API path. Platforms:

- **`sfplanning.org`** — Planning Commission, Historic Preservation
  Commission, public hearing notices.
- **`sf.gov`** — Board of Supervisors Full Board + all five standing
  committee scrapers. The committees' meeting pages live under the same
  sf.gov BOS events listing, filtered by title pattern in bos-shared.ts.
  Minutes for some older meetings link out to `sfgov.legistar.com/View.ashx`
  (direct PDF downloads); those are handled by fetchBytes, not page.goto.
- **`go.boarddocs.com/ca/sfmta`** (BoardDocs) — SFMTA Board.

### M12 substep order

Cheapest / highest-confidence first so novel platforms don't block easy
wins:

1. ✅ **HPC scraper** — cloned `planning.ts`, parameterized source slug + URL.
2. ✅ **Legistar client smoke test** — **COMPLETE. Verdict: API not viable.**
   See "Legistar API status (M12 step 2 — closed)" below for full findings.
   Steps 3–4 below were replaced by the Playwright path.
3. ~~`scraper/lib/legistar.ts`~~ — **DROPPED.**
4. ~~`scraper/sources/bos-legistar.ts`~~ — **DROPPED.**
5. ✅ **Per-committee BOS scrapers** — `bos-shared.ts` shared module +
   thin callers for Land Use, Budget, Rules, Public Safety, GAO. All
   scrape `sf.gov` BOS events listing, filter by title pattern, and
   write to separate `source_id`s. Two bugs found and fixed during
   initial run: Legistar `View.ashx` minutes links (use fetchBytes, not
   page.goto) and early pagination stop on `added===0` (changed to
   `onPage===0` so infrequent committees paginate fully).
6. **SFMTA Board scraper** ✅ — `scraper/sources/sfmta.ts` scrapes
   `sfmta.com/meetings-events`. BoardDocs (`go.boarddocs.com/ca/sfmta`)
   returns 403 to automated fetches; `sfmta.com` is the accessible source.

### Legistar API status (M12 step 2 — closed: API not viable)

v3 smoke test (2026-05-02) resolved all open questions. SF's Legistar
deployment is not viable for ingest. The typed client and
bos-legistar.ts scraper are dropped; M12 falls back to Playwright HTML
scraping for BOS and its standing committees.

**Confirmed working ✅**

- `/Bodies` — 151 bodies. BOS-family: 9 active bodies — Board of
  Supervisors (id 1, `Primary Legislative Body`) and 8 bodies under
  `BodyTypeName: 'Committee'`: Rules (6), Budget and Finance (119),
  Government Audit and Oversight (121), Budget and Finance
  Sub-Committee (130), Public Safety and Neighborhood Services (168),
  Land Use and Transportation (169), Budget and Finance Federal Select
  (178), Joint Land Use/Airport (183). Note: `'Standing Committee'`
  does not exist in SF's deployment — `'Committee'` is the right filter.
- `/Matters` endpoint reachable; field shape matches documented schema.

**Confirmed broken / unusable ❌**

- **`/Matters` data is frozen at 2020.** Both `$orderby=MatterIntroDate
  desc` and `$orderby=MatterId desc` return max MatterId=34112 with
  IntroDate=2020-09-17. An explicit `$filter=MatterIntroDate ge
  datetime'2025-01-01'` returns 0 results. SF has not exposed post-2020
  matters via the public API. M14 (project tracking via Legistar
  Matters) is **blocked** unless a different source is found.
- **`/Matters/{id}/Histories` — HTTP 500 endpoint-wide.** Tried 3
  different matters (Ordinances + Resolution, not just Communications).
  All returned `System.Reflection.TargetInvocationException` — a
  server-side bug, not a data issue. EventId discovery through
  Histories is not possible.
- **`/Events` listing — HTTP 400 on every query including bare
  `?$top=5` with no filter.** The broken `Agenda Draft Status` setting
  fires regardless of filter syntax. Confirmed the 2022 blog report;
  cannot be worked around client-side.
- **`/Events/{id}` direct fetch** — untestable (no EventId discoverable
  via Histories). Moot given `/Events` listing is also broken for bare
  queries.

**Decisions**

- Drop `scraper/lib/legistar.ts` and `scraper/sources/bos-legistar.ts`
  from M12 scope.
- Keep and extend `scraper/sources/bos.ts` (Playwright). Add
  per-committee Playwright scrapers for Land Use, Budget & Finance,
  etc. following the same pattern.
- M14 (Legistar Matters cross-committee tracking) needs a new data
  source; `sfgov.legistar.com` HTML scraping is a fallback candidate
  but out of scope until M12 HTML path is working.
- Smoke test code at `scraper/setup/legistar-smoke.ts` can be deleted
  once this branch merges — no further probing is needed.

## Things to avoid

- **Don't introduce a second copy of the closed enums.** Import from
  `src/lib/constants.ts` everywhere.
- **Don't store raw PDF bytes in Storage** — we keep the event-page HTML
  as the canonical artefact (single stable URL, cheap to refetch). PDFs
  re-fetch from sfplanning.org on demand.
- **Don't run the scraper from Vercel.** It uses Playwright with full
  Chromium; Vercel's 10-second function timeout doesn't fit. Scraper runs
  in GitHub Actions (`.github/workflows/scrape.yml`, daily cron).
- **Don't put the service-role key in any `NEXT_PUBLIC_` var or in Vercel.**
  It bypasses RLS — only the scraper sees it (via `.env.local` locally,
  via Actions secrets in CI).
- **Don't add a new entry to `NEIGHBORHOODS` without also updating
  `DATASF_TO_ENUM` in `scraper/lib/geo.ts`.** Otherwise polygon-derived
  neighborhoods will silently disagree with the closed enum.
- **Per-committee BOS scrapers are done** (M12). All five committees
  (`bos-land-use`, `bos-budget`, `bos-rules`, `bos-public-safety`,
  `bos-gao`) ship as thin callers into `scraper/lib/bos-shared.ts`.
  Adding a new committee = new thin caller + seed row + npm script +
  GHA matrix entry. Don't duplicate bos-shared.ts logic.
- **Don't bump `PROMPT_VERSION` without re-running the smoke test.**
  Current: `v3` (added `matter_file_number`). The version stamps every
  `agenda_items` row so we can backfill rows extracted under older
  prompts when the schema or instructions meaningfully change.
- **For new BOS file numbers showing up in agendas, write to
  `agenda_items.matter_file_number` only.** The future `legislation`
  table is the enrichment target — agenda extraction is discovery only.
  Don't try to populate matter status/sponsor from the agenda PDF; that
  belongs to the (still-to-build) Legistar HTML enrichment scraper.
- **Don't add error handling for cases that can't happen.** Trust framework
  guarantees; only validate at boundaries (LLM output, scraped HTML).
- **Don't use `--no-verify` or skip hooks.**
