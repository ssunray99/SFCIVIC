# CLAUDE.md

Guidance for Claude working in this repo. Read this before making changes.

## What this is

**SF Civic Tracker** — a Next.js + Supabase site that scrapes SF Planning
Commission, Board of Supervisors, and public hearing notices, runs each
meeting's agenda through Claude Haiku 4.5 to extract structured items, and
lets visitors filter by neighborhood, district, or topic.

This is a learning project. The full plan lives at
`/root/.claude/plans/i-want-to-build-silly-goblet.md` (also referenced from
the README). Milestone progress is tracked in `README.md` under "Status".

**Currently at M10 ✅ (address geocoding + implicit neighborhoods + action
layer).** M11–M15 in the plan at
`/c/Users/liqui/.claude/plans/i-want-to-plan-cozy-avalanche.md` cover
address search UI, SFMTA scraper, browse-by-neighborhood/topic pages,
project tracking, and analytics. M9 (Vercel deploy) is unstarted.

## Stack

- **Frontend:** Next.js 16 (App Router, RSC) + Tailwind v4. Server components
  do all data fetching via the Supabase anon key; URL search params drive
  filters. No client-side data fetching.
- **DB:** Supabase Postgres. RLS enabled with public-select policies; writes
  go through the service-role client in the scraper. Generated types live at
  `src/lib/database.types.ts` (regenerate with `npm run db:types`).
- **Storage:** Supabase Storage bucket `raw` holds archival event-page HTML
  per meeting (path `raw/{source_id}/{yyyy}/{mm}/{content_hash}.html`).
- **Scraper:** Playwright Chromium + tsx. Lives in `/scraper`, runs locally
  via `npm run scrape:planning` (and eventually GitHub Actions on cron).
- **LLM:** `claude-haiku-4-5-20251001` via `@anthropic-ai/sdk`. Tool-use with
  forced `record_agenda_items` tool for structured output. Prompt caching on
  system prompt + tool schema.

## Repo layout (the parts you'll touch)

```
scraper/
  run.ts                       CLI entrypoint (planning|bos|hearings|extract)
  sources/planning.ts          SF Planning Commission scraper
  sources/bos.ts               SF Board of Supervisors scraper
  lib/playwright.ts            Browser bootstrap + fetchBytes()
  lib/pdf.ts                   pdf-parse wrapper (PINNED v1.1.1)
  lib/storage.ts               Supabase Storage upload helper
  lib/hash.ts                  sha256 helper
  lib/llm.ts                   extractAgendaItems() — Anthropic call
  lib/extract-pipeline.ts      persistExtractedItems() — shared post-LLM
                               pipeline (geocode → polygon-resolve → insert
                               agenda_items + agenda_item_locations); both
                               source scrapers thin-call this
  lib/geocode.ts               Nominatim geocoder (1.1s throttle, SF bbox)
                               with cache-first lookup against address_cache
  lib/geo.ts                   Hand-rolled point-in-polygon (handles
                               MultiPolygons + holes), haversine, bbox.
                               Uses scraper/data/{neighborhoods,districts}.geojson.
                               DATASF_TO_ENUM maps DataSF analysis-neighborhood
                               names to our closed enum.
  data/neighborhoods.geojson   DataSF Analysis Neighborhoods (4x4: ajp5-b2md)
  data/districts.geojson       DataSF Current Supervisor Districts (4x4: keex-zmn4)
  setup/fetch-geo.ts           One-shot polygon downloader; npm run fetch:geo
  prompts/extract.ts           SYSTEM_PROMPT + TOOL_SCHEMA + PROMPT_VERSION

src/
  app/page.tsx                 RSC homepage — Upcoming + Past sections
  app/layout.tsx               Root layout
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
because (a) they're scraper-side today and (b) the .geojson files are 1.4MB
+ 460KB, which we don't want bundled into the Next.js client. When M11
adds an `/api/locate` route, it imports from `scraper/lib/geo.ts` directly.

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
npm run dev               # Next.js dev server on :3000
npm run typecheck         # tsc --noEmit
npm run lint              # eslint
npm run scrape:planning   # full Planning Commission scrape
npm run extract           # re-run LLM on stored meetings (limited utility —
                          # storage holds event HTML, not packet PDF text)
npm run db:types          # regenerate src/lib/database.types.ts from cloud
npm run db:push           # apply migrations to linked cloud project
npm run fetch:geo         # re-download SF neighborhood + district polygons
                          # from DataSF into scraper/data/
```

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
- **Don't add error handling for cases that can't happen.** Trust framework
  guarantees; only validate at boundaries (LLM output, scraped HTML).
- **Don't use `--no-verify` or skip hooks.**
