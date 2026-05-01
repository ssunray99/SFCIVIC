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
 */
export async function fetchBytes(url: string): Promise<{
  bytes: Buffer;
  mime: 'text/html' | 'application/pdf';
}> {
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
  return { bytes, mime };
}
