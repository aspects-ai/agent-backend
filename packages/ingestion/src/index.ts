/**
 * @agentbe/ingestion
 *
 * Pluggable document preprocessing for the agent document room. Today: PDF text
 * extraction (self-contained `PdfExtractionProvider`, text-layer default). The
 * room runs a provider on ingest and commits the extracted text as a sibling
 * file so the existing text index makes it searchable.
 */

export type { PdfExtractionProvider } from "./pdf.js";
export { UnpdfExtractionProvider } from "./pdf.js";
