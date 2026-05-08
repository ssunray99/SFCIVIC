// Natural-language query parser shared by /api/search (sets URL filters) and
// /ask (LLM-synthesized answer with citations).
//
// Takes a free-form prompt like "housing in District 5 next month" and uses
// Gemini 2.5 Flash with forced function-calling to map it onto closed enums
// + a date range. Same surface as scraper/lib/llm.ts.
//
// Server-only. Reads GEMINI_API_KEY (NOT NEXT_PUBLIC_*).

import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
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

const MODEL = 'gemini-2.5-flash';
const TOOL_NAME = 'parse_search_query';

let _client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    _client = new GoogleGenAI({ apiKey });
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

// Gemini-native schema (OpenAPI-3.0 subset). Uppercase Type strings, `nullable`
// instead of nullable union types.
const TOOL_SCHEMA = {
  type: 'OBJECT',
  required: ['topics', 'neighborhoods', 'district', 'source', 'dateFrom', 'dateTo', 'keywords'],
  properties: {
    topics: {
      type: 'ARRAY',
      items: { type: 'STRING', enum: [...TOPICS] },
      description: 'Topics that match the query. Empty array if none.',
    },
    neighborhoods: {
      type: 'ARRAY',
      items: { type: 'STRING', enum: [...NEIGHBORHOODS] },
      description: 'Neighborhoods named or implied by the query.',
    },
    district: {
      type: 'INTEGER',
      nullable: true,
      description: 'Supervisor district 1–11, or null if not mentioned.',
    },
    source: {
      type: 'STRING',
      nullable: true,
      enum: SOURCES.map((s) => s.id),
      description: 'Source id (e.g. "planning", "bos-land-use"), or null.',
    },
    dateFrom: {
      type: 'STRING',
      nullable: true,
      description: 'Lower-bound meeting date in YYYY-MM-DD, or null.',
    },
    dateTo: {
      type: 'STRING',
      nullable: true,
      description: 'Upper-bound meeting date in YYYY-MM-DD, or null.',
    },
    keywords: {
      type: 'STRING',
      description: 'Free-text leftover after extracting structured fields. May be empty.',
    },
  },
} as const;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type ParsedQuery = {
  topics: Topic[];
  neighborhoods: Neighborhood[];
  district: District | null;
  source: SourceId | null;
  dateFrom: string | null;
  dateTo: string | null;
  keywords: string;
};

function validate(raw: unknown): ParsedQuery | null {
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

export class ParseError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function parseQuery(q: string): Promise<ParsedQuery> {
  if (!process.env.GEMINI_API_KEY) {
    throw new ParseError('search unavailable', 503);
  }
  const trimmed = q.trim();
  if (!trimmed) throw new ParseError('q required', 400);
  if (trimmed.length > 500) throw new ParseError('query too long', 400);

  const today = new Date().toISOString().slice(0, 10);

  let response;
  try {
    response = await getClient().models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ text: `Today's date is ${today}.\n\nUser query: ${trimmed}` }],
        },
      ],
      config: {
        systemInstruction: SYSTEM_PROMPT,
        temperature: 0,
        maxOutputTokens: 1024,
        tools: [
          {
            functionDeclarations: [
              {
                name: TOOL_NAME,
                description: 'Record the structured filters parsed from the user query.',
                parameters: TOOL_SCHEMA as unknown as Record<string, unknown>,
              },
            ],
          },
        ],
        toolConfig: {
          functionCallingConfig: {
            mode: FunctionCallingConfigMode.ANY,
            allowedFunctionNames: [TOOL_NAME],
          },
        },
      },
    });
  } catch (err) {
    console.error('[parse-query] gemini call failed:', err instanceof Error ? err.message : err);
    throw new ParseError('parse failed', 502);
  }

  const r = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ functionCall?: { name?: string; args?: unknown } }>;
      };
    }>;
  };
  const fnCall = r.candidates?.[0]?.content?.parts?.find(
    (p) => p.functionCall && p.functionCall.name === TOOL_NAME,
  )?.functionCall;
  if (!fnCall) throw new ParseError('no function-call in response', 502);

  const parsed = validate(fnCall.args);
  if (!parsed) throw new ParseError('invalid tool output', 502);
  return parsed;
}
