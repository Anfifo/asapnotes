/** Last segment of a root-relative note path. */
export const fileOf = (path: string) => path.split("/").pop() ?? path;

/** Project (first path segment) of a note path, or null for loose notes. */
export const projectOf = (path: string) => (path.includes("/") ? path.split("/")[0] : null);

/** Directory segments between the project and the file (deep external notes). */
export const subdirOf = (path: string) => path.split("/").slice(1, -1).join("/");

/**
 * Relative path from an absolute directory to an absolute file, with forward
 * slashes (markdown link form). Null when no relative path exists — different
 * Windows drives. Segments compare case-insensitively (Windows filesystems).
 */
export function relativePath(fromDir: string, toPath: string): string | null {
  const from = fromDir.replace(/\\/g, "/").split("/").filter(Boolean);
  const to = toPath.replace(/\\/g, "/").split("/").filter(Boolean);
  const drive = (s?: string) => (s && /^[a-z]:$/i.test(s) ? s.toLowerCase() : null);
  if (drive(from[0]) !== drive(to[0])) return null;
  let i = 0;
  while (i < from.length && i < to.length && from[i].toLowerCase() === to[i].toLowerCase()) i++;
  return "../".repeat(from.length - i) + to.slice(i).join("/");
}

/** Join an absolute base dir and a relative path, resolving `..` segments. */
export function resolvePath(baseDir: string, rel: string): string {
  const out: string[] = [];
  for (const seg of `${baseDir.replace(/\\/g, "/")}/${rel}`.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "" && seg !== ".") out.push(seg);
  }
  return out.join("/");
}
