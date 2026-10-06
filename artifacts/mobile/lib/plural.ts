/**
 * "1 review" / "2 reviews". Counts are formatted with thousands separators.
 * Pass `pluralForm` for irregular words ("1 person" / "2 people").
 */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  const n = Number.isFinite(count) ? count : 0;
  return `${n.toLocaleString('en-US')} ${n === 1 ? singular : pluralForm}`;
}
