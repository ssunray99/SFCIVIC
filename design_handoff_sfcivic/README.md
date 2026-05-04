# Handoff: SFCIVIC Redesign

## Overview

A redesign of [SF Civic Tracker](https://github.com/ssunray99/SFCIVIC) — a Next.js + Supabase app that summarizes San Francisco Planning Commission agendas, Board of Supervisors meetings, and public hearing notices in plain English.

The redesign reorganizes the app into five screens (Home, Ask, Meetings, Topics, Neighborhoods) with an editorial visual system: warm off-white paper, near-black ink, a single rust-orange accent, an editorial serif (Newsreader) for display copy, and a tight monospace (JetBrains Mono) for eyebrows and metadata.

## Screenshots

Reference images of each screen live in `screenshots/`:

| File | What it shows |
| --- | --- |
| `01-home.png` | Home — hero, ask bar, example queries, "By topic" + "By neighborhood" pills, Find by address card, browse-meetings tiles |
| `02-ask-empty.png` | Ask — empty state with example queries before any search |
| `03-ask-results.png` | Ask — results with synthesized answer, citations, matching items |
| `04-meetings.png` | Meetings — header, view tabs, filter bar, meeting cards |
| `05-topics.png` | Topics index — 3-column tile grid with centered orphan row |
| `06-neighborhoods.png` | Neighborhoods index — 3-column tile grid |
| `07-meetings-address-mode.png` | Meetings — address-search-driven state with active chips and "Show:" toggle |

## About the Design Files

The files in this bundle are **design references created in HTML** — a working prototype demonstrating intended layout, typography, color, and interaction. They are **not production code to copy directly**.

The prototype is a single static HTML file (`SFCIVIC Redesign.html`) with React + Babel-in-the-browser, hand-authored fixture data, and inline JSX components. The target app is Next.js 14 (App Router) + Supabase + Tailwind 4. Your task is to **recreate this design inside the existing SFCIVIC Next.js codebase** using its established patterns: server components by default, real Supabase queries instead of fixture data, Tailwind utility classes instead of inline `style={{}}`, and the existing routing structure under `src/app/`.

To preview the prototype: open `SFCIVIC Redesign.html` in a browser. Navigate via the masthead (Home / Ask / Meetings / Topics / Neighborhoods). The Tweaks panel (toggle off in production) lets you preview palette, font, density, and card-style variants — pick the defaults shown when Tweaks is hidden.

## Fidelity

**High-fidelity.** Pixel-perfect mockups. Use the exact colors, typography, spacing, and component anatomy described below. Where the prototype uses CSS variables (`--ink`, `--accent`, etc.), port them as Tailwind theme tokens or CSS custom properties in `globals.css`.

---

## Design Tokens

### Colors

```css
/* Paper / surfaces */
--paper:        #FAF7F2;   /* page background, warm off-white */
--paper-2:      #F2EDE4;   /* subtle surface (filter bar bg, address-search card) */

/* Ink */
--ink:          #1A1816;   /* primary text + dark pills */
--ink-2:        #524C44;   /* secondary text */
--ink-3:        #8A8278;   /* tertiary / metadata */

/* Rule */
--rule:         #D9D2C5;   /* hairlines, borders */

/* Accent */
--accent:       #B8541E;   /* rust-orange, primary CTAs + accent rules */
--accent-soft:  #F5E4D6;   /* tinted background for accent badges */

/* Chip palette (entity color-coding) */
/* Topic chip — green */
background: oklch(0.92 0.07 150);  color: oklch(0.38 0.10 150);

/* District chip — amber */
background: oklch(0.94 0.07 85);   color: oklch(0.42 0.11 70);

/* Neighborhood chip — blue */
background: oklch(0.93 0.05 240);  color: oklch(0.40 0.10 240);

/* Take-action callout — soft yellow */
background: oklch(0.97 0.05 95);   border: 1px solid oklch(0.84 0.10 90);   color: oklch(0.46 0.13 65);

/* Active filter chip (blue) */
background: #DCEBFB;  color: #1F4E79;
```

### Typography

```
Display / serif:  "Newsreader", Georgia, serif       (Google Fonts: Newsreader 400/500/italic)
UI sans:          "Inter", system-ui, sans-serif     (already in repo, ok to keep Geist if preferred)
Mono:             "JetBrains Mono", ui-monospace     (Google Fonts)
```

Newsreader is the workhorse. The brand wordmark "SF·*Civic*" uses Newsreader 500 with italic on "Civic". All page headings (`h2`), section titles, and meeting/item titles are Newsreader 500. Body copy stays Inter/sans. Eyebrows, metadata, and tabs are mono uppercase with `tracking: 0.14em–0.18em`.

| Use | Family | Size | Weight | Tracking |
|---|---|---|---|---|
| Hero wordmark | Newsreader | 96px / line 0.95 | 500 | -0.02em |
| Page heading (Meetings, Topics, etc.) | Newsreader | 48px / line 1.0 | 500 | tight |
| Section title (Upcoming, Past) | Newsreader | 26px | 500 | tight |
| Meeting title | Newsreader | 21px / leading-tight | 500 | – |
| Item title | Newsreader | 17px / leading-snug | 500 | – |
| Body | Inter | 14–15px / leading-relaxed | 400 | – |
| Eyebrow | JetBrains Mono | 10–11px UPPERCASE | 400 | 0.14–0.18em |
| Metadata / source pill text | Inter | 12–13px | 400–500 | – |

### Spacing & Border-radius

- Page padding: `px-10 py-10` (40px) on all main screens; `py-12` for index pages
- Section gap: `gap-7` to `gap-16` between top-level sections
- Card padding: `p-4` to `p-5`
- Border radius: `6px` for sub-cards, `8px` for outer cards, `9999px` for pills/chips
- Border weight: `1px solid var(--rule)` everywhere; `2px` accent for the answer-card left border

### Iconography

The prototype uses **no SVG icons** — only Unicode glyphs and arrows: `→` for CTAs, `↗` for outbound links, `←` for back, `·` for separators. Match this convention in the production version. (Lucide icons are fine if your team prefers, but the design is icon-light by default.)

---

## Screens / Views

### 1. Home (`/`)

**Purpose:** Land the user. Offer three entry points: ask Claude a question, browse by topic/neighborhood/address, or jump to upcoming/past meeting tiles.

**Layout:** Single column, max-width unconstrained. Three vertical sections separated by `gap-16`:
1. **Hero + Ask input**
2. **Explore (By topic | By neighborhood, two columns)**
3. **Browse meetings tiles (Upcoming | Past, two columns)**

#### Components

**Wordmark heading**
- Text: `SF·Civic` — `·` rendered in `var(--accent)`, "Civic" italic
- Newsreader 96/0.95/500, letter-spacing -0.02em

**Tagline**
- One line, no wrap: "Explore and search across the San Francisco civic process for topics and neighborhoods you care about."
- 15px / leading-relaxed / `var(--ink-2)`

**Ask input**
- Full-width form with 2px black border
- Left: "Ask" eyebrow label (mono uppercase 10px, padded, `border-r`)
- Center: input with rotating placeholder cycling through example queries
- Right: "Ask  →" submit button — `var(--accent)` background, paper text, mono uppercase
- Submitting routes to `/ask?q=<value>`

**Try-asking links** (under the input)
- Mono uppercase eyebrow "Try asking" + 3 italic-serif quoted queries (15px)
- Clicking a query navigates to `/ask?q=<that query>` — same effect as typing it

**Explore section**
- Two columns separated by `gap-12`
- Left: "By topic" — `SectionRule` header + flex-wrap of outlined `Pill`s, one per featured topic, plus an accent `+ all 14 →` pill that routes to `/topics`
- Right: "By neighborhood" — same pattern, plus address-search card

**Address search card**
- Inset card on `var(--paper-2)` background, `border 1px var(--rule)`
- "Find by address" eyebrow, short description, then a form: text input + black `Locate →` button (mono uppercase)
- Submitting geocodes (stub) and routes to `/meetings?neighborhood=<x>&district=<y>&addressMode=true`

**Browse meetings tiles**
- 2-column grid, hairline-divided (`gap-px` on `var(--rule)` background)
- Each tile: large Newsreader number (56px / weight 500), mono uppercase label, body subtitle, accent "View all →"
- **Counts must be live** — read from the meetings table, not hardcoded:
  - Upcoming = `meetings WHERE meeting_date >= today`
  - Past = `meetings WHERE meeting_date < today`

---

### 2. Ask (`/ask`)

**Purpose:** Conversational search. User submits a natural-language query; Claude answers in prose with citations to specific agenda items below.

**Two states:**

**Empty state** (no `?q=` parameter or empty)
- Page heading: "Ask" (Newsreader 38px / 500)
- Description: "Ask about anything happening across the SF civic process — by topic, neighborhood, district, or source."
- The same Ask input as Home (slightly smaller — 17px font instead of 19px)
- "Try asking" section — mono eyebrow + 4 italic-serif example queries as buttons. Clicking a query submits it.

**Result state** (with `?q=`)
- Page heading shows the query verbatim (Newsreader 38px)
- Ask input pre-filled with the query
- **Answer card** — left border-l-2 in accent color, `pl-6 py-2`. Eyebrow: "Answer". Newsreader 19px / leading-relaxed body with inline citation links `[1]`, `[2]`… anchored to `#item-N`
- **Matching items** — `SectionRule` header "Matching items" with count, then a vertical list of bordered cards:
  - Each card: `[N]` index gutter (mono 12px tabular-nums) + content column
  - Content: dark `SourcePill` + date metadata, Newsreader 17px title, body summary, then chip row (DistrictChip + NeighborhoodChip + TopicTag, all colored)
  - Cards are `p-4 border 1px var(--rule), border-radius 8px`, gapped `gap-3`

**Important:** The Ask page never shows the dropdown filters or "interpreted as" line. Citations are the only way to reach individual items from the answer.

---

### 3. Meetings (`/meetings`)

**Purpose:** Browse the full meeting record with structured filters.

#### Layout

Vertical stack:
1. Back link → page heading + description
2. **View toggle** — pill-shaped buttons `Upcoming` / `Past` / `All`, left-aligned. Active = filled black + paper text. Inactive = paper bg + `var(--rule)` border + `var(--ink-2)` text. `border-radius: 6px`
3. **Filter bar** — single horizontal row, wraps on narrow viewports:
   - Search input (placeholder: "Search agenda items…", flex 1, max 320px)
   - "All neighborhoods" select
   - "All districts" select (1–11)
   - "All topics" select
   - "All sources" select
   - All inputs share `border 1px var(--rule), background var(--paper), border-radius 6px, padding 8px 14px`
4. **Active-filter chips** (only when filters active) — wrapped row of removable blue pills (`#DCEBFB` bg, `#1F4E79` text, with `× ` to remove); ends with a muted "Clear all" link in `var(--ink-3)`
5. **Show toggle** (only when address mode active) — small left-aligned row: "Show:" + two pills: `<Neighborhood> / District N only` (active) vs `Also include citywide` (outlined)
6. **Section title** — "Upcoming" / "Past" / "All meetings" (Newsreader 26px) with count in accent on right
7. **Meeting list** — vertical stack, `gap-5`

#### MeetingCard anatomy

Outer card (`background var(--paper)`, `border 1px var(--rule)`, `border-radius 8px`):
- **Header** (`px-5 pt-4 pb-3, gap-2`):
  - Row 1: dark `SourcePill` (full source name, e.g. "Land Use & Transportation Committee") + date string ("Mon, Nov 4, 2024") + optional accent mono badge ("TOMORROW", "TODAY") if within 3 days
  - Row 2: meeting title (Newsreader 21px / 500)
  - Row 3: "Original agenda ↗" link in `var(--accent)`
- **Items** (`px-5 pb-5, gap-3`): vertical stack of `ItemSubCard`s

#### ItemSubCard anatomy

(`background var(--paper)`, `border 1px var(--rule)`, `border-radius 6px`, `p-4`):
- **Header row**: `#1` index (mono tabular-nums, 13px, `var(--ink-3)`) + title (Newsreader 17px / 500), with `TypeBadge` ("Ordinance", "Resolution", "Hearing", "Informational") on right — outlined pill, `var(--paper)` bg, 12px text
- **Summary** (when not in compact density): 13.5px body / `var(--ink-2)`
- **Chip row**: `DistrictChip` (amber) + `NeighborhoodChip`(s) (blue) + `TopicTag`(s) (green). If no district + no neighborhoods, show a "Citywide" outlined chip
- **ActionCallout** (only on the flagged item per meeting): soft-yellow box with bold "Take action by <date>" / "Take action" header, full meeting datetime/location string, and "Email comment" / "Comment portal →" inline links — all in the warm-yellow text color
- **Matter file link**: `FILE № 250604` (mono) + "track legislation →" underlined, in `var(--ink-3)`

---

### 4. Topics (`/topics`)

**Purpose:** Browse all topic tags. Selecting one routes to `/meetings?topic=<slug>&view=upcoming`.

**Layout:**
- Back link
- Heading: "Browse by Topic" (Newsreader 44px / 600)
- Description: "Find SF civic meetings with agenda items on the issues you care about."
- 3-column grid of bordered tiles, alphabetized
- **Last row centering**: if total is not divisible by 3, the leftover tiles render in a centered flex row below the main grid (e.g. 14 topics → 12 in grid + 2 centered below)

Each tile: `p-5`, `border 1px var(--rule)`, `border-radius 8px`, hover `var(--paper-2)`. Just the topic label in 15.5px ink — no count, no icon.

---

### 5. Neighborhoods (`/neighborhoods`)

**Purpose:** Browse all neighborhoods. Selecting one routes to `/meetings?neighborhood=<name>&view=upcoming`.

Same layout pattern as Topics. Heading: "Browse by Neighborhood". Description: "Find SF civic meetings with agenda items affecting your neighborhood." Grid contains ~30 SF neighborhoods (Mission, Castro, SoMa, Financial District, etc.).

---

### Masthead (all pages)

Top of every page (`px-10 py-5`):
- Left: "SF·*Civic*" wordmark (Newsreader 24px, the `·` in accent, "Civic" italic) — clickable, routes to `/`
- Right: nav links — `Home`, `Meetings`, `Topics`, `Neighborhoods`, `Ask`, `About`. Each is mono uppercase 11px tracked-out. Active route gets a 2px accent underline; inactive routes are `var(--ink-3)`.
- **No date stamp** in the masthead. The earlier prototype had one — it was removed.
- Clicking "Ask" must reset the query state (don't carry the previous `?q=`).

---

## Interactions & Behavior

### Routing

| From | To | Notes |
|---|---|---|
| Home Ask form submit | `/ask?q=<value>` | |
| Home "Try asking" button | `/ask?q=<example>` | |
| Home topic pill | `/meetings?topic=<slug>&view=upcoming` | |
| Home neighborhood pill | `/meetings?neighborhood=<name>&view=upcoming` | |
| Home "+ all N →" topic pill | `/topics` | |
| Home "+ all neighborhoods →" pill | `/neighborhoods` | |
| Home address Locate | `/meetings?neighborhood=<x>&district=<y>&addressMode=true&view=upcoming` | |
| Home Upcoming tile | `/meetings?view=upcoming` | |
| Home Past tile | `/meetings?view=past` | |
| Topics tile click | `/meetings?topic=<slug>&view=upcoming` | |
| Neighborhoods tile click | `/meetings?neighborhood=<name>&view=upcoming` | |
| Ask citation `[N]` | scroll to `#item-N` on same page | |

### Address geocoding

The prototype uses a stub lookup. In production, use the existing `/api/locate` route (already in the repo). The route returns `{ neighborhood, district }` for an address — pass these as URL params on navigation to `/meetings`.

If the geocode fails or returns nothing, surface an inline error in the Find-by-address card (e.g. "Couldn't find that address — try a neighborhood name") instead of routing.

### Filter behavior on Meetings

- All filters compose with AND semantics
- The `view` filter (upcoming/past/all) toggles by date relative to today
- The search input matches against meeting title + item title + item summary (case-insensitive substring)
- When `addressMode` is true and both `neighborhood` and `district` are set, the geo-match uses **OR** (item matches if it's in the neighborhood OR in the district) — this is the "address mode" semantics
- The `Show: include citywide` toggle is only visible in address mode. When on, items with no neighborhood and no district are also matched (citywide items)

### Date / time helpers

- "Tomorrow" / "Today" mono badges show on cards within 3 days of today
- Date format on cards: "Mon, Nov 4, 2024" (`weekday: short, month: short, day: numeric, year: numeric`)
- Action callout date format: "Monday, May 4, 2026, 10:00 AM, City Hall, Legislative Chamber, Room 250"
- Relative dates use the user's local timezone

### Action callout decision

The prototype shows the callout on **one** item per meeting — the first item with a real `comment_deadline` / `comment_email` / `comment_portal_url` / `in_person_slot`, falling back to the second item if the meeting is upcoming and has no flagged items. Mirror this rule in production so meetings don't overflow with redundant callouts.

---

## State Management

For Next.js App Router:

- **Search params drive everything** — the Meetings page reads filters from `searchParams`. No client state for filter values; navigating updates the URL via `router.push` and the page re-renders server-side with new data.
- **Single `useState`** in the Meetings client component to debounce the search input before pushing to URL.
- **Ask page** is the same — `?q=` drives whether to show empty state vs result state.
- **Home page** can be fully server-rendered. The Ask input is a client island (`'use client'`) just for the rotating placeholder + form submit handler.

---

## Data

The prototype's `data.js` has fixture meetings with this shape — match it to your existing schema:

```ts
type Meeting = {
  id: string;
  source_id: string;       // 'planning' | 'bos' | 'bos-land-use' | 'bos-budget' | 'sfmta' | 'hpc' | 'police-commission' | …
  title: string;
  meeting_date: string;    // ISO yyyy-mm-dd
  time?: string;           // '1:30 PM'
  location?: string;       // 'City Hall, Room 263'
  past: boolean;           // computed from meeting_date < today
  items: Item[];
};

type Item = {
  id: string;
  position: number;
  title: string;
  summary: string;
  item_type: 'ordinance' | 'resolution' | 'hearing' | 'informational' | 'appointment' | 'appeal';
  district: number | null;
  neighborhoods: string[];
  topics: string[];
  comment_deadline?: string;       // ISO date
  comment_email?: string;
  comment_portal_url?: string;
  in_person_slot?: string;         // 'In person — City Hall Rm 263, 1:30 PM'
  matter_file_number?: string;     // '250604'
};
```

The `TOPICS` constant is a closed enum and should match `src/lib/constants.ts` exactly. The `SOURCES` array maps source IDs to display names — port to your existing source registry.

---

## Files in This Bundle

| File | Purpose |
|---|---|
| `SFCIVIC Redesign.html` | The prototype entry point. Open in a browser to preview. |
| `data.js` | Fixture data + constants (TOPICS, SOURCES, FEATURED_NEIGHBORHOODS, DISTRICTS, meetings) — replace with Supabase queries in production |
| `primitives.jsx` | Shared display components: `Eyebrow`, `SectionRule`, `Pill`, `TopicTag`, `DistrictChip`, `NeighborhoodChip`, `SourceCode`, date helpers |
| `meeting.jsx` | `MeetingCard`, `ItemSubCard`, `ActionCallout`, `SourcePill`, `TypeBadge` |
| `district-grid.jsx` | District grid (used in some Tweaks variants — may be omitted in production) |
| `masthead.jsx` | Top nav with active-route underline |
| `screen-home.jsx` | `HomeScreen`, `HeroAsk`, `ExploreSection`, `BrowseTiles`, `RotatingPlaceholder` |
| `screens-other.jsx` | `AskScreen`, `MeetingsScreen`, `FilterBar`, `ViewToggle`, `Cite` |
| `screens-index.jsx` | `TopicsScreen`, `NeighborhoodsScreen`, `GridTile`, `TileGrid` (centers orphan-row tiles) |
| `tweaks-panel.jsx` | Design-time only — variants explorer. Not part of production. |
| `browser-window.jsx` | Design-time chrome. Not part of production. |

The `tweaks-panel.jsx` and `browser-window.jsx` files are scaffolding for the prototype only — ignore them when porting.

---

## Production Implementation Steps (suggested order)

1. **Tokens** — Port colors, typography, and radius tokens to `globals.css` and Tailwind theme. Add Newsreader + JetBrains Mono via `next/font`.
2. **Primitives** — Build `Eyebrow`, `SectionRule`, `Pill`, `TopicTag`, `DistrictChip`, `NeighborhoodChip`, `SourcePill`, `TypeBadge` as server components in `src/components/`.
3. **MeetingCard + ItemSubCard + ActionCallout** — These replace the existing `src/components/MeetingCard.tsx` and `ItemCard.tsx`. The data shape already matches.
4. **Masthead** — Replace whatever's in `src/app/layout.tsx`'s nav with the new wordmark + nav row.
5. **Home page** (`src/app/page.tsx`) — Hero, Ask input (client island), Explore section, Browse tiles. Wire live counts via Supabase.
6. **Ask page** (`src/app/ask/page.tsx`) — Empty state vs result state branching on `?q=`. Citation anchors.
7. **Meetings page** (`src/app/meetings/page.tsx`) — View toggle + filter bar + active chips + Show toggle (address mode) + meeting list. All filter state in URL.
8. **Topics + Neighborhoods pages** — New routes. Tile grids with last-row centering.
9. **About page** — Keep existing copy; restyle to match the new tokens.

Once it builds locally, push to GitHub. Vercel auto-deploys.
