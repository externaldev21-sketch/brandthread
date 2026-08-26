/**
 * Shared normalization for user-facing substring searches.
 *
 * PostgreSQL's pg_trgm indexes can accelerate the resulting `%term%`
 * predicates. Escaping wildcard characters keeps the endpoint's behavior
 * literal and prevents a user-supplied `%` or `_` from broadening a search.
 */
export function normalizeSearchTerm(value: unknown, maxLength = 100): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, maxLength);
}

export function containsSearchPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}