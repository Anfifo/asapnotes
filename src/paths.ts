/** Last segment of a root-relative note path. */
export const fileOf = (path: string) => path.split("/").pop() ?? path;

/** Project (first path segment) of a note path, or null for loose notes. */
export const projectOf = (path: string) => (path.includes("/") ? path.split("/")[0] : null);

/** Directory segments between the project and the file (deep external notes). */
export const subdirOf = (path: string) => path.split("/").slice(1, -1).join("/");

/** Join an absolute base dir and a relative path, resolving `..` segments. */
export function resolvePath(baseDir: string, rel: string): string {
  const out: string[] = [];
  for (const seg of `${baseDir.replace(/\\/g, "/")}/${rel}`.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "" && seg !== ".") out.push(seg);
  }
  return out.join("/");
}
