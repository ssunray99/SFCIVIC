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
  // Reject obviously-bad inputs before pdf-parse — its native error
  // ("stream must have data" / "Invalid PDF structure") is opaque.
  if (bytes.length === 0) {
    console.warn('[pdf] empty bytes — skipping parse');
    return { text: '', needsOcr: true };
  }
  if (!bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
    console.warn(
      `[pdf] not a PDF (${bytes.length} bytes, first 8: ${bytes.subarray(0, 8).toString('hex')})`,
    );
    return { text: '', needsOcr: true };
  }

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
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[pdf] parse error (${bytes.length} bytes): ${msg}`);
    return { text: '', needsOcr: true };
  }
}
