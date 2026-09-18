---
name: Friend-only repost identity
description: Privacy and consistency rules for showing who reposted a Thread post.
---

Repost identity may be shown only when both the viewer and reposter are buyer accounts with reciprocal active follows. Exclude the viewer from friend-avatar results, reject seller viewers, enforce blocks in both directions, and return no context for non-public or non-visible posts.

**Why:** Repost avatars reveal a buyer's social activity. Client-side filtering or checking only the reposter's role can expose that activity to strangers, one-way followers, or sellers.

**How to apply:** Authorize and cap identity metadata on the server for every feed source. Clients render only the returned list and never infer friendship. Own repost state is separate, server-authoritative, and uses explicit add/remove operations backed by a partial unique interaction index so retries and concurrent taps remain idempotent.