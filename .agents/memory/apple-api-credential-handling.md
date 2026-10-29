---
name: Apple API credential validation
description: Distinguish PEM formatting failures, valid key material, and actual Apple authentication.
---

Validate the PKCS#8 DER payload before rejecting an Apple private key that has
complete PEM markers but fails the direct PEM parser. Flattened line breaks can
leave the underlying key valid; normalize the envelope without changing key data.

**Why:** Repeatedly requesting replacement secrets for a PEM formatting issue
creates unnecessary work and does not establish whether Apple accepts the key.

**How to apply:** Check for a P-256 EC key locally, then make a signed read-only
Apple API request. Report local preflight results separately from remote
authentication and signing readiness. Materialize private keys outside the
checkout with restricted permissions and delete them after use. Fill submission
credentials transiently at command runtime, not in committed configuration.

EAS API-key injection does not prove non-interactive signing bootstrap is supported.
**Why:** EAS can stop with “Credentials are not set up” before validating a distribution certificate, even with the ASC variables populated.
**How to apply:** Distinguish CLI setup-mode rejection from Apple authorization rejection; do not blame the API-key role or claim an Apple ID login is unavoidable without provider evidence.

Apple signing can be bootstrapped with the ASC API and an OpenSSL-generated CSR/P12 on Linux, then handed to EAS as local credentials.
**Why:** A working ASC key can create certificates/profiles even when EAS refuses to bootstrap them non-interactively. The certificate's private key is generated locally and cannot be downloaded from Apple later.
**How to apply:** Preserve signing material with restricted permissions outside the checkout and reuse it on retries. Never create replacement certificates merely because EAS's remote credential store is empty; never revoke credentials during build troubleshooting.

EAS source staging must have room for both its repository copy and compressed archive, and must not be a descendant of the source directory.
**Why:** The workspace's 5 GiB temporary filesystem can fill during source packaging before any cloud build exists; moving TMPDIR under the workspace instead triggers fs-extra's self-copy rejection.
**How to apply:** Treat packaging failures separately from signing. Use an external staging filesystem with enough capacity or prepare a smaller build-only source snapshot; preserve existing signing assets rather than regenerating them.

For constrained EAS uploads, skip the temporary Git clone with EAS_NO_VCS and explicitly set the monorepo source root. A root .easignore replaces every nested .gitignore, not just the root one.
**Why:** Otherwise generated mobile documentation, web exports and caches re-enter the upload; the repository clone plus archive can exhaust temporary storage even when app assets are small.
**How to apply:** Preserve workspace source and runtime media, explicitly exclude nested generated output and secrets, and retain native modules' source while excluding generated top-level native projects.

Pin the EAS package-manager major to the workspace rather than inheriting it from the moving latest image.
**Why:** New pnpm major versions can change build-script approval behavior and reject the workspace's existing install policy before the app's release hooks execute.
**How to apply:** Fix the toolchain mismatch without blanket approval of dependency lifecycle scripts or weakening supply-chain settings.
