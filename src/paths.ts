/** Last segment of a root-relative note path. */
export const fileOf = (path: string) => path.split("/").pop() ?? path;

/** Project (first path segment) of a note path, or null for loose notes. */
export const projectOf = (path: string) => (path.includes("/") ? path.split("/")[0] : null);

/** Extensions the webview renders as a picture — such a target shows its own
 * content, so it is sized and treated differently from a file that can only
 * offer its name. */
export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

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

/** Characters Windows forbids in a name, plus the leading dot that would make
 * a note or project invisible to the walks that skip dot-entries. */
export const validFileName = (name: string) =>
  name.length > 0 && !name.startsWith(".") && !/[<>:"/\\|?*]/.test(name);

/** A project is one path segment, and never the shared assets folder. */
export const validProjectName = (name: string) => validFileName(name) && name !== "assets";

/** A forward-slash path in Windows form — for the clipboard and the shell. */
export const winPath = (path: string) => path.replace(/\//g, "\\");

/** Join an absolute base dir and a relative path, resolving `..` segments. */
export function resolvePath(baseDir: string, rel: string): string {
  const out: string[] = [];
  for (const seg of `${baseDir.replace(/\\/g, "/")}/${rel}`.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "" && seg !== ".") out.push(seg);
  }
  return out.join("/");
}
