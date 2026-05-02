// pdf-parse changed its export shape between v1 (default callable) and
// v2 ({ pdf } named export). The installed package version may differ from
// what @types/pdf-parse describes, so probe at load time and resolve to a
// callable function regardless of which shape is present.

type PdfFn = (buf: Buffer) => Promise<{ text: string }>;

// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-explicit-any
const _mod: any = require('pdf-parse');

const pdfParse: PdfFn =
  typeof _mod === 'function'
    ? _mod
    : typeof _mod?.pdf === 'function'
      ? _mod.pdf
      : typeof _mod?.default === 'function'
        ? _mod.default
        : typeof _mod?.default?.pdf === 'function'
          ? _mod.default.pdf
          : (() => {
              const shape =
                _mod && typeof _mod === 'object'
                  ? `keys=[${Object.keys(_mod).join(', ')}]`
                  : `typeof=${typeof _mod}`;
              throw new Error(`pdf-parse: no callable export found (${shape})`);
            })();

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
