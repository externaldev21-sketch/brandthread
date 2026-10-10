/**
 * https://brandthread.app/sitemap.xml (BT-315): the API's live sitemap
 * (products, seller profiles, drops — api-server routes/sitemap.ts), cached
 * here for an hour. Falls back to the build-time static sitemap.xml (legal
 * pages only) when the API can't be reached, so the URL never breaks.
 */
const { apiBase } = require('./sharePreview');

const TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 4000;
let cached = null; // { xml, at }

async function dynamicSitemap(now = Date.now()) {
  if (cached && now - cached.at < TTL_MS) return cached.xml;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${apiBase()}/public/sitemap.xml`, { signal: controller.signal });
    if (!res.ok) return cached ? cached.xml : null;
    const xml = await res.text();
    if (!xml.includes('<urlset')) return cached ? cached.xml : null;
    cached = { xml, at: now };
    return xml;
  } catch {
    return cached ? cached.xml : null;
  } finally {
    clearTimeout(timer);
  }
}

function resetSitemapCacheForTests() { cached = null; }

module.exports = { dynamicSitemap, resetSitemapCacheForTests };
