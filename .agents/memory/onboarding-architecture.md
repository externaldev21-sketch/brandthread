---
name: Onboarding flow decisions
description: Durable Brandthread onboarding progression and draft-compatibility rules.
---

Onboarding uses one question per screen rather than a stacked account form. Preserve shared account creation and the separate buyer and seller question sequences.

**Why:** The owner approved the new one-question-per-screen onboarding. Earlier requirements for a stacked shared form must not undo that replacement.

**How to apply:** Preserve one-tap Google and Apple options, editable defaults, optional questions, equivalent-screen draft migrations, and identity ownership. Use stable step identities rather than assuming the old numeric ordering or combining fields back into one form.

Keep branded first-run entry and the canonical onboarding route; legacy account-type routes must not create a second competing questionnaire.

**Why:** Divergent legacy entry paths can bypass the approved onboarding or lose the selected role.

**How to apply:** Route create-account entry through the canonical onboarding controller, never the legacy standalone account-type questionnaire. The approved launch flow chooses role after shared identity/personalization questions; preserve any selected role through an interrupted handoff, and require an owner-matched buyer role before showing the Thread explainer.

Onboarding completion is a final server-authoritative transition shared by buyer and seller flows. Required profile/brand writes must succeed first; only then may the server persist completion and the client bind local routing state to the Clerk user.

**Why:** Marking completion during an earlier sync can let a username collision, interrupted profile write, or app exit leave a partially configured account that skips onboarding on its next sign-in.

**How to apply:** Keep generic identity sync idempotent but incomplete. Commit completion through the dedicated final operation, restore completed roles from the server on new devices, and use same-user local completion only to upgrade older installs.

An account becoming authenticated is not acknowledgement of its age submission. Retain a pending birthday through authentication returns only until the backend accepts the age band, then erase it from the draft.

**Why:** Clerk authentication may reload the page, and the age endpoint requires an existing application profile. Erasing at account creation or silently treating a failed request as success loses the answer.

**How to apply:** Sync the profile before submitting age, keep failed submissions retryable, and never retain an acknowledged birthday or add it to the server's stored profile.

Onboarding welcome footage needs separate native and browser-compatible delivery. Keep a poster until an actual decoded frame appears, and let the poster stand when playback is unavailable.

**Why:** Expo's web preview returned 200 and `video/mp4` for an H.264 clip but its browser reported no supported streams; the native fallback host did not serve that clip. A web-compatible encoding played, while native needed the clip available as an app asset.

**How to apply:** Verify playback with decoded dimensions and advancing time, not merely an HTTP response or a screenshot. Keep the native asset small and preserve first-run access when offline or Reduce Motion is enabled.

Incompatible question layouts must not reuse a persisted draft format version, even if an incoming branch considers that version new.

**Why:** Parallel onboarding work reused the same version for different step layouts. Treating matching integers as compatible can restore the wrong question or role.

**How to apply:** Compare the stored step identities and ownership contract when integrating another flow. Give an incompatible layout a new format version and resume at a valid signed-in profile question rather than interpreting the old numeric position.

Onboarding feel changes must preserve the existing step structure, layout, black/white/silver branding and system font. Professional copy edits are explicitly allowed.

**Why:** The owner explicitly rejected layout rebuilds and asked for native motion and reactive controls, not a redesign.

**How to apply:** Improve transitions, gestures, press feedback and keyboard handling without rearranging screens or introducing new questions. Keep wording short, factual and confident.

Keep the existing thread decoration. The owner's phrase "corny frazes" meant copy/wording, not a rejection of the thread line.

**Why:** The owner explicitly corrected the earlier interpretation and cancelled removal of ThreadLine/threadGeometry. They requested a professional Apple/SSENSE tone across onboarding, empty states and prompts.

**How to apply:** Preserve the thread visuals and motion. Replace cutesy phrases, hype slang and exclamation-mark enthusiasm with factual copy; preserve feature names, legal terms and user-authored content.

Retaining an outgoing screen for a transition requires identical provider nesting as well as a stable React key. Make that layer inert, not a second live screen.

**Why:** Moving the same keyed screen under a different provider hierarchy remounts its inputs and effects, which can refire autofocus and network work during a slide.

**How to apply:** Keep the outgoing and incoming layer structure identical; change inert/accessibility values instead of adding or removing provider levels.
