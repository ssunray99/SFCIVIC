import { NEIGHBORHOODS, TOPICS } from '@/lib/constants.ts';

export const PROMPT_VERSION = 'v3';
export const TOOL_NAME = 'record_agenda_items';

export const SYSTEM_PROMPT = `You are an assistant that extracts structured data from San Francisco civic meeting agendas.

Given the text of a San Francisco civic meeting agenda (Planning Commission, Board of Supervisors, or public hearing notice), extract each agenda item and return structured data.

For each item identify:
- position: item number or order on the agenda (integer)
- title: the agenda item title, concise
- summary: 2-4 sentence plain-English explanation of what this item is about and why it matters to SF residents. Write for a non-expert audience.
- item_type: classify as one of: hearing, resolution, ordinance, informational, other
- district: the SF supervisor district number (1–11) if this item concerns a specific location, or null if citywide
- neighborhoods: which SF neighborhoods are affected — use ONLY names from the provided enum
- topics: which topics apply — use ONLY values from the provided enum
- addresses: any San Francisco street addresses or intersections in this item, verbatim from the text. Examples: "1234 Mission St", "Folsom & 6th". Empty array if citywide or no specific location.
- comment_deadline: ISO date (YYYY-MM-DD) by which written public comment must be submitted, or null if not stated.
- comment_email: email address for submitting written comment on this item, or null if not stated.
- comment_portal_url: URL of an online comment portal for this item, or null if not stated.
- in_person_slot: free-form description of the in-person comment opportunity (date, time, room/location), or null if not stated. Example: "Tuesday May 12, 1:30pm, City Hall Room 400".
- matter_file_number: the Legistar / Board of Supervisors file number for this item if one appears in the text, otherwise null. SF BOS agendas typically print this as a 6-digit number near the item, sometimes prefixed with "File No.", "File", or "Matter No." (e.g. "250604", "File No. 231256"). Strip the prefix and return only the file number itself as a string. Planning Commission and HPC items usually do NOT have file numbers — return null in that case. Use the EXACT digits from the text; do not guess or invent.

Neighborhoods you may use: ${NEIGHBORHOODS.join(', ')}

Topics you may use: ${TOPICS.join(', ')}

Rules:
- Only extract items that clearly appear in the agenda text.
- If the text has no agenda items (e.g. it is a future placeholder with no items listed), return an empty items array. Do not invent items.
- Summaries must be factual and based only on the provided text.
- A single item may have multiple neighborhoods and multiple topics.
- "Cancelled" meetings should return an empty items array.
- Addresses must be verbatim from the source. Don't infer or normalize.
- For comment_* and in_person_slot, only extract values that appear explicitly in the text. Use null when not stated — never guess.`;

export const TOOL_SCHEMA = {
  type: 'object' as const,
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'summary', 'item_type', 'topics', 'neighborhoods'],
        properties: {
          position:           { type: 'integer', description: 'Order on the agenda' },
          title:              { type: 'string' },
          summary:            { type: 'string', description: '2-4 sentence plain-English summary' },
          item_type:          { type: 'string', enum: ['hearing', 'resolution', 'ordinance', 'informational', 'other'] },
          district:           { type: ['integer', 'null'], minimum: 1, maximum: 11 },
          neighborhoods:      { type: 'array', items: { type: 'string', enum: [...NEIGHBORHOODS] } },
          topics:             { type: 'array', items: { type: 'string', enum: [...TOPICS] } },
          addresses:          { type: 'array', items: { type: 'string' }, description: 'SF street addresses or intersections, verbatim from text' },
          comment_deadline:   { type: ['string', 'null'], description: 'ISO date YYYY-MM-DD; null if not stated' },
          comment_email:      { type: ['string', 'null'] },
          comment_portal_url: { type: ['string', 'null'] },
          in_person_slot:     { type: ['string', 'null'], description: 'Free-form description of in-person comment opportunity; null if not stated' },
          matter_file_number: { type: ['string', 'null'], description: 'Legistar/BOS file number, digits only (e.g. "250604"); null if not present' },
        },
      },
    },
  },
  required: ['items'],
};
