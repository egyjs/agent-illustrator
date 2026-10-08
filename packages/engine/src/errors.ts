/** Machine-readable error kinds. Every error also carries a hint that says how to fix the call (NFR-3). */
export type ErrorCode =
  | 'invalid_input'
  | 'unknown_op'
  | 'unknown_id'
  | 'invalid_reference'
  | 'invalid_color'
  | 'invalid_structure'
  | 'invalid_document'
  | 'limit_exceeded'
  | 'internal_error';

export type ErrorInfo = { readonly code: ErrorCode; readonly message: string; readonly hint: string };

export class EngineError extends Error {
  readonly code: ErrorCode;
  readonly hint: string;

  constructor(code: ErrorCode, message: string, hint: string) {
    super(message);
    this.name = 'EngineError';
    this.code = code;
    this.hint = hint;
  }

  get info(): ErrorInfo {
    return { code: this.code, message: this.message, hint: this.hint };
  }
}

/** Up to `max` candidates within edit distance max(2, ⌊length/3⌋) of `name`, ignoring case, nearest first. */
export function closest(name: string, candidates: Iterable<string>, max = 3): string[] {
  const limit = Math.max(2, Math.floor(name.length / 3));
  const scored: [string, number][] = [];
  for (const c of candidates) {
    const d = editDistance(name.toLowerCase(), c.toLowerCase());
    if (d <= limit) scored.push([c, d]);
  }
  scored.sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return scored.slice(0, max).map(([c]) => c);
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length]!;
}
