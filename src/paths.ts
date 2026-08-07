/** Join an absolute base dir and a relative path, resolving `..` segments. */
export function resolvePath(baseDir: string, rel: string): string {
  const out: string[] = [];
  for (const seg of `${baseDir.replace(/\\/g, "/")}/${rel}`.split("/")) {
    if (seg === "..") out.pop();
    else if (seg !== "" && seg !== ".") out.push(seg);
  }
  return out.join("/");
}
