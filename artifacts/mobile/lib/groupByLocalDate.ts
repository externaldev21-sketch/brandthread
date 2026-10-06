const dayLabelFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'short', day: 'numeric',
});
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** Bucket first; format once per day, not multiple times per list item. */
export function groupByLocalDate<T extends { createdAt: string }>(
  items: readonly T[],
  now = new Date(),
): { title: string; data: T[] }[] {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const todayKey = dayKey(now);
  const yesterdayKey = dayKey(yesterday);
  const buckets = new Map<string, { title: string; data: T[] }>();
  for (const item of items) {
    const date = new Date(item.createdAt);
    const key = dayKey(date);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        title: key === todayKey ? 'Today' : key === yesterdayKey ? 'Yesterday' : dayLabelFormatter.format(date),
        data: [],
      };
      buckets.set(key, bucket);
    }
    bucket.data.push(item);
  }
  return [...buckets.values()];
}
