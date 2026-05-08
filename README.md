# SF Civic Tracker

Plain-English summaries of San Francisco Planning Commission agendas, Board of
Supervisors meetings, and public hearing notices — scraped, summarized by an
LLM, and tagged by neighborhood, district, and topic. Filter by your
neighborhood or by topic ("anything about housing in District 5").

**Stack** — Next.js 16 (App Router) on Vercel · Supabase (Postgres + Storage)
· Playwright + GitHub Actions cron · Google **Gemini 2.5 Flash**
(`gemini-2.5-flash` via `@google/genai`) for agenda extraction, with
multimodal PDF fallback for scanned documents.

This is a learning project. The plan and milestones live at
`/root/.claude/plans/i-want-to-build-silly-goblet.md`.

---

## Status

**M12 complete.** SFMTA Board of Directors scraper added (`sfmta.com`
Playwright — BoardDocs blocks automated fetches). All sources are live:
Planning, HPC, BOS Full Board + 5 committees, SFMTA Board, and public
hearing notices. **M13 complete.** Browse-by-neighborhood (`/neighborhoods/[slug]`)
and browse-by-topic (`/topics/[slug]`) pages with static pre-generation.
**M15 (analytics) complete.** `/analytics` page shows year-to-date item
counts by neighborhood, topic, district, and source; cross-committee matter
tracking; scraper health table. **M14 complete** — `legislation` table (migration 0004), Legistar HTML
enrichment scraper (`scraper/setup/legistar-html-enrich.ts`), and
`/projects/[fileNumber]` page are all live; 190 BOS matters enriched from
`sfgov.legistar.com`. Re-run `npm run enrich:legislation` periodically as
new file numbers accumulate. Supervisor vote/attendance accountability views
require a data source not yet identified.

| M   | Goal                                                              | State |
| --- | ----------------------------------------------------------------- | ----- |
| M1  | Skeleton, schema, shadcn walkthrough                              | ✅    |
| M2  | Planning Commission scraper end-to-end (no LLM)                   | ✅    |
| M3  | LLM extraction (Claude Haiku 4.5 → Gemini 2.5 Flash in v4)        | ✅    |
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

Architectural detail for M11–M15 lives in `CLAUDE.md` under "Planned
architecture."

---

## One-time setup (do this first)

You'll need free-tier accounts for **Supabase**, **Google AI Studio** (for the
Gemini API key), and **Vercel** (only needed at M9). The scraper also needs a
**GitHub** account, but that's already covered by this repo.

### 1. Create a Supabase project

1. Sign up at <https://supabase.com>.
2. Create a new project (any region; pick the one closest to you).
3. From the project dashboard, grab:
   - **Project URL** → goes to `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_URL`
   - **anon public key** → goes to `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** (under "Reveal") → goes to `SUPABASE_SERVICE_ROLE_KEY`

⚠️ The service-role key bypasses Row Level Security. Only ever use it in the
scraper or in `.env.local`. Never commit it. Never put it in Vercel.

### 2. Install the Supabase CLI

The CLI is already a devDependency in this repo, so once you've run
`npm install` (step 7 below) it's available via `npx`. Use that on **Windows,
macOS, or Linux** — no per-OS package manager needed:

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>   # ref is in the project URL
```

> The `<project-ref>` is the random-looking string in your project URL —
> e.g. for `https://abcdefghijklmnop.supabase.co` the ref is
> `abcdefghijklmnop`.

If you'd rather install the CLI globally (optional):

- **Windows** — `scoop bucket add supabase https://github.com/supabase/scoop-bucket.git && scoop install supabase` (requires [Scoop](https://scoop.sh))
- **macOS** — `brew install supabase/tap/supabase`
- **Linux** — see <https://supabase.com/docs/guides/cli>

With a global install you can drop the `npx` prefix.

### 3. Apply the schema

```bash
npm run db:push                        # applies supabase/migrations/0001_init.sql
```

Then run `supabase/seed.sql` to populate the three source rows. Easiest way:
open the **SQL Editor** in the Supabase dashboard, paste the file's contents,
and click *Run*. (The CLI's `db reset` would also work but wipes your data,
which is overkill here.)

Create a Storage bucket named **`raw`** (public read) — used for archival HTML
and PDFs. From the dashboard: Storage → New bucket → name `raw` → toggle
*Public bucket* on → Save.

### 4. Generate TypeScript types from your schema

```bash
npm run db:types       # writes src/lib/database.types.ts
```

### 5. Gemini API key

Sign up at <https://aistudio.google.com>, click *Get API key*, create a key,
and save it to `GEMINI_API_KEY` in `.env.local`. The free tier is generous
enough for typical scrape volumes; cost stays low even on full-history backfills
because Gemini 2.5 Flash is priced ~10× cheaper than the previous Claude Haiku
model and we no longer use prompt caching (Flash is already cheap enough that
the missing cache doesn't matter).

### 6. Local environment

Copy `.env.example` to `.env.local`, then fill in the values from steps 1
and 5.

```bash
# macOS / Linux / Git Bash on Windows
cp .env.example .env.local

# Windows PowerShell
Copy-Item .env.example .env.local

# Windows Command Prompt
copy .env.example .env.local
```

### 7. Install deps and run the dev server

```bash
npm install
npm run dev
```

Visit <http://localhost:3000>. On Windows, use **PowerShell** or **Git Bash**
— the commands in this README are bash-flavored but `npm`/`npx` work the same
in PowerShell.

---

## About shadcn/ui (the walkthrough you asked for)

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

(The CLI fetches templates from <https://ui.shadcn.com> and writes them into
`src/components/ui/`. We'll do this in M5/M6 when we build the filter UI.)

---

## Development

```bash
npm run dev              # Next.js dev server
npm run typecheck        # TypeScript check
npm run lint             # ESLint
npm run scrape           # run all scrapers locally (M2+)
npm run scrape:planning  # single source
npm run enrich:legislation                    # populate legislation table from Legistar
npm run backfill:prompt-version -- --limit 50 # re-extract stale rows under v4
npm run backfill:bos-minutes                  # fill in missing BOS minutes
```

---

## Repo layout

```
.
├── supabase/
│   ├── migrations/0001_init.sql     # schema
│   └── seed.sql                     # source registry rows
├── src/
│   ├── app/                         # Next.js App Router pages
│   ├── components/                  # ui/ + custom
│   └── lib/
│       ├── constants.ts             # NEIGHBORHOODS, TOPICS, DISTRICTS (single source of truth)
│       ├── utils.ts                 # cn() helper
│       └── supabase/{server,admin}.ts
├── scraper/                         # added in M2
└── .github/workflows/scrape.yml     # added in M8
```

---

## Disclaimer

This site is **unofficial**. Summaries are AI-generated and may be wrong or
incomplete. For canonical agendas and decisions, see the original sources:

- <https://sfplanning.org/hearings-commission>
- <https://sfbos.org/meetings>
- <https://sfplanning.org/notices>
