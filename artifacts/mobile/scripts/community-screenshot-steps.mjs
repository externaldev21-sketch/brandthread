/** Ordered, stateful demo walk-through: each step continues in the same session. */
const settle = (page, ms = 1800) => page.waitForTimeout(ms);
const boot = (page) => page.waitForTimeout(6000);
/** The app remounts its navigation tree once when the stubbed auth settles; retry until the screen is really up. */
async function nav(page, go, url, text) {
  for (let i = 0; i < 5; i += 1) {
    await go(page, url);
    await page.waitForTimeout(2200);
    if (await page.getByText(text).first().isVisible().catch(() => false)) return;
  }
  throw new Error(`screen did not open: ${url}`);
}

export default {

  async signedOutList({ browser, origin, session, shot, go, zoom }) {
    const { context, page } = await session(browser, origin, 'buyer', false);
    await boot(page);
    await nav(page, go, '/community?bt_preview=buyer', 'Create a group');
    await shot(page, '00-community-signed-out-readonly');
    await page.getByText('Join', { exact: true }).first().click();
    await settle(page, 1000);
    await shot(page, '00b-community-join-prompts-sign-in');
    await context.close();
  },

  async demoFlow({ browser, origin, session, shot, go, zoom }) {
    const { context, page } = await session(browser, origin, 'buyer', true);
    await boot(page);
    await nav(page, go, '/community?bt_preview=buyer', 'Create a group');
    await shot(page, '01-community-list');
    await zoom(page, 'community-cards-and-join-buttons', [0, 395, 393, 457]);
    await zoom(page, 'community-invite-and-create-rows', [0, 195, 393, 175]);
    await page.getByText('Join', { exact: true }).nth(0).click();
    await settle(page, 600);
    await page.getByText('Join', { exact: true }).nth(0).click();
    await settle(page, 1000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '02-community-joined-on-top');
    await zoom(page, 'your-groups-and-joined-buttons', [0, 200, 393, 400]);

    // Chat
    await nav(page, go, '/community-chat?id=demo-c-graphic&bt_preview=buyer', '12K members');
    await shot(page, '03-chat');
    await zoom(page, 'chat-header', [0, 55, 393, 70]);
    await zoom(page, 'chat-role-pills-and-bubbles', [0, 200, 393, 360]);
    await zoom(page, 'chat-shared-composer', [0, 760, 393, 92]);
    await page.waitForTimeout(9500); // scripted chatter arrives over the realtime channel
    await page.getByText('12K members').first().waitFor({ timeout: 5000 });
    await shot(page, '03b-chat-realtime-message');

    // Members
    await nav(page, go, '/community-members?id=demo-c-graphic&bt_preview=buyer', 'Mara Okafor');
    await shot(page, '04-members');
    await zoom(page, 'members-rows-and-admin-pills', [0, 195, 393, 420]);
    await nav(page, go, '/community-chat?id=demo-c-graphic&bt_preview=buyer', '12K members');

    // Mute from the chat header menu
    await page.mouse.click(355, 89);
    await settle(page, 900);
    await shot(page, '05-chat-menu');
    await zoom(page, 'chat-menu-sheet', [0, 540, 393, 312]);
    await page.getByText(/^Mute/).first().click();
    await settle(page, 900);
    await shot(page, '06-chat-muted');

    // Inbox rows (joined communities show as group chat rows)
    await nav(page, go, '/?bt_preview=buyer', 'Shop');
    await page.mouse.click(191, 799);
    await page.getByText('Messages', { exact: true }).first().waitFor({ timeout: 15000 });
    await settle(page, 2000);
    await shot(page, '07-inbox-group-rows');
    await zoom(page, 'inbox-group-rows', [0, 335, 393, 160]);
    await zoom(page, 'inbox-note-bubble-and-header', [0, 60, 393, 250]);
    await page.mouse.click(357, 89);
    await settle(page, 900);
    await shot(page, '08-inbox-plus-menu');
    await zoom(page, 'inbox-plus-menu-sheet', [0, 540, 393, 312]);
    await context.close();
  },

  async createFlow({ browser, origin, session, shot, go, zoom }) {
    const { context, page } = await session(browser, origin, 'buyer', true);
    await boot(page);
    await nav(page, go, '/community-create?bt_preview=buyer', 'Group name');
    await shot(page, '09-create-group-empty');
    await page.getByPlaceholder('Graphic Design Community').fill('Raw Denim Heads');
    await page.getByPlaceholder('What is this group about?').fill('Fades, washes and selvedge talk.');
    await settle(page, 500);
    await shot(page, '10-create-group-filled');
    await page.getByText('Private', { exact: true }).first().click();
    await settle(page, 600);
    await shot(page, '11-create-group-private');
    await zoom(page, 'create-segmented-and-toggle', [0, 470, 393, 270]);
    await zoom(page, 'create-fields', [0, 135, 393, 330]);
    await context.close();
  },

  async inviteJoin({ browser, origin, session, shot, go, zoom }) {
    const { context, page } = await session(browser, origin, 'buyer', true);
    await boot(page);
    await nav(page, go, '/community-join?code=demo1234&bt_preview=buyer', 'Join group');
    await shot(page, '12-private-invite-join');
    await zoom(page, 'invite-join-buttons', [0, 130, 393, 350]);
    await context.close();
  },

  async profileGroups({ browser, origin, session, shot, go, zoom }) {
    const { context, page } = await session(browser, origin, 'buyer', true);
    await boot(page);
    await nav(page, go, '/buyer-settings-menu?bt_preview=buyer', 'Your account');
    await shot(page, '13-buyer-profile-groups-row');
    await zoom(page, 'profile-groups-row', [0, 560, 393, 200]);
    await context.close();
  },
};
