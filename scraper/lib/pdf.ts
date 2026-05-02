// pdf-parse v1.1.1 is pinned: it has a stable default-callable export
// (pdfParse(buf) → { text }). v2 ships an incompatible class-based API
// that doesn't match @types/pdf-parse, so we stay on v1.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;

const MIN_TEXT_LENGTH = 500;

export type PdfResult = {
  text: string;
  needsOcr: boolean;
};

export async function extractPdfText(bytes: Buffer): Promise<PdfResult> {
  try {
    const data = await pdfParse(bytes);
    const text = data.text.trim();
    return {
      text,
      // Scanned/image-only PDFs produce very little extractable text.
      // Flag them rather than feeding garbage to the LLM.
      needsOcr: text.length < MIN_TEXT_LENGTH,
    };
  } catch (err) {
    console.warn('[pdf] parse error:', err instanceof Error ? err.message : String(err));
    return { text: '', needsOcr: true };
  }
}
