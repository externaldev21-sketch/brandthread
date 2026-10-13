/**
 * Additional share-preview matchers, kept in their own module so the core
 * list in sharePreview.js stays small. Appended to MATCHERS there.
 *
 *   /invite/:code       — referral invite: "<Name> invited you to Brandthread"
 *                         (inviter's public name only; private accounts and
 *                         unknown names get the generic invite card)
 *   /community-join     — community invite (no lookup: the card stays generic,
 *                         since the code is a bearer credential in the query)
 */
function formatCents(cents) {
  if (typeof cents !== 'number' || !Number.isSafeInteger(cents) || cents <= 0) return null;
  const rest = cents % 100;
  return rest === 0 ? `$${Math.floor(cents / 100)}` : `$${Math.floor(cents / 100)}.${String(rest).padStart(2, '0')}`;
}

function buildMoreMatchers({ apiBase, fetchResource, NOT_FOUND, OG_IMAGE_FALLBACK }) {
  return [
    {
      pattern: /^\/invite\/([A-Za-z0-9]{4,12})\/?$/,
      async load(match) {
        const res = await fetchResource(`${apiBase()}/public/invites/${encodeURIComponent(match[1].toUpperCase())}/share-preview`);
        if (res.status === 404) return NOT_FOUND;
        const invite = res.data;
        if (!invite) return null;
        const reward = formatCents(invite.inviteeRewardCents);
        const name = typeof invite.inviterName === 'string' && invite.inviterName.trim() ? invite.inviterName.trim() : null;
        return {
          title: name ? `${name} invited you to Brandthread` : 'You’re invited to Brandthread',
          description: reward
            ? `Join with this link and get ${reward} Thread Cash.`
            : 'Join Brandthread with this invite link.',
          image: OG_IMAGE_FALLBACK,
        };
      },
    },
    {
      pattern: /^\/community-join\/?$/,
      async load() {
        return {
          title: 'Join a community on Brandthread',
          description: 'You’ve been invited to a community on Brandthread.',
          image: OG_IMAGE_FALLBACK,
        };
      },
    },
  ];
}

module.exports = { buildMoreMatchers };
