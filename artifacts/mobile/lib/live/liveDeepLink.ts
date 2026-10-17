/** Where a shared `/live/:streamId` link should land inside the app. */
export function liveDeepLinkHref(rawStreamId: string | string[] | undefined): string {
  const streamId = (Array.isArray(rawStreamId) ? rawStreamId[0] : rawStreamId)?.trim();
  return streamId ? `/live?streamId=${encodeURIComponent(streamId)}` : '/live';
}
