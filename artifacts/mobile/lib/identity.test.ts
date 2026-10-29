import { describe, expect, it } from 'vitest';
import { atHandle, buyerDisplayName, firstNameOf, personName, sellerDisplayName } from './identity';
import { buildMyIdentity } from '@/hooks/useMyIdentity';

describe('canonical identity (onboarding fields)', () => {
  const seller = { brandName: 'Okafor Studio', displayName: 'Maya Okafor', name: 'Maya Okafor', username: 'okaforstudio' };

  it('a seller reads as the business name onboarding saved, never the person', () => {
    expect(sellerDisplayName(seller)).toBe('Okafor Studio');
  });

  it('falls back person name → @username, never a placeholder', () => {
    expect(sellerDisplayName({ ...seller, brandName: '  ' })).toBe('Maya Okafor');
    expect(sellerDisplayName({ username: 'okaforstudio' })).toBe('@okaforstudio');
    expect(sellerDisplayName({})).toBeNull();
  });

  it('a buyer reads as their own name, then @username', () => {
    expect(buyerDisplayName({ displayName: 'Ava', name: 'Ava Buyer', username: 'ava', brandName: 'ignored' })).toBe('Ava');
    expect(buyerDisplayName({ name: 'Ava Buyer' })).toBe('Ava Buyer');
    expect(buyerDisplayName({ username: '@ava' })).toBe('@ava');
  });

  it('handles and first names are normalised', () => {
    expect(atHandle('@@ava ')).toBe('@ava');
    expect(atHandle('')).toBeNull();
    expect(personName({ displayName: '  Maya   Okafor ' })).toBe('Maya Okafor');
    expect(firstNameOf({ name: 'Maya Okafor' })).toBe('Maya');
  });

  it('buildMyIdentity carries name, @username and the profile photo together', () => {
    const id = buildMyIdentity({ ...seller, accountType: 'seller' }, 'https://cdn/photo.jpg');
    expect(id).toMatchObject({
      displayName: 'Okafor Studio', personName: 'Maya Okafor', firstName: 'Maya',
      username: 'okaforstudio', handle: '@okaforstudio', avatarUrl: 'https://cdn/photo.jpg',
    });
    // No photo → null, so the Avatar shows the monogram fallback.
    expect(buildMyIdentity({ ...seller, accountType: 'seller' }, '').avatarUrl).toBeNull();
    expect(buildMyIdentity({ name: 'Ava Buyer', username: 'ava', accountType: 'buyer' }, null).displayName).toBe('Ava Buyer');
  });
});
