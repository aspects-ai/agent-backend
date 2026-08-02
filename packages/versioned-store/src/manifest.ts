import posix from "node:path/posix";

import type { ManifestEntry } from "./types.js";
import type { WorkingTree } from "./working-tree.js";

/** POSIX file-type bit test: is this mode a directory? */
function isDirectory(mode: number): boolean {
  return (mode & 0o170000) === 0o040000;
}

export interface WalkedFile {
  /** POSIX path relative to the tree root, no leading "./". */
  path: string;
  content: Uint8Array;
  mode: number;
}

/**
 * Recursively enumerate every regular file in a WorkingTree, reading its raw
 * bytes. Relies on stat().mode carrying POSIX type bits to distinguish
 * directories (which agent-backend backends provide).
 */
export async function walkFiles(tree: WorkingTree, dir = ""): Promise<WalkedFile[]> {
  const out: WalkedFile[] = [];
  const names = await tree.readdir(dir === "" ? "." : dir);
  for (const name of names) {
    const path = dir === "" ? name : posix.join(dir, name);
    const st = await tree.stat(path);
    if (isDirectory(st.mode)) {
      out.push(...(await walkFiles(tree, path)));
    } else {
      const content = (await tree.read(path)) as Uint8Array;
      out.push({ path, content, mode: st.mode });
    }
  }
  return out;
}

/**
 * Per-file last-writer-wins merge. Starts from the concurrent HEAD's entries
 * (`theirs`) and applies the committer's changes relative to `base` on top:
 * paths the committer added or modified overwrite theirs; paths the committer
 * deleted are removed. Non-conflicting concurrent changes are preserved.
 */
export function lwwMerge(
  theirs: Record<string, ManifestEntry>,
  mine: Record<string, ManifestEntry>,
  base: Record<string, ManifestEntry>,
): Record<string, ManifestEntry> {
  const merged: Record<string, ManifestEntry> = { ...theirs };
  // Paths I added or modified relative to base win.
  for (const [path, entry] of Object.entries(mine)) {
    const b = base[path];
    if (!b || b.hash !== entry.hash) merged[path] = entry;
  }
  // Paths I deleted relative to base are removed.
  for (const path of Object.keys(base)) {
    if (!(path in mine)) delete merged[path];
  }
  return merged;
}
