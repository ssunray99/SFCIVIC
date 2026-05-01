import { NEIGHBORHOODS, TOPICS } from '@/lib/constants.ts';

export const PROMPT_VERSION = 'v1';
export const TOOL_NAME = 'record_agenda_items';

export const SYSTEM_PROMPT = `You are an assistant that extracts structured data from San Francisco civic meeting agendas.

Given the text of a Planning Commission hearing agenda, extract each agenda item and return structured data.

For each item identify:
- position: item number or order on the agenda (integer)
- title: the agenda item title, concise
- summary: 2-4 sentence plain-English explanation of what this item is about and why it matters to SF residents. Write for a non-expert audience.
- item_type: classify as one of: hearing, resolution, ordinance, informational, other
- district: the SF supervisor district number (1–11) if this item concerns a specific location, or null if citywide
- neighborhoods: which SF neighborhoods are affected — use ONLY names from the provided enum
- topics: which topics apply — use ONLY values from the provided enum

Neighborhoods you may use: ${NEIGHBORHOODS.join(', ')}

Topics you may use: ${TOPICS.join(', ')}

Rules:
- Only extract items that clearly appear in the agenda text.
- If the text has no agenda items (e.g. it is a future placeholder with no items listed), return an empty items array. Do not invent items.
- Summaries must be factual and based only on the provided text.
- A single item may have multiple neighborhoods and multiple topics.
- "Cancelled" meetings should return an empty items array.`;

export const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'summary', 'item_type', 'topics', 'neighborhoods'],
        properties: {
          position:      { type: 'integer', description: 'Order on the agenda' },
          title:         { type: 'string' },
          summary:       { type: 'string', description: '2-4 sentence plain-English summary' },
          item_type:     { type: 'string', enum: ['hearing', 'resolution', 'ordinance', 'informational', 'other'] },
          district:      { type: ['integer', 'null'], minimum: 1, maximum: 11 },
          neighborhoods: { type: 'array', items: { type: 'string', enum: [...NEIGHBORHOODS] } },
          topics:        { type: 'array', items: { type: 'string', enum: [...TOPICS] } },
        },
      },
    },
  },
  required: ['items'],
};
