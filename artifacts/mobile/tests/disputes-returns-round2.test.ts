import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { orderRef } from '@/lib/orderRef';
import { disputeCurrency, formatDisputeAmount, formatDisputeCents } from '@/lib/disputeMoney';
import { formatCents } from '@/lib/money';

const read = (file: string) => readFileSync(path.resolve(__dirname, '..', file), 'utf8');

describe('order reference in headers', () => {
  it('prefixes one "#" and never doubles it', () => {
    expect(orderRef('BT-1042')).toBe('#BT-1042');
    expect(orderRef('#BT-1042')).toBe('#BT-1042');
    expect(orderRef('##BT-1042')).toBe('#BT-1042');
    expect(orderRef('  # BT-1042 ')).toBe('#BT-1042');
    expect(orderRef('')).toBe('');
    expect(orderRef(null)).toBe('');
  });

  it('return-detail uses it for the header and the whole-order line', () => {
    const src = read('app/return-detail.tsx');
    expect(src).not.toContain('`Return · #${');
    expect(src).not.toContain('order #{view.orderNumber}');
    expect(src).toContain('orderRef(view.orderNumber)');
  });
});

describe('dispute amounts use the dispute currency', () => {
  it('normalises Stripe lowercase codes and falls back to USD', () => {
    expect(disputeCurrency('eur')).toBe('EUR');
    expect(disputeCurrency(null)).toBe('USD');
    expect(disputeCurrency('')).toBe('USD');
    expect(disputeCurrency('not-a-code')).toBe('USD');
  });

  it('formats in that currency', () => {
    expect(formatDisputeAmount(148, 'usd')).toBe(formatCents(14800, 'USD'));
    expect(formatDisputeAmount(62.5, 'eur')).toBe(formatCents(6250, 'EUR'));
    expect(formatDisputeAmount(62.5, 'eur')).not.toBe(formatCents(6250, 'USD'));
    expect(formatDisputeAmount(10, undefined)).toBe(formatCents(1000, 'USD'));
    expect(formatDisputeCents(1500, 'gbp')).toBe(formatCents(1500, 'GBP'));
  });

  it('the list and detail screens no longer format dispute amounts as dollars', () => {
    const list = read('app/disputes.tsx');
    expect(list).not.toContain('formatCents(Math.round(d.amount * 100))');
    expect(list).toContain('formatDisputeAmount(d.amount, d.currency)');
    const detail = read('app/dispute-detail.tsx');
    expect(detail).toContain('formatDisputeCents(dispute.amountCents, currency)');
    expect(detail).not.toMatch(/\bformatCents\(/);
  });
});

describe('disputes list: refetch failure with stale rows', () => {
  it('keeps the rows and shows an inline retry', () => {
    const src = read('app/disputes.tsx');
    expect(src).toContain('{failed && items ? (');
    expect(src).toContain('testID="disputes-refresh-error"');
    expect(src).toContain('ThemedRefreshControl');
  });
});

describe('dispute detail: add note', () => {
  const src = read('app/dispute-detail.tsx');
  it('guards double taps synchronously and shows a pending label', () => {
    expect(src).toContain('if (addingNoteRef.current || !internalNote.trim()) return;');
    expect(src).toContain("label={addingNote ? 'Adding note…' : 'Add note'}");
  });
  it('reports failures with showAlert + friendlyError, never Alert.alert', () => {
    expect(src).toContain("showAlert('Couldn’t add note', friendlyError(err,");
    expect(src).not.toContain('Alert.alert');
  });
});

describe('return evidence photos open full size', () => {
  it.each(['app/return-detail.tsx', 'app/buyer-return-request.tsx'])('%s reuses PhotoViewer', (file) => {
    const src = read(file);
    expect(src).toContain("import { PhotoViewer } from '@/components/media/PhotoViewer';");
    expect(src).toContain('accessibilityRole="imagebutton"');
    expect(src).toContain('onPress={() => setViewerIndex(');
  });
});
