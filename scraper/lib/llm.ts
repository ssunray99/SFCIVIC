// LLM extraction via Google Gemini 2.5 Flash (@google/genai).
//
// Notes for future maintainers:
//   - Gemini 2.5 Flash has a 1M-token context window, so the per-call
//     truncation cap is much higher than under Claude Haiku 4.5.
//   - We do NOT use Gemini explicit context caching: it requires a 1024-token
//     minimum and our system prompt + tool schema are well below that. Flash
//     pricing is already low enough that the missing cache is a non-issue.
//   - Forced structured output uses the function-calling "ANY" mode with a
//     single allowed function (TOOL_NAME). The model returns the call args
//     as a JSON object that maps directly to TOOL_SCHEMA.
//   - Transient errors (5xx, 429, network) are retried with full-jitter
//     backoff. Hard failures (4xx schema/auth errors) are not retried — they
//     bubble out to the pipeline so the meeting is marked extraction_status
//     = 'failed' rather than silently extracted as 0 items.
//   - Scanned PDFs route to extractAgendaItemsMultimodal which sends the PDF
//     bytes inline and lets Gemini do native multimodal extraction.

import { GoogleGenAI, FunctionCallingConfigMode } from '@google/genai';
import { NEIGHBORHOODS, TOPICS, type Neighborhood, type Topic } from '@/lib/constants.ts';
import { SYSTEM_PROMPT, TOOL_NAME, TOOL_SCHEMA, PROMPT_VERSION } from '../prompts/extract.ts';

const MODEL = 'gemini-2.5-flash';
const MIN_TEXT_LENGTH = 200;
// Gemini Flash 2.5 has a 1M-token window; raise the cap from the v3-era
// 50k-char Claude limit. 500k chars ≈ 125k tokens, well within budget.
const MAX_TEXT_LENGTH = 500_000;
const MAX_OUTPUT_TOKENS = 16_384;

// Retry policy for transient failures.
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [250, 1000, 4000] as const;

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

export type ExtractionResult = {
  items: ExtractedItem[];
  promptVersion: string;
  model: string;
};

let _client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY is not set');
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

/**
 * Extracts structured agenda items from raw meeting text using Gemini 2.5 Flash.
 *
 * Returns an empty array when the text is shorter than MIN_TEXT_LENGTH (the
 * caller passed an empty/near-empty buffer — there's nothing to extract).
 *
 * Throws on hard failure after exhausted retries. Callers (extract-pipeline)
 * catch the throw and mark the meeting `extraction_status = 'failed'` so it
 * can be retried on a future run.
 */
export async function extractAgendaItems(
  agendaText: string,
  meetingTitle: string,
): Promise<ExtractionResult> {
  const text = agendaText.trim();
  if (text.length < MIN_TEXT_LENGTH) {
    console.log(`[llm] text too short (${text.length} chars), skipping extraction`);
    return { items: [], promptVersion: PROMPT_VERSION, model: MODEL };
  }
  if (text.length > MAX_TEXT_LENGTH) {
    const dropped = text.length - MAX_TEXT_LENGTH;
    console.warn(
      `[llm] truncating "${meetingTitle}" — input ${text.length} chars exceeds cap ${MAX_TEXT_LENGTH}; ` +
      `dropping last ${dropped} chars (${Math.round((100 * dropped) / text.length)}%)`,
    );
  }

  const userText =
    `Extract agenda items from this San Francisco civic meeting.\n\n` +
    `Meeting: ${meetingTitle}\n\nAgenda text:\n${text.slice(0, MAX_TEXT_LENGTH)}`;

  return runGemini([{ text: userText }], meetingTitle);
}

/**
 * Multimodal variant: sends agenda text plus inline PDF bytes (for scanned
 * documents that pdf-parse couldn't read). Gemini extracts native text from
 * the PDFs, sidestepping the OCR plumbing we'd otherwise need.
 *
 * Each PDF block is capped at ~7 MB by the API; we cap inline payloads at
 * 5 attached PDFs and trim if the total bytes go above ~15 MB to keep request
 * latency reasonable.
 */
export async function extractAgendaItemsMultimodal(
  agendaText: string,
  pdfs: Array<{ label: string; bytes: Buffer }>,
  meetingTitle: string,
): Promise<ExtractionResult> {
  const text = agendaText.trim();
  if (text.length < MIN_TEXT_LENGTH && pdfs.length === 0) {
    console.log(`[llm:multimodal] no usable input, skipping`);
    return { items: [], promptVersion: PROMPT_VERSION, model: MODEL };
  }

  // Trim if the PDF payload exceeds budget. Keep the largest five so the
  // model still gets coverage of the meeting's main attachments.
  const MAX_PDFS = 5;
  const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
  const sorted = [...pdfs].sort((a, b) => b.bytes.length - a.bytes.length).slice(0, MAX_PDFS);
  const kept: Array<{ label: string; bytes: Buffer }> = [];
  let totalBytes = 0;
  for (const p of sorted) {
    if (totalBytes + p.bytes.length > MAX_TOTAL_BYTES) break;
    kept.push(p);
    totalBytes += p.bytes.length;
  }

  const userText =
    `Extract agenda items from this San Francisco civic meeting. The meeting ` +
    `text below may be sparse (it failed text-only PDF parsing); extract what ` +
    `you can from the attached PDFs as well.\n\n` +
    `Meeting: ${meetingTitle}\n\n` +
    `Available text:\n${text.slice(0, MAX_TEXT_LENGTH)}\n\n` +
    `Attached PDF labels: ${kept.map((p) => p.label).join(', ') || '(none)'}`;

  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [
    { text: userText },
  ];
  for (const pdf of kept) {
    parts.push({
      inlineData: { mimeType: 'application/pdf', data: pdf.bytes.toString('base64') },
    });
  }

  return runGemini(parts, meetingTitle);
}

type ContentPart = { text?: string; inlineData?: { mimeType: string; data: string } };

async function runGemini(parts: ContentPart[], meetingTitle: string): Promise<ExtractionResult> {
  const client = getClient();

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await client.models.generateContent({
        model: MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          tools: [
            {
              functionDeclarations: [
                {
                  name: TOOL_NAME,
                  description: 'Record the structured agenda items extracted from the meeting source.',
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

      const items = parseToolCall(response);
      const usage = (response.usageMetadata ?? {}) as Record<string, number>;
      console.log(
        `[llm] ${items.length} item(s) extracted ` +
        `(in=${usage.promptTokenCount ?? 0} out=${usage.candidatesTokenCount ?? 0} total=${usage.totalTokenCount ?? 0})`,
      );
      return { items, promptVersion: PROMPT_VERSION, model: MODEL };
    } catch (err) {
      lastErr = err;
      if (!isTransient(err) || attempt === MAX_ATTEMPTS) break;
      const wait = BACKOFF_MS[attempt - 1] + Math.floor(Math.random() * BACKOFF_MS[attempt - 1]);
      console.warn(
        `[llm] attempt ${attempt}/${MAX_ATTEMPTS} failed for "${meetingTitle}" (${describeError(err)}); ` +
        `retrying in ${wait}ms`,
      );
      await sleep(wait);
    }
  }

  // Final failure: bubble out so the pipeline can mark the meeting failed.
  const msg = describeError(lastErr);
  console.error(`[llm] giving up on "${meetingTitle}" after ${MAX_ATTEMPTS} attempt(s): ${msg}`);
  throw new Error(`Gemini extraction failed after ${MAX_ATTEMPTS} attempts: ${msg}`);
}

function parseToolCall(response: unknown): ExtractedItem[] {
  // @google/genai shapes responses as { candidates: [{ content: { parts: [...] }, finishReason }] }.
  // The function call lands in a part with shape { functionCall: { name, args } }.
  const r = response as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ functionCall?: { name?: string; args?: unknown } }>;
      };
      finishReason?: string;
    }>;
  };

  const candidate = r.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const fnCall = parts.find((p) => p.functionCall && p.functionCall.name === TOOL_NAME)?.functionCall;
  if (!fnCall) {
    // No function call returned. This happens when:
    //   - finishReason is SAFETY / BLOCKLIST / PROHIBITED_CONTENT (model refused)
    //   - finishReason is MAX_TOKENS (response truncated before any tokens emitted —
    //     observed once on a 130k-input HPC meeting in a v4 smoke run)
    //   - upstream hiccup with no candidates at all
    // Throw so the retry loop fires; if it fails 3× the pipeline marks the
    // meeting extraction_status='failed' rather than silently writing 0 items.
    const reason = candidate?.finishReason ?? 'UNKNOWN';
    throw new Error(`Gemini returned no ${TOOL_NAME} call (finishReason=${reason})`);
  }

  const raw = (fnCall.args as { items?: unknown[] }) ?? {};
  const rawItems: unknown[] = Array.isArray(raw.items) ? raw.items : [];

  return rawItems
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
}

function isTransient(err: unknown): boolean {
  if (!err) return false;
  // @google/genai surfaces an .status field on its error type for HTTP errors.
  // Fall back to message-string heuristics for network errors that have no status.
  const e = err as { status?: number; code?: string | number; message?: string };
  if (typeof e.status === 'number') {
    return e.status >= 500 || e.status === 429 || e.status === 408;
  }
  const msg = (e.message ?? String(err)).toLowerCase();
  return (
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('enotfound') ||
    msg.includes('socket hang up') ||
    msg.includes('fetch failed') ||
    msg.includes('rate limit') ||
    msg.includes('overloaded') ||
    msg.includes('unavailable') ||
    msg.includes('internal') && msg.includes('error')
  );
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
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
