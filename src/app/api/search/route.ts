// Thin JSON wrapper around the shared parser. The /ask page calls parseQuery
// directly (server-rendered); this endpoint exists for any client-side caller
// that wants the URL-filter mapping without committing to navigation to /ask.

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
    console.error('[search] unexpected:', err instanceof Error ? err.message : err);
    return Response.json({ error: 'parse failed' }, { status: 502 });
  }
}
