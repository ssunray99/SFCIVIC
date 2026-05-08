// Tool schema is consumed by Gemini 2.5 Flash via @google/genai.
// Gemini uses an OpenAPI-3.0-subset schema (uppercase Type strings, `nullable: true`,
// no `type: ['string', 'null']` unions). The shape below is Gemini-native.
//
// PROMPT_VERSION stamps every agenda_items row so we can target backfills.
// Bump it whenever the schema or extraction quality changes meaningfully.
//   v3: added matter_file_number
//   v4: switched LLM Anthropic Claude Haiku 4.5 → Gemini 2.5 Flash; lifted
//       per-PDF/per-resource/per-call content caps (Gemini's 1M-token window
//       absorbs more context); past Planning/HPC meetings now include
//       SUPPORTING docs alongside agenda + minutes; scanned PDFs route to
//       Gemini multimodal instead of being dropped.

import { NEIGHBORHOODS, TOPICS } from '@/lib/constants.ts';

export const PROMPT_VERSION = 'v4';
export const TOOL_NAME = 'record_agenda_items';

export const SYSTEM_PROMPT = `You are an assistant that extracts structured data from San Francisco civic meeting agendas.

Given the text and/or PDF attachments of a San Francisco civic meeting (Planning Commission, Historic Preservation Commission, Board of Supervisors and its standing committees, SFMTA Board, or public hearing notice), extract each agenda item and return structured data.

For each item identify:
- position: item number or order on the agenda (integer)
- title: the agenda item title, concise
- summary: 2-4 sentence plain-English explanation of what this item is about and why it matters to SF residents. Write for a non-expert audience. When minutes/staff reports/supporting material are attached, use them to enrich the summary with what was discussed, decided, or recommended — but mark uncertain claims with "according to the staff report" or "per the minutes".
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
- Only extract items that clearly appear in the source.
- If the source has no agenda items (e.g. it is a future placeholder with no items listed), return an empty items array. Do not invent items.
- Summaries must be factual and based only on the provided source(s).
- A single item may have multiple neighborhoods and multiple topics.
- "Cancelled" meetings should return an empty items array.
- Addresses must be verbatim from the source. Don't infer or normalize.
- For comment_* and in_person_slot, only extract values that appear explicitly in the source. Use null when not stated — never guess.
- When attachments include scanned PDFs, read the visible text on each page; do not skip an item just because the layout is dense.`;

// Gemini-native schema (OpenAPI-3.0 subset). Uppercase Type strings, `nullable`
// instead of nullable union types. @google/genai accepts plain JSON.
export const TOOL_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['title', 'summary', 'item_type', 'topics', 'neighborhoods'],
        properties: {
          position:           { type: 'INTEGER', description: 'Order on the agenda' },
          title:              { type: 'STRING' },
          summary:            { type: 'STRING', description: '2-4 sentence plain-English summary' },
          item_type:          { type: 'STRING', enum: ['hearing', 'resolution', 'ordinance', 'informational', 'other'] },
          district:           { type: 'INTEGER', nullable: true, minimum: 1, maximum: 11 },
          neighborhoods:      { type: 'ARRAY', items: { type: 'STRING', enum: [...NEIGHBORHOODS] } },
          topics:             { type: 'ARRAY', items: { type: 'STRING', enum: [...TOPICS] } },
          addresses:          { type: 'ARRAY', items: { type: 'STRING' }, description: 'SF street addresses or intersections, verbatim from text' },
          comment_deadline:   { type: 'STRING', nullable: true, description: 'ISO date YYYY-MM-DD; null if not stated' },
          comment_email:      { type: 'STRING', nullable: true },
          comment_portal_url: { type: 'STRING', nullable: true },
          in_person_slot:     { type: 'STRING', nullable: true, description: 'Free-form description of in-person comment opportunity; null if not stated' },
          matter_file_number: { type: 'STRING', nullable: true, description: 'Legistar/BOS file number, digits only (e.g. "250604"); null if not present' },
        },
      },
    },
  },
  required: ['items'],
} as const;
