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

  async signedOutList({ browser, origin, session, shot, go }) {
    const { context, page } = await session(browser, origin, 'buyer', false);
    await boot(page);
    await nav(page, go, '/community?bt_preview=buyer', 'Have an invite link?');
    await shot(page, '00-community-signed-out-readonly');
    await page.getByText('Join', { exact: true }).first().click();
    await settle(page, 1000);
    await shot(page, '00b-community-join-prompts-sign-in');
    await context.close();
  },

  async demoFlow({ browser, origin, session, shot, go }) {
    const { context, page } = await session(browser, origin, 'buyer', true);
    await boot(page);
    await nav(page, go, '/community?bt_preview=buyer', 'Have an invite link?');
    await shot(page, '01-community-list');
    await page.getByText('Join', { exact: true }).nth(0).click();
    await settle(page, 600);
    await page.getByText('Join', { exact: true }).nth(0).click();
    await settle(page, 1000);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, '02-community-joined-on-top');

    // Chat
    await nav(page, go, '/community-chat?id=demo-c-graphic&bt_preview=buyer', '12K members');
    await shot(page, '03-chat');
    await page.waitForTimeout(9500); // scripted chatter arrives over the realtime channel
    await page.getByText('12K members').first().waitFor({ timeout: 5000 });
    await shot(page, '03b-chat-realtime-message');

    // Members
    await nav(page, go, '/community-members?id=demo-c-graphic&bt_preview=buyer', 'Mara Okafor');
    await shot(page, '04-members');
    await nav(page, go, '/community-chat?id=demo-c-graphic&bt_preview=buyer', '12K members');

    // Mute from the chat header menu
    await page.mouse.click(355, 89);
    await settle(page, 900);
    await shot(page, '05-chat-menu');
    await page.getByText(/^Mute/).first().click();
    await settle(page, 900);
    await shot(page, '06-chat-muted');

    // Inbox rows (joined communities show as group chat rows)
    await nav(page, go, '/?bt_preview=buyer', 'Shop');
    await page.mouse.click(191, 799);
    await page.getByText('Messages', { exact: true }).first().waitFor({ timeout: 15000 });
    await settle(page, 2000);
    await shot(page, '07-inbox-group-rows');
    await page.mouse.click(357, 89);
    await settle(page, 900);
    await shot(page, '08-inbox-plus-menu');
    await context.close();
  },

  async createFlow({ browser, origin, session, shot, go }) {
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
    await context.close();
  },

  async inviteJoin({ browser, origin, session, shot, go }) {
    const { context, page } = await session(browser, origin, 'buyer', true);
    await boot(page);
    await nav(page, go, '/community-join?code=demo1234&bt_preview=buyer', 'Join group');
    await shot(page, '12-private-invite-join');
    await context.close();
  },

  async profileGroups({ browser, origin, session, shot, go }) {
    const { context, page } = await session(browser, origin, 'buyer', true);
    await boot(page);
    await nav(page, go, '/buyer-settings-menu?bt_preview=buyer', 'Your account');
    await shot(page, '13-buyer-profile-groups-row');
    await context.close();
  },
};
