/** Word-start characters that earn a match bonus. */
const BOUNDARY = new Set([" ", "-", "_", "/", ".", ":"]);

export interface FuzzyMatch {
  score: number;
  /** Positions in `text` that matched, for highlighting. */
  indices: number[];
}

/**
 * Subsequence match of `query` against `text` (VS Code Ctrl+P style): every
 * query char must appear in order; consecutive runs and word-start hits rank
 * higher, spread-out matches and long labels rank slightly lower. Greedy
 * leftmost matching — not optimal alignment, but cheap and good enough.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return { score: 0, indices: [] };
  const indices: number[] = [];
  let score = 0;
  let from = 0;
  for (const ch of q) {
    const at = t.indexOf(ch, from);
    if (at < 0) return null;
    let bonus = 1;
    if (indices.length > 0 && at === indices[indices.length - 1] + 1) bonus += 4;
    if (at === 0 || BOUNDARY.has(t[at - 1])) bonus += 3;
    score += bonus;
    indices.push(at);
    from = at + 1;
  }
  score -= (indices[indices.length - 1] - indices[0] - indices.length + 1) * 0.5;
  score -= text.length * 0.01;
  return { score, indices };
}
