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

/**
 * Downloads a URL and returns its raw bytes + final MIME type.
 * Uses fetch rather than Playwright for binary content (PDFs).
 *
 * Retries once on transient bad responses: empty body, or PDF content-type
 * with bytes that don't start with %PDF-. sf.gov has been observed returning
 * truncated/empty bodies under sustained scraping; retry resolves it.
 */
export async function fetchBytes(url: string): Promise<{
  bytes: Buffer;
  mime: 'text/html' | 'application/pdf';
}> {
  const ATTEMPTS = 2;
  let lastReason = '';

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
    const ct = res.headers.get('content-type') ?? '';
    const mime = ct.includes('pdf') ? 'application/pdf' : 'text/html';
    const bytes = Buffer.from(await res.arrayBuffer());

    if (bytes.length === 0) {
      lastReason = 'empty body';
    } else if (mime === 'application/pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      lastReason = `pdf content-type but no %PDF- magic (${bytes.length}B, first 8: ${bytes.subarray(0, 8).toString('hex')})`;
    } else {
      return { bytes, mime };
    }

    if (attempt < ATTEMPTS) {
      console.warn(`[fetchBytes] retry ${attempt}/${ATTEMPTS - 1}: ${lastReason} for ${url}`);
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  throw new Error(`bad response after ${ATTEMPTS} attempts (${lastReason}) for ${url}`);
}
