# Media delivery: CDN and signed URLs (BT-473)

## What changed

`GET /api/posts/media/*`, `/api/product-videos/media/*`, `/api/profile/cover-media/*` and `/api/profile/avatar-media/*` used to pipe every byte of every video and image from object storage through Express. They still run every check they ran before (post published and public, product active, cover moderated, object ACL), then:

| Mode | When | Response |
| --- | --- | --- |
| `redirect` | production, or any time `CDN_BASE_URL` is set | `302` to a V4 signed URL for the object, valid `MEDIA_SIGNED_URL_TTL_SEC` (default 900 = 15 min). With `CDN_BASE_URL` set, the signed URL points at the CDN host. `Cache-Control: public, max-age<=300` on the redirect, never longer than the signature lives. |
| `stream` | local dev, `MEDIA_DELIVERY=stream`, or signing unavailable | Old behavior: bytes through Express, with Range support |

- **Range requests** (video seeking) go straight to the signed URL; GCS and Cloudflare both answer `206`.
- The same signed URL is reused for an object until a third of its lifetime is left, so concurrent viewers share one URL and the CDN cache stays warm. Signing runs at most once per object per ~10 minutes per instance.
- If signing fails (no object-storage sidecar, e.g. off Replit) the route streams and retries signing after a minute. Nothing 500s.
- **Private media is not touched.** DMs and other private attachments keep per-viewer, short-lived signing in their own routes (#752 `lib/dmMedia.ts` for DMs). Those URLs are also rewritten to the CDN host when `CDN_BASE_URL` is set, which is why the CDN cache key **must include the full query string** (below).
- A post that becomes private or is deleted stops getting new redirects immediately; a URL already handed out keeps working until it expires (at most 15 minutes).
- Kill switch: `MEDIA_DELIVERY=stream` returns to proxying everything through the API with no deploy.

## Env

| Var | Default | Where Dev gets it |
| --- | --- | --- |
| `CDN_BASE_URL` | unset (signed GCS URLs, no CDN) | Your Cloudflare media hostname, e.g. `https://media.brandthread.app` (setup below) |
| `MEDIA_DELIVERY` | `redirect` in production / with a CDN, `stream` elsewhere | Only set it to force a mode |
| `MEDIA_SIGNED_URL_TTL_SEC` | `900` | Only set to change the lifetime (120 s to 7 days) |

## Cloudflare in front of GCS (setup, ~20 minutes)

Prerequisite: `brandthread.app` DNS is on Cloudflare.

1. **DNS.** Cloudflare dashboard → brandthread.app → DNS → Add record: `CNAME`, name `media`, target `storage.googleapis.com`, **Proxied** (orange cloud).
2. **Send the right Host to Google.** Rules → Origin Rules → Create rule: *When hostname equals `media.brandthread.app`* → *Host Header: Rewrite to `storage.googleapis.com`*. The signed URL's signature covers the `host` header, so this is required.
   If your plan does not offer Host header rewrite, use a Worker on `media.brandthread.app/*` instead:
   ```js
   export default {
     async fetch(request, env, ctx) {
       const url = new URL(request.url);
       const origin = `https://storage.googleapis.com${url.pathname}${url.search}`;
       return fetch(origin, { method: request.method, headers: request.headers, cf: { cacheEverything: true, cacheTtl: 600 } });
     },
   };
   ```
3. **Cache rule.** Rules → Cache Rules → Create: *When hostname equals `media.brandthread.app`* → *Eligible for cache*; Edge TTL: *Ignore cache-control header and use this TTL* = **10 minutes** (keep it under the 15-minute signature); Browser TTL: *Respect origin*. **Cache key: leave the query string included (the default). Never choose "Ignore query string"**: the query is the signature, and DM media shares this host.
4. **SSL/TLS** mode Full (strict). Origin is Google's certificate.
5. **Set** `CDN_BASE_URL=https://media.brandthread.app` on the API deployment (Replit → Deployments → Secrets). Redeploy.
6. **Verify:**
   ```bash
   curl -sI https://brandthread.app/api/posts/media/<path-of-a-public-post-video>
   # 302, location: https://media.brandthread.app/<bucket>/<object>?X-Goog-Algorithm=...
   curl -sI -H 'Range: bytes=0-1023' '<that location>'
   # 206, cf-cache-status: MISS, then HIT on the second request
   ```
   Rollback: delete `CDN_BASE_URL` (signed GCS URLs, no CDN) or set `MEDIA_DELIVERY=stream` (old proxying).

### Cloudflare terms and video (decision for Dev)

Cloudflare's self-serve CDN terms restrict serving a disproportionate amount of **video** through the plain CDN unless it is hosted on Cloudflare Stream, R2 or Images. Images and thumbnails through the CDN are fine. For video, either accept that risk for launch volumes, or keep `CDN_BASE_URL` unset (video then goes browser → GCS signed URL directly, still not through the API), and move video to Mux (next section). Read Cloudflare's current Service-Specific Terms before relying on the CDN for video.

## Phase 2: Mux for video

PR #757 (`claude/perf-uploads-video`) adds Mux HLS behind `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `MUX_WEBHOOK_SECRET`: uploads get an HLS playback id, the feed plays the Mux stream, and posts without one keep using the route above. Sign up at mux.com → Settings → Access Tokens (Mux Video, read + write) and Settings → Webhooks (`https://brandthread.app/api/webhooks/mux`). Switch when CDN egress for video passes roughly $1-2k/month or adaptive bitrate is needed for poor networks; plan R2 + own transcoding when the Mux bill passes about $5k/month (`SCALE_PLAN.md` §5).
