# @agentbe/ingestion

> Pluggable document ingestion for the agent document room — PDF text extraction today, swappable for OCR/layout-aware extraction later.

The room runs a `PdfExtractionProvider` on ingest and commits the extracted text as a sibling file, which the existing text index (`@agentbe/index-sync`) then makes searchable — this package has no dependency on index-sync or versioned-store itself, it just produces text.

## Interface

```typescript
export interface PdfExtractionProvider {
  /** Extract text from a PDF's raw bytes. Returns "" if there's no text layer. */
  extractText(pdf: Uint8Array): Promise<string>;
}
```

## `UnpdfExtractionProvider`

Extracts the embedded text layer via [`unpdf`](https://npmjs.com/package/unpdf) (a pdf.js build with no native dependencies). Handles digital PDFs; scanned/image-only PDFs have no text layer and yield `""` — plug in an OCR-backed `PdfExtractionProvider` for those.

```typescript
import { UnpdfExtractionProvider } from "@agentbe/ingestion";

const provider = new UnpdfExtractionProvider();
const text = await provider.extractText(pdfBytes);
```

## Tests

```bash
pnpm test:run
```

Extracts text from a real PDF fixture (shared with `@agentbe/versioned-store`'s test fixtures) and checks known content is present.
