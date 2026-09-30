# Community group chats

Topic group chats ("Graphic Design Community"): join one and it lives in your Messages inbox.
Official Brandthread communities carry a verified mark; any buyer or seller can also create a
public or private group.

## Why it is not the DM group model

DM `conversations` are capped at 20 people and keep per-participant unread counters that every
message increments. Communities have **no member cap**, so nothing fans out per member:

| Concern | Design |
| --- | --- |
| History | `community_messages.seq` — a dense per-community counter; clients page with `before=<seq>` and catch up with `after=<seq>`. |
| Unread | One `community_members.last_read_seq` per member. Unread = `communities.last_seq − last_read_seq`, derived at read time. Sending writes one message row and bumps one counter. |
| Member count | Counter on `communities`, maintained on join/leave. Member lists are offset-paged. |
| Realtime | `/ws/community?communityId=&token=` (ws/communityHub.ts), subscribed only while a chat is open. Membership is verified on connect; leaving/removal/ban closes the member's sockets. Clients re-fetch `after=<lastSeq>` on every reconnect, so a dropped event is never lost history. |
| Push | Batched **per community** (lib/communityPush.ts): at most one wave per `COMMUNITY_PUSH_WINDOW_MS` (default 3 min). A single message reads "Sender: text"; a burst reads "12 new messages in Graphic Design Community". Recipients are unmuted members who still have unread and don't have the chat open. |
| Mute | `community_members.muted`. Muted members are never selected for push; the inbox row still shows unread quietly, and muted unread is excluded from the tab-bar badge (`loudUnreadTotal`). |

`api-server/src/routes/__tests__/communities.integration.test.ts` includes a 1,500-member test
that asserts a send is one message row + one counter bump (no per-member writes), unread is
derived for every member, and push/history/members stay paged.

## Moderation

- **Text is not filtered** beyond the existing harmful-content block the DM pipeline already
  applies (threats, doxxing, slurs, scams — `moderateMessage`). Kept for legal/App Store reasons.
- **Images are filtered** (gore / violence / nudity) server-side *before* delivery:
  `POST /api/communities/upload-photo` re-encodes the image (strips EXIF), runs
  `lib/imageModeration.ts` (OpenAI omni-moderation), and only then stores it. Message and group
  image attachments must be URLs from that route, so an unchecked image can't be delivered by
  pasting a URL. A rejected photo gets a calm message; if the checker is unavailable the photo is
  **not** delivered (fails closed).
- **Report** goes through `POST /api/reports` (`community_message`, `community`) into the existing
  moderation queue; **block** uses `/api/social/block` and hides the blocked member's messages for
  the blocker; group owners/admins can remove messages and remove/ban members.
- **Abuse limits:** group creation is rate-limited per account (`community-create`, 5/day) and
  capped at 20 owned groups. Official names and "Brandthread" are reserved.

## Surfaces

`/community` (Join a group: search, your groups, official + popular public groups, invite-link
field), `/community-create`, `/community-join?code=`, `/community-chat?id=`, `/community-members?id=`.
Entry points live only in a user's own private areas: the inbox `+` menu (New message / Create
group / Join a group), the buyer's own profile "Groups" row, and the seller Studio Community card.

Signed-out / fresh preview: the list is read-only (public endpoint) and Join prompts sign-in.
`&demo=1` shows lively local demo chats (`lib/communities/demoStore.ts`).
