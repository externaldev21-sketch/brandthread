import { describe, expect, it } from 'vitest';

import { SETTINGS_CATALOG } from './settingsCatalog';

const items = SETTINGS_CATALOG.flatMap(group => group.items);

describe('settings catalog', () => {
  it('keeps the consolidated destinations discoverable', () => {
    for (const destination of [
      '/general-settings',
      '/account-type-settings',
      '/notifications-settings',
      '/vacation-mode',
      '/appearance',
      '/login-methods',
      '/shopping-preferences',
      '/store-settings',
    ]) {
      expect(items.some(item => item.route === destination)).toBe(true);
    }
  });

  it('supports role-aware sections and descriptive aliases', () => {
    expect(items.some(item => item.audience === 'buyer')).toBe(true);
    expect(items.some(item => item.audience === 'seller')).toBe(true);
    expect(items.every(item => item.description.length > 0 && item.aliases.length > 0)).toBe(true);
    expect(items.find(item => item.aliases.includes('away'))?.route).toBe('/vacation-mode');
    expect(items.find(item => item.aliases.includes('2fa'))?.route).toBe('/login-methods');
  });

  // QA-0057: buyers reach the real, saved preferences — not the old local mock.
  it('sends buyers to the persisted notification preferences', () => {
    const buyerNotifications = items.find(item => item.audience === 'buyer' && item.label === 'Notifications');
    expect(buyerNotifications?.route).toBe('/notifications-settings');
    expect(items.some(item => item.route === '/push-notifications')).toBe(false);
  });

  // QA-0043: AI consent can be withdrawn from Settings by buyers and sellers.
  it('lets both roles manage AI data sharing', () => {
    const rows = items.filter(item => item.route === '/ai-data-sharing');
    expect(rows.map(r => r.audience).sort()).toEqual(['buyer', 'seller']);
  });
});
