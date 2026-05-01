// pdf-parse is CommonJS; this wrapper keeps the rest of the scraper in ESM-style imports.
// pdf-parse ships CommonJS; skipLibCheck in tsconfig covers the missing types.
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
  } catch {
    return { text: '', needsOcr: true };
  }
}
