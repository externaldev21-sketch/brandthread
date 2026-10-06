/**
 * Redirects for link shapes that were shared publicly but have no matching
 * Expo Router route. Pure: (pathname, search) -> target path+query, or null.
 *
 * - /live/<streamId>         -> /live?streamId=<streamId>  (app/live.tsx reads
 *   ?streamId=/?hostId=; older live-feed builds shared the path form)
 * - /creator-program/join?.. -> /creator-program-join?..   (the API builds
 *   program links with the slash form; the app screen is creator-program-join)
 *
 * Any existing query string is kept.
 */
function legacyRedirectTarget(pathname, search = '') {
  const params = new URLSearchParams(search || '');
  const live = /^\/live\/([^/]+)\/?$/.exec(pathname || '');
  if (live) {
    params.set('streamId', live[1]);
    return `/live?${params.toString()}`;
  }
  if (/^\/creator-program\/join\/?$/.test(pathname || '')) {
    const query = params.toString();
    return `/creator-program-join${query ? `?${query}` : ''}`;
  }
  return null;
}

module.exports = { legacyRedirectTarget };
