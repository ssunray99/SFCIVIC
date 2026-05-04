// Q&A synthesizer for the /ask flow.
//
// Given the user's question + a list of matched agenda items, ask Claude
// Haiku 4.5 to write a 2–4 sentence narrative answer with [N] citations
// pointing back to the items. The /ask page renders the answer above the
// item list and turns each [N] into a link/anchor.
//
// Server-only.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5-20251001';

let _client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

const SYSTEM_PROMPT = `You answer questions about San Francisco civic activity by reading agenda items extracted from official meeting agendas.

The user asks a question; you receive a numbered list of relevant agenda items. Write a concise, plain-English answer in 2–4 sentences that directly addresses the question, citing items by [N] markers.

Rules:
- Only state facts you can support from the items provided. Do not invent details.
- Cite specific items inline with [N] (e.g. "The Board approved a 12-unit project on Mission St [3].").
- If the items don't answer the question, say so plainly in one sentence and suggest how the user might refine their search. Do not pad the answer.
- Lead with the most useful information. No preamble like "Based on the items provided…" or "Here is what I found:".
- Don't list every item — synthesize. Mention 2–5 specific items by [N] that best answer the question.
- Use neutral, factual tone. No editorializing about whether something is good or bad.
- Keep it short — the user can read the items themselves below.`;

export type ItemContext = {
  index: number; // 1-based for citations
  title: string;
  summary: string | null;
  source: string;
  meetingDate: string;
  district: number | null;
  neighborhoods: string[];
  topics: string[];
};

function formatItem(it: ItemContext): string {
  const loc: string[] = [];
  if (it.district != null) loc.push(`District ${it.district}`);
  if (it.neighborhoods.length > 0) loc.push(it.neighborhoods.join(', '));
  if (loc.length === 0) loc.push('Citywide');

  const summary = it.summary ? it.summary.replace(/\s+/g, ' ').trim().slice(0, 400) : '(no summary)';
  const topics = it.topics.length > 0 ? ` · topics: ${it.topics.join(', ')}` : '';
  return `[${it.index}] ${it.title}\n    Source: ${it.source} · Meeting: ${it.meetingDate} · ${loc.join(' · ')}${topics}\n    ${summary}`;
}

export async function synthesizeAnswer(
  question: string,
  items: ItemContext[],
): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not set');
  }

  if (items.length === 0) {
    return "I couldn't find any agenda items matching that. Try broadening the topic, neighborhood, or date range.";
  }

  const itemsBlock = items.map(formatItem).join('\n\n');
  const userMessage = `Question: ${question}\n\nMatching agenda items:\n\n${itemsBlock}`;

  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 600,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return "I couldn't generate an answer for that. The matching items are listed below.";
  }
  return textBlock.text.trim();
}
