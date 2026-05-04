// Natural-language search query parser.
//
// Takes a free-form query like "housing in District 5 next month" and uses
// Claude Haiku 4.5 with forced tool-use to map it onto the closed filter
// enums + a date range. The frontend then sets URL params and lets the
// existing query path on / handle the rest — no new query infra needed.
//
// Reuses the same Anthropic SDK patterns as scraper/lib/llm.ts:
//   - prompt caching on system prompt + tool schema
//   - forced tool_choice for structured output
//   - enum-validation to drop hallucinated values
//
// Server-only. Reads ANTHROPIC_API_KEY (NOT NEXT_PUBLIC_*).

import Anthropic from '@anthropic-ai/sdk';
import {
  NEIGHBORHOODS,
  TOPICS,
  DISTRICTS,
  SOURCES,
  type Neighborhood,
  type Topic,
  type District,
  type SourceId,
} from '@/lib/constants';

const MODEL = 'claude-haiku-4-5-20251001';
const TOOL_NAME = 'parse_search_query';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

const SYSTEM_PROMPT = `You parse natural-language search queries from users of an SF civic-meeting tracker into structured filters.

The user types things like:
  "housing in District 5 next month"
  "evictions near Mission"
  "anything from the planning commission this week"
  "transit projects in SoMa"

Map their query onto these closed sets:

NEIGHBORHOODS (use the exact spelling, case-sensitive):
${NEIGHBORHOODS.join(', ')}

TOPICS (use the exact value):
${TOPICS.join(', ')}

DISTRICTS: integers 1 through 11.

SOURCES (use the id, not the name):
${SOURCES.map((s) => `  ${s.id} = ${s.name}`).join('\n')}

DATE RANGE (dateFrom, dateTo) in YYYY-MM-DD:
- "next week"  → 7 days starting from the next Monday
- "next month" → first to last day of the next calendar month
- "this week"  → today through the end of this week (Sunday)
- "in October" → the next October that hasn't ended yet
- "today"      → today only (dateFrom = dateTo = today)
- If no temporal phrase, leave both null.

KEYWORDS:
- Anything left over after extracting the structured fields. Free-form text
  the user wrote that didn't map to an enum (e.g., "evictions", "outdoor dining").
- Empty string if nothing remains.

Rules:
- Only emit values from the closed sets above. Never invent a neighborhood, topic,
  or source id. If unsure, leave the array empty.
- Prefer specific over general — if the user names a neighborhood AND a district,
  emit both.
- Multiple topics or neighborhoods are allowed; emit them as arrays.
- If the query is gibberish or matches nothing, return all-null/empty fields with
  the original query as keywords.`;

const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    topics: {
      type: 'array' as const,
      items: { type: 'string' as const, enum: [...TOPICS] },
      description: 'Topics that match the query. Empty array if none.',
    },
    neighborhoods: {
      type: 'array' as const,
      items: { type: 'string' as const, enum: [...NEIGHBORHOODS] },
      description: 'Neighborhoods named or implied by the query.',
    },
    district: {
      type: ['integer', 'null'] as const,
      description: 'Supervisor district 1–11, or null if not mentioned.',
    },
    source: {
      type: ['string', 'null'] as const,
      enum: [...SOURCES.map((s) => s.id), null],
      description: 'Source id (e.g. "planning", "bos-land-use"), or null.',
    },
    dateFrom: {
      type: ['string', 'null'] as const,
      description: 'Lower-bound meeting date in YYYY-MM-DD, or null.',
    },
    dateTo: {
      type: ['string', 'null'] as const,
      description: 'Upper-bound meeting date in YYYY-MM-DD, or null.',
    },
    keywords: {
      type: 'string' as const,
      description: 'Free-text leftover after extracting structured fields. May be empty.',
    },
  },
  required: ['topics', 'neighborhoods', 'district', 'source', 'dateFrom', 'dateTo', 'keywords'],
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

type ParseResult = {
  topics: Topic[];
  neighborhoods: Neighborhood[];
  district: District | null;
  source: SourceId | null;
  dateFrom: string | null;
  dateTo: string | null;
  keywords: string;
};

function validate(raw: unknown): ParseResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;

  const topics = Array.isArray(r.topics)
    ? r.topics.filter((t): t is Topic =>
        typeof t === 'string' && (TOPICS as readonly string[]).includes(t),
      )
    : [];
  const neighborhoods = Array.isArray(r.neighborhoods)
    ? r.neighborhoods.filter((n): n is Neighborhood =>
        typeof n === 'string' && (NEIGHBORHOODS as readonly string[]).includes(n),
      )
    : [];
  const districtN = typeof r.district === 'number' ? r.district : null;
  const district =
    districtN != null && DISTRICTS.includes(districtN as District)
      ? (districtN as District)
      : null;
  const source =
    typeof r.source === 'string' && SOURCES.some((s) => s.id === r.source)
      ? (r.source as SourceId)
      : null;
  const dateFrom =
    typeof r.dateFrom === 'string' && ISO_DATE.test(r.dateFrom) ? r.dateFrom : null;
  const dateTo =
    typeof r.dateTo === 'string' && ISO_DATE.test(r.dateTo) ? r.dateTo : null;
  const keywords = typeof r.keywords === 'string' ? r.keywords.trim() : '';

  return { topics, neighborhoods, district, source, dateFrom, dateTo, keywords };
}

export async function GET(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ error: 'search unavailable' }, { status: 503 });
  }

  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();
  if (!q) return Response.json({ error: 'q required' }, { status: 400 });
  if (q.length > 500) return Response.json({ error: 'query too long' }, { status: 400 });

  const today = new Date().toISOString().slice(0, 10);

  let response;
  try {
    response = await getClient().messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: [
        {
          type: 'text',
          text: SYSTEM_PROMPT,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: TOOL_NAME,
          description: 'Record the structured filters parsed from the user query.',
          input_schema: TOOL_SCHEMA,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: `Today's date is ${today}.\n\nUser query: ${q}`,
        },
      ],
    });
  } catch (err) {
    console.error('[search] anthropic call failed:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'parse failed' }, { status: 502 });
  }

  const toolBlock = response.content.find((b) => b.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    return Response.json({ error: 'no tool_use block in response' }, { status: 502 });
  }

  const parsed = validate(toolBlock.input);
  if (!parsed) {
    return Response.json({ error: 'invalid tool output' }, { status: 502 });
  }

  return Response.json(parsed);
}
