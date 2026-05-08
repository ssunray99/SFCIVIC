import { chromium, type Browser, type BrowserContext } from 'playwright';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

/** Creates a new browser context with a realistic User-Agent. */
export async function newContext(): Promise<BrowserContext> {
  const b = await getBrowser();
  return b.newContext({
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: { Accept: 'text/html,application/pdf,*/*' },
  });
}

export type FetchOk = {
  ok: true;
  bytes: Buffer;
  mime: 'text/html' | 'application/pdf';
};

export type FetchFail = {
  ok: false;
  status: number | null;       // null when the failure was network-level (no HTTP response)
  url: string;
  attempts: number;
  message: string;
};

export type FetchResult = FetchOk | FetchFail;

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [200, 800, 2400] as const;
const TIMEOUT_MS = 30_000;

/**
 * Downloads a URL and returns either the raw bytes + MIME type or a
 * structured failure descriptor. Retries up to 3 attempts on transient
 * errors (5xx, 429, network); 4xx other than 429 fail fast.
 *
 * Callers used to call `fetchBytes(url)` and have it throw on non-200,
 * which made partial PDF gathers silent. The structured return lets
 * each source surface per-link failures into meeting.fetch_warnings.
 */
export async function fetchBytes(url: string): Promise<FetchResult> {
  let lastStatus: number | null = null;
  let lastMessage = '';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, {
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
              '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (res.ok) {
        const ct = res.headers.get('content-type') ?? '';
        const mime = ct.includes('pdf') ? 'application/pdf' : 'text/html';
        const bytes = Buffer.from(await res.arrayBuffer());
        return { ok: true, bytes, mime };
      }

      lastStatus = res.status;
      lastMessage = `HTTP ${res.status} fetching ${url}`;
      // Retry only on transient HTTP statuses.
      if (res.status >= 500 || res.status === 429 || res.status === 408) {
        if (attempt < MAX_ATTEMPTS) {
          await sleep(BACKOFF_MS[attempt - 1] + Math.floor(Math.random() * BACKOFF_MS[attempt - 1]));
          continue;
        }
      }
      break;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lastStatus = null;
      lastMessage = `network: ${msg}`;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BACKOFF_MS[attempt - 1] + Math.floor(Math.random() * BACKOFF_MS[attempt - 1]));
        continue;
      }
    }
  }

  return {
    ok: false,
    status: lastStatus,
    url,
    attempts: MAX_ATTEMPTS,
    message: lastMessage || 'unknown fetch error',
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
