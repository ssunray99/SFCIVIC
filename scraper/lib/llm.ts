import Anthropic from '@anthropic-ai/sdk';
import { NEIGHBORHOODS, TOPICS, type Neighborhood, type Topic } from '@/lib/constants.ts';
import { SYSTEM_PROMPT, TOOL_NAME, TOOL_SCHEMA, PROMPT_VERSION } from '../prompts/extract.ts';

const MODEL = 'claude-haiku-4-5-20251001';
const MIN_TEXT_LENGTH = 200;
const MAX_TEXT_LENGTH = 50_000;

export type ExtractedItem = {
  position?: number | null;
  title: string;
  summary: string;
  item_type: 'hearing' | 'resolution' | 'ordinance' | 'informational' | 'other';
  district?: number | null;
  neighborhoods: Neighborhood[];
  topics: Topic[];
  addresses: string[];
  comment_deadline: string | null;   // ISO date or null
  comment_email: string | null;
  comment_portal_url: string | null;
  in_person_slot: string | null;
  matter_file_number: string | null; // Legistar/BOS file number, digits only
};

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

/**
 * Extracts structured agenda items from raw meeting text using Claude Haiku.
 * Returns an empty array if the text is too short or the model finds no items.
 * Never throws — errors are logged and an empty array is returned so one bad
 * meeting doesn't abort the whole scrape run.
 */
export async function extractAgendaItems(
  agendaText: string,
  meetingTitle: string,
): Promise<{ items: ExtractedItem[]; promptVersion: string; model: string }> {
  const empty = { items: [], promptVersion: PROMPT_VERSION, model: MODEL };

  const text = agendaText.trim();
  if (text.length < MIN_TEXT_LENGTH) {
    console.log(`[llm] text too short (${text.length} chars), skipping extraction`);
    return empty;
  }
  if (text.length > MAX_TEXT_LENGTH) {
    const dropped = text.length - MAX_TEXT_LENGTH;
    console.warn(
      `[llm] truncating "${meetingTitle}" — input ${text.length} chars exceeds cap ${MAX_TEXT_LENGTH}; ` +
      `dropping last ${dropped} chars (${Math.round((100 * dropped) / text.length)}%)`,
    );
  }

  try {
    const client = getClient();

    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      // Prompt caching: system prompt + tool schema are marked ephemeral.
      // After the first call in a run the cache is warm, cutting input cost ~90%.
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
          description: 'Record the structured agenda items extracted from the meeting text.',
          input_schema: TOOL_SCHEMA,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tool_choice: { type: 'tool', name: TOOL_NAME },
      messages: [
        {
          role: 'user',
          content: `Extract agenda items from this San Francisco civic meeting.\n\nMeeting: ${meetingTitle}\n\nAgenda text:\n${text.slice(0, MAX_TEXT_LENGTH)}`,
        },
      ],
    });

    const toolBlock = response.content.find((b) => b.type === 'tool_use');
    if (!toolBlock || toolBlock.type !== 'tool_use') {
      console.warn('[llm] no tool_use block in response');
      return empty;
    }

    const raw = toolBlock.input as { items?: unknown[] };
    const rawItems: unknown[] = Array.isArray(raw?.items) ? raw.items : [];

    const items: ExtractedItem[] = rawItems
      .filter((x): x is Record<string, unknown> => typeof x === 'object' && x !== null)
      .map((x) => ({
        position:           typeof x.position === 'number' ? x.position : null,
        title:              String(x.title ?? '').trim(),
        summary:            String(x.summary ?? '').trim(),
        item_type:          validateItemType(x.item_type),
        district:           typeof x.district === 'number' && x.district >= 1 && x.district <= 11
                              ? x.district
                              : null,
        // Drop any tag not in the closed enum — guards against hallucination
        neighborhoods:      filterEnum(x.neighborhoods, NEIGHBORHOODS as unknown as string[]) as Neighborhood[],
        topics:             filterEnum(x.topics, TOPICS as unknown as string[]) as Topic[],
        addresses:          stringArray(x.addresses),
        comment_deadline:   validateIsoDate(x.comment_deadline),
        comment_email:      nonEmptyString(x.comment_email),
        comment_portal_url: nonEmptyString(x.comment_portal_url),
        in_person_slot:     nonEmptyString(x.in_person_slot),
        matter_file_number: validateMatterFile(x.matter_file_number),
      }))
      .filter((item) => item.title.length > 0);

    const usage = response.usage as unknown as Record<string, number>;
    console.log(
      `[llm] ${items.length} item(s) extracted ` +
      `(in=${usage.input_tokens} cache_read=${usage.cache_read_input_tokens ?? 0} out=${usage.output_tokens})`,
    );

    return { items, promptVersion: PROMPT_VERSION, model: MODEL };
  } catch (err) {
    console.error('[llm] extraction failed:', err instanceof Error ? err.message : err);
    return empty;
  }
}

/** Strip HTML tags and collapse whitespace to plain text. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCharCode(Number(dec)))
    .replace(/\s+/g, ' ')
    .trim();
}

function validateItemType(v: unknown): ExtractedItem['item_type'] {
  const valid = ['hearing', 'resolution', 'ordinance', 'informational', 'other'] as const;
  return valid.includes(v as typeof valid[number]) ? (v as ExtractedItem['item_type']) : 'other';
}

function filterEnum(value: unknown, allowed: string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && allowed.includes(v));
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function validateIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  // YYYY-MM-DD; reject everything else so we never insert garbage into a date column.
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

function validateMatterFile(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // Strip any "File No." / "Matter" prefix the LLM may leave behind, plus whitespace.
  const stripped = value.replace(/^\s*(?:file(?:\s*no\.?)?|matter(?:\s*no\.?)?)\s*[:#]?\s*/i, '').trim();
  // SF BOS file numbers are 6 digits (year+sequence, e.g. 250604). Allow 5–7 to be safe;
  // Planning Commission/HPC sometimes use formats like "2024-001234CUA" — accept those too
  // by matching any sequence of digits, hyphens, and uppercase letters between 4–20 chars.
  return /^[A-Z0-9-]{4,20}$/.test(stripped) ? stripped : null;
}
