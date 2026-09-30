import { describe, expect, it } from 'vitest';
import {
  isVisitorPreviewParam,
  profileCapabilities,
  resolveProfileMode,
  viewAsVisitorHref,
} from '@/lib/profileAccess';

describe('resolveProfileMode', () => {
  it('is owner only when viewer id equals owner id', () => {
    expect(resolveProfileMode({ viewerId: 'u1', ownerId: 'u1' })).toBe('owner');
    expect(resolveProfileMode({ viewerId: 'u2', ownerId: 'u1' })).toBe('visitor');
  });
  it('signed-out or unresolved ids are always a visitor', () => {
    expect(resolveProfileMode({ viewerId: null, ownerId: 'u1' })).toBe('visitor');
    expect(resolveProfileMode({ viewerId: 'u1', ownerId: undefined })).toBe('visitor');
    expect(resolveProfileMode({ viewerId: undefined, ownerId: undefined })).toBe('visitor');
  });
  it('"view as visitor" can downgrade an owner but never upgrade a visitor', () => {
    expect(resolveProfileMode({ viewerId: 'u1', ownerId: 'u1', previewAsVisitor: true })).toBe('visitor');
    expect(resolveProfileMode({ viewerId: 'u2', ownerId: 'u1', previewAsVisitor: false })).toBe('visitor');
  });
});

const OWNER_ONLY = [
  'showPlanChip', 'showDashboard', 'showEditProfile', 'showInbox', 'showInsights', 'showDrafts',
  'showPrivateBuyerData', 'showViewAsVisitor', 'canEditProducts',
] as const;

describe('profileCapabilities — visitors never get owner controls', () => {
  for (const role of ['seller', 'buyer'] as const) {
    it(`${role}: visitor has none of the owner-only controls`, () => {
      const caps = profileCapabilities(role, 'visitor');
      for (const key of OWNER_ONLY) expect(caps[key], `${role} visitor ${key}`).toBe(false);
    });
  }

  it('seller visitor: Posts | Products | Tagged, Buy, Follow, Message, ... menu', () => {
    expect(profileCapabilities('seller', 'visitor')).toMatchObject({
      showPostsTab: true, showProductsTab: true, showTaggedTab: true, canBuy: true,
      showFollow: true, showMessage: true, showVisitorMenu: true, canEditProducts: false,
    });
  });

  it('seller owner: everything a visitor sees plus plan, dashboard, edit, inbox, insights, drafts; edit instead of Buy', () => {
    expect(profileCapabilities('seller', 'owner')).toMatchObject({
      showProductsTab: true, showTaggedTab: true, showPlanChip: true, showDashboard: true,
      showEditProfile: true, showInbox: true, showInsights: true, showDrafts: true,
      showViewAsVisitor: true, canEditProducts: true, canBuy: false, showFollow: false, showMessage: false,
    });
  });

  it('buyer visitor: no Products tab, no private buyer data, Follow / Message / ...', () => {
    expect(profileCapabilities('buyer', 'visitor')).toMatchObject({
      showProductsTab: false, showPrivateBuyerData: false, showFollow: true, showMessage: true, showVisitorMenu: true,
    });
  });

  it('buyer owner: private saved/orders/Thread Cash, edit, view as visitor', () => {
    expect(profileCapabilities('buyer', 'owner')).toMatchObject({
      showPrivateBuyerData: true, showEditProfile: true, showViewAsVisitor: true, showPlanChip: false,
      showDashboard: false, showFollow: false,
    });
  });
});

describe('visitor preview routing', () => {
  it('parses the param', () => {
    expect(isVisitorPreviewParam('1')).toBe(true);
    expect(isVisitorPreviewParam('true')).toBe(true);
    expect(isVisitorPreviewParam(undefined)).toBe(false);
    expect(isVisitorPreviewParam('0')).toBe(false);
  });
  it('builds a per-role href', () => {
    expect(viewAsVisitorHref('seller', 'user_1')).toBe('/seller-profile?id=user_1&asVisitor=1');
    expect(viewAsVisitorHref('buyer', 'user_1')).toBe('/buyer-other-profile?userId=user_1&asVisitor=1');
  });
});
