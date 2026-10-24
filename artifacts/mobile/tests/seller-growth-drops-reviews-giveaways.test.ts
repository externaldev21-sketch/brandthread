import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8');

// Seller growth audit, round 2: drops, reviews and giveaways fix-backs.
describe('seller drop create', () => {
  const src = read('app/seller-drop-create.tsx');
  it('links to Add product from the empty products section and reloads products on focus', () => {
    expect(src).toContain("router.push('/add-product' as never)");
    expect(src).toContain('useFocusEffect(useCallback(');
  });
  it('asks before dropping unsaved edits and confirms Cancel drop', () => {
    expect(src).toContain('const onBack = useUnsavedChangesGuard(dirty);');
    expect(src).toContain('onBack={onBack}');
    expect(src).toMatch(/confirmAlert\(\{\s*title: 'Cancel this drop\?'[\s\S]*?destructive: true/);
    expect(src).not.toContain('Alert.alert(');
  });
  it('passes only real EmptyState props', () => {
    expect(src).not.toContain('variant="error"');
    expect(src).toContain("action={{ label: 'Retry'");
  });
});

describe('seller reviews', () => {
  const src = read('app/seller-reviews.tsx');
  it('has pull-to-refresh in the theme tint', () => {
    expect(src).toContain('<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={PURPLE}');
  });
  it('can edit and delete a posted reply (delete is confirmed)', () => {
    expect(src).toContain('api.reviews.editReply(review.id, replyText.trim())');
    expect(src).toContain('api.reviews.deleteReply(review.id)');
    expect(src).toMatch(/confirmAlert\(\{\s*title: 'Delete your reply\?'[\s\S]*?destructive: true/);
    const api = read('lib/api.ts');
    expect(api).toContain("patch<any>(`/api/reviews/${encodeURIComponent(reviewId)}/reply`, { replyText })");
    expect(api).toContain("del<{ ok: boolean }>(`/api/reviews/${encodeURIComponent(reviewId)}/reply`)");
  });
});

describe('giveaways', () => {
  it('the shared page offers Sign in, returning to the giveaway via the sign-in gate', () => {
    const src = read('app/giveaway.tsx');
    expect(src).toContain("{ label: 'Sign in to enter', onPress: goToSignIn }");
    expect(read('hooks/useSignInGate.ts')).toContain('returnTo: guestReturnPath(pathname, params)');
  });

  it('create: hint placeholders, template retry, searchable pickers, 44pt winner chips, validation, unsaved guard', () => {
    const src = read('app/seller-giveaway-create.tsx');
    expect(src).toContain("placeholder: 'e.g. United States'");
    expect(src).toContain("placeholder: 'e.g. Open to people aged 18 or older'");
    expect(src).toContain('<RetryRow label="Couldn\'t load the rules template"');
    expect(src).not.toContain('.slice(0, 20)');
    expect(src).toContain('<SearchPickerSheet visible={sheet === \'post\'}');
    expect(src).toContain('<SearchPickerSheet visible={sheet === \'product\'}');
    expect(src).toContain('chipHitSlop={WINNER_CHIP_HIT_SLOP}');
    expect(src).toContain('giveawayFormError(');
    expect(src).toContain('const onBack = useUnsavedChangesGuard(dirty);');
  });

  it('detail: confirmed Cancel giveaway, "Not shipped", seller-friendly draw ID', () => {
    const src = read('app/seller-giveaway-detail.tsx');
    expect(src).toContain('api.sellerGiveaways.cancel(g.id)');
    expect(src).toMatch(/confirmAlert\(\{\s*title: 'Cancel this giveaway\?'[\s\S]*?destructive: true/);
    expect(src).toContain("w.shippedAt ? 'Not shipped' : 'Mark shipped'");
    expect(src).toContain('Draw ID {d.eligibleHash.slice(0, 12)}');
    expect(src).not.toContain('fingerprint');
  });

  it('list: long titles wrap (ListRow default titleNumberOfLines=2, not overridden)', () => {
    expect(read('app/seller-giveaways.tsx')).not.toMatch(/\btitleNumberOfLines/);
    expect(read('components/ui/ListRow.tsx')).toContain('titleNumberOfLines = 2');
  });
});
