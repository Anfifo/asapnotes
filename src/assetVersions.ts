/**
 * Version stamps for image files the app rewrites in place (the annotation
 * flatten): the webview caches asset-protocol responses by URL, so every
 * image resolver appends `?v=N` once a file has been rewritten. Module-local
 * state rather than React state — resolvers consult it at render time, and
 * the surfaces showing a stale image are unmounted while the rewrite happens
 * (the annotation lens is a tab of its own).
 *
 * Keys are absolute paths with forward slashes — `resolvePath`'s own form.
 */

const versions = new Map<string, number>();

export const bumpAssetVersion = (abs: string) => versions.set(abs, (versions.get(abs) ?? 0) + 1);

/** The URL to actually load `abs` from — `url` untouched until a rewrite. */
export const bustAsset = (abs: string, url: string) => {
  const v = versions.get(abs);
  return v ? `${url}?v=${v}` : url;
};
