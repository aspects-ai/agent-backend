/** File extensions treated as embeddable text by default. Raw binaries (images,
 * PDFs, audio) are indexed via their committed derived-text siblings, which land
 * here as normal text files. */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".txt",
  ".text",
  ".csv",
  ".tsv",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".htm",
  ".rst",
  ".log",
]);

export function isEmbeddablePath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
}
