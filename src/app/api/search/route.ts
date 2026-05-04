// JSON wrapper around the shared parser in src/lib/search/parse-query.ts.
// Useful for scripting / external clients that want filter parsing without
// the full /ask synthesis step (which lives at src/app/ask/page.tsx).

import { parseQuery, ParseError } from '@/lib/search/parse-query';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q') ?? '';

  try {
    const parsed = await parseQuery(q);
    return Response.json(parsed);
  } catch (err) {
    if (err instanceof ParseError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
