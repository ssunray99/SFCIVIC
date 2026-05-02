import Anthropic from '@anthropic-ai/sdk';
import { NEIGHBORHOODS, TOPICS, type Neighborhood, type Topic } from '@/lib/constants.ts';
import { SYSTEM_PROMPT, TOOL_NAME, TOOL_SCHEMA, PROMPT_VERSION } from '../prompts/extract.ts';

const MODEL = 'claude-haiku-4-5-20251001';
const MIN_TEXT_LENGTH = 200;

export type ExtractedItem = {
  position?: number | null;
  title: string;
  summary: string;
  item_type: 'hearing' | 'resolution' | 'ordinance' | 'informational' | 'other';
  district?: number | null;
  neighborhoods: Neighborhood[];
  topics: Topic[];
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
          content: `Extract agenda items from this San Francisco civic meeting.\n\nMeeting: ${meetingTitle}\n\nAgenda text:\n${text.slice(0, 50_000)}`,
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
        position:      typeof x.position === 'number' ? x.position : null,
        title:         String(x.title ?? '').trim(),
        summary:       String(x.summary ?? '').trim(),
        item_type:     validateItemType(x.item_type),
        district:      typeof x.district === 'number' && x.district >= 1 && x.district <= 11
                         ? x.district
                         : null,
        // Drop any tag not in the closed enum — guards against hallucination
        neighborhoods: filterEnum(x.neighborhoods, NEIGHBORHOODS as unknown as string[]) as Neighborhood[],
        topics:        filterEnum(x.topics, TOPICS as unknown as string[]) as Topic[],
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
    .replace(/&#\d+;/g, '')
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
