/**
 * Self-contained PDF preprocessing. A `PdfExtractionProvider` turns a PDF's raw
 * bytes into plain text for indexing. The default extracts the embedded text
 * layer only (fast, no native deps); swap in your own implementation for OCR of
 * scanned PDFs or richer layout-aware extraction.
 */
export interface PdfExtractionProvider {
  /** Extract text from a PDF's raw bytes. Returns "" if there's no text layer. */
  extractText(pdf: Uint8Array): Promise<string>;
}

/**
 * Text-layer PDF extraction via {@link https://npmjs.com/package/unpdf | unpdf}
 * (a pdf.js build with no native dependencies). Handles digital PDFs; scanned /
 * image-only PDFs have no text layer and yield "" — those need an OCR-backed
 * `PdfExtractionProvider`, left to the consumer to plug in.
 */
export class UnpdfExtractionProvider implements PdfExtractionProvider {
  async extractText(pdf: Uint8Array): Promise<string> {
    const { getDocumentProxy, extractText } = await import("unpdf");
    const doc = await getDocumentProxy(pdf);
    // With mergePages, unpdf returns the whole document's text as one string.
    const { text } = await extractText(doc, { mergePages: true });
    return text;
  }
}
