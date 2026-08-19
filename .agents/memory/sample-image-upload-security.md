---
name: Sample image upload security
description: Security contract for attaching private object-storage images to manufacturer sample orders.
---

Sample-image uploads must pass through an authenticated API route with a strict raw-body size limit. The server must validate image byte signatures before it writes to private object storage, and delete the object if later attachment steps fail.

**Why:** Client-direct signed uploads cannot reliably enforce a byte limit here, so an attacker could store oversized or non-image data before post-upload validation rejects attachment.

**How to apply:** Keep this constraint for image attachments: authenticate and authorize before accepting bytes, enforce the limit at the HTTP parser, verify magic bytes, write only validated data, then set private ACL and attach it transactionally.