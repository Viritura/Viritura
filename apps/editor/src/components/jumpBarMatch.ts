/** Simple subsequence match — every character of the query appears in order in the target. */
export function fuzzyMatch(query: string, target: string): boolean {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Score a match: lower is better. Prefers prefix matches, then exact substring, then fuzzy. */
export function matchScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.startsWith(q)) return 0; // Prefix match (best)
  if (t.includes(q)) return 1; // Substring match
  // Word-start match: query matches start of any word
  const words = t.split(/\s+/);
  for (const w of words) {
    if (w.startsWith(q)) return 2;
  }
  return 3; // Fuzzy only
}
