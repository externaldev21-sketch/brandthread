/**
 * Navigation targets for the profile ↔ feed ↔ product ↔ checkout loop. Every
 * connection the profile redesign fixed goes through these builders, so the
 * exact route names and param spellings are pinned here.
 */
import { describe, expect, it } from 'vitest';
import {
  connectionsHref,
  messageSellerAboutProductHref,
  messageSellerHref,
  productDetailHref,
  profileHref,
  profileProductsHref,
  profileVideosHref,
} from '../profileNavigation';
import { emitProfileEvent, nextFollowingCount, subscribeProfileEvents } from '../profileEvents';

function params(href: string): Record<string, string> {
  const query = href.split('?')[1] ?? '';
  return Object.fromEntries(new URLSearchParams(query));
}

describe('profileHref — who opens which profile screen', () => {
  it('opens a seller on the brand profile by id', () => {
    expect(profileHref({ userId: 'user_seller', accountType: 'seller' })).toBe('/seller-profile?id=user_seller');
  });

  it('opens a buyer on the buyer profile with the userId param that screen reads (not `id`)', () => {
    const href = profileHref({ userId: 'user_buyer', accountType: 'buyer', name: 'Ava B', handle: '@ava' });
    expect(href.startsWith('/buyer-other-profile?')).toBe(true);
    expect(params(href)).toEqual({ userId: 'user_buyer', name: 'Ava B', handle: '@ava' });
    expect(href).not.toContain('?id=');
  });

  it('defaults unknown account types to the seller profile (feed authors are sellers)', () => {
    expect(profileHref({ userId: 'user_x' })).toBe('/seller-profile?id=user_x');
  });
});

describe('profileVideosHref — video tile → full-screen feed player', () => {
  it('scopes the player to the creator and starts at the tapped video', () => {
    const href = profileVideosHref({ id: 'user_seller', startPostId: 'post-7', title: 'Acme Co' });
    expect(href.startsWith('/profile-videos?')).toBe(true);
    expect(params(href)).toEqual({ source: 'creator', id: 'user_seller', startPostId: 'post-7', title: 'Acme Co' });
  });

  it('can scope the player to the videos that feature one product', () => {
    expect(params(profileVideosHref({ source: 'product', id: 'prod-1', startPostId: 'post-2' })))
      .toEqual({ source: 'product', id: 'prod-1', startPostId: 'post-2' });
  });
});

describe('shop and product links', () => {
  it('opens the seller shop list with the seller id', () => {
    expect(profileProductsHref({ sellerId: 'user_seller', sellerName: 'Acme Co' }))
      .toBe('/profile-products?sellerId=user_seller&sellerName=Acme%20Co');
    expect(params(profileProductsHref({ sellerId: 's', isOwner: true }))).toEqual({ sellerId: 's', isOwner: 'true' });
  });

  it('opens the buyer product detail for shoppers and the seller product screen for its owner', () => {
    expect(productDetailHref('prod-1')).toBe('/buyer-product-detail?productId=prod-1');
    expect(productDetailHref('prod-1', { sourcePostId: 'post-9' })).toBe('/buyer-product-detail?productId=prod-1&sourcePostId=post-9');
    expect(productDetailHref('prod-1', { isOwner: true })).toBe('/product-detail?id=prod-1');
  });

  it('opens follower/following lists for a specific profile', () => {
    expect(connectionsHref('followers', 'user_seller')).toBe('/connections?type=followers&userId=user_seller');
    expect(connectionsHref('following')).toBe('/connections?type=following');
  });
});

describe('messaging a seller', () => {
  it('opens the product DM thread with the product card as context', () => {
    const href = messageSellerAboutProductHref({
      sellerId: 'user_seller', sellerName: 'Acme Co', productId: 'prod-1', productName: 'Wool Coat',
      productPriceCents: 48000, productImageUri: 'https://cdn.example.com/coat.jpg',
    });
    expect(href.startsWith('/buyer-conversation?')).toBe(true);
    expect(params(href)).toEqual({
      participantId: 'user_seller',
      participantName: 'Acme Co',
      participantInitials: 'AC',
      participantAccountType: 'seller',
      type: 'buyer_to_seller_product',
      contextProductId: 'prod-1',
      contextProductName: 'Wool Coat',
      contextSellerName: 'Acme Co',
      contextProductPriceCents: '48000',
      contextProductImage: 'https://cdn.example.com/coat.jpg',
    });
  });

  it('opens a plain buyer↔seller thread from the profile Message action', () => {
    expect(params(messageSellerHref({ sellerId: 'user_seller', sellerName: 'Acme Co', handle: 'acme', initials: 'AC' })))
      .toEqual({
        participantId: 'user_seller', participantName: 'Acme Co', participantHandle: '@acme',
        participantInitials: 'AC', participantAccountType: 'seller', type: 'buyer_to_seller',
      });
  });
});

describe('profile events — follow count invalidation', () => {
  it('delivers follow changes to every subscribed profile and stops after unsubscribe', () => {
    const received: unknown[] = [];
    const unsubscribe = subscribeProfileEvents((event) => received.push(event));
    emitProfileEvent({ type: 'follow', targetId: 'user_seller', isFollowing: true, followersCount: 13, viewerId: 'me' });
    unsubscribe();
    emitProfileEvent({ type: 'follow', targetId: 'user_seller', isFollowing: false });
    expect(received).toEqual([{ type: 'follow', targetId: 'user_seller', isFollowing: true, followersCount: 13, viewerId: 'me' }]);
  });

  it('isolates a throwing listener from the others', () => {
    const received: string[] = [];
    const a = subscribeProfileEvents(() => { throw new Error('boom'); });
    const b = subscribeProfileEvents((event) => received.push(event.type));
    emitProfileEvent({ type: 'content' });
    a(); b();
    expect(received).toEqual(['content']);
  });

  it('never lets a following count go negative', () => {
    expect(nextFollowingCount(0, false)).toBe(0);
    expect(nextFollowingCount(4, true)).toBe(5);
  });
});
