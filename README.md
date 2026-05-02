# SF Civic Tracker

Plain-English summaries of San Francisco Planning Commission agendas, Board of
Supervisors meetings, and public hearing notices — scraped, summarized by an
LLM, and tagged by neighborhood, district, and topic. Filter by your
neighborhood or by topic ("anything about housing in District 5").

**Stack** — Next.js 15 (App Router) on Vercel · Supabase (Postgres + Storage)
· Playwright + GitHub Actions cron · Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
for extraction.

This is a learning project. The plan and milestones live at
`/root/.claude/plans/i-want-to-build-silly-goblet.md`.

---

## Status

**Milestone 10 complete.** Addresses are now extracted by the LLM, geocoded
via Nominatim (cached), and resolved to neighborhood + supervisor district
via point-in-polygon on DataSF Analysis Neighborhoods + Current Supervisor
Districts polygons. Per-item action fields (written-comment deadline, email,
portal, in-person slot) are surfaced as a "Take action by {date}" CTA on
upcoming items.

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
| M9  | Vercel deploy                                                     | ⬜    |
| M10 | Address geocoding + implicit neighborhoods + action layer         | ✅    |
| M11 | Address search UI (foreground for users)                          | ⬜    |
| M12 | SFMTA Board of Directors scraper                                  | ⬜    |
| M13 | Browse-by-neighborhood / browse-by-topic pages                    | ⬜    |
| M14 | Project / legislation tracking (linked items across meetings)     | ⬜    |
| M15 | Analytics ("how many housing projects in District 9 this year?")  | ⬜    |

The full plan for M10–M15 lives at
`/c/Users/liqui/.claude/plans/i-want-to-plan-cozy-avalanche.md`.

---

## One-time setup (do this first)

You'll need free-tier accounts for **Supabase**, **Anthropic**, and **Vercel**
(Vercel is only needed at M9). The scraper also needs a **GitHub** account, but
that's already covered by this repo.

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

### 5. Anthropic API key

Sign up at <https://console.anthropic.com>, create a key, save it to
`ANTHROPIC_API_KEY` in `.env.local`.

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
