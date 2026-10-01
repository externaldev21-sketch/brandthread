/**
 * Character-count middle-truncation, used alongside (not instead of) RN's
 * own `ellipsizeMode="middle"` on `<Text numberOfLines={1}>`. Native RN
 * measures pixel width and truncates precisely; react-native-web does not
 * implement `ellipsizeMode` at all, so on web a long string past its box
 * just gets silently clipped by `overflow: hidden` with no "…" — this gives
 * every platform the same graceful, truncated string up front so neither
 * relies solely on the other.
 */
export function middleTruncate(text: string, maxLength = 28): string {
  if (text.length <= maxLength) return text;
  const keep = maxLength - 1; // reserve one character for the ellipsis
  const front = Math.ceil(keep * 0.6);
  const back = keep - front;
  return `${text.slice(0, front)}…${text.slice(text.length - back)}`;
}
