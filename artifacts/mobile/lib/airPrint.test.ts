import { beforeEach, describe, expect, it, vi } from 'vitest';

const platform = vi.hoisted(() => ({ OS: 'ios' }));
vi.mock('react-native', () => ({ Platform: platform, Linking: { openURL: vi.fn(async () => {}) } }));
vi.mock('expo-print', () => ({ printAsync: vi.fn(), printToFileAsync: vi.fn(async () => ({ uri: 'file:///slip.pdf' })) }));
vi.mock('expo-sharing', () => ({ isAvailableAsync: vi.fn(async () => true), shareAsync: vi.fn(async () => {}) }));
vi.mock('@/lib/packingSlip', () => ({
  buildPackingSlipHtml: vi.fn(() => '<html>slip</html>'),
  sharePackingSlip: vi.fn(async () => {}),
}));

import { Linking } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { sharePackingSlip } from '@/lib/packingSlip';
import { isPrintCancel, labelPrintOptions, printLabel, printPackingSlip } from './airPrint';

const order = { id: 'o1' } as any;

beforeEach(() => {
  vi.clearAllMocks();
  platform.OS = 'ios';
});

describe('labelPrintOptions', () => {
  it('prints PDFs by uri and wraps image labels in html', () => {
    expect(labelPrintOptions('https://x.test/label.pdf')).toEqual({ uri: 'https://x.test/label.pdf' });
    expect(labelPrintOptions('https://x.test/label.png?sig=1').html).toContain('<img src="https://x.test/label.png?sig=1"');
  });
});

describe('printLabel', () => {
  it('opens the print dialog directly', async () => {
    await printLabel('https://x.test/label.pdf');
    expect(Print.printAsync).toHaveBeenCalledWith({ uri: 'https://x.test/label.pdf' });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('falls back to the share sheet when printing fails', async () => {
    vi.mocked(Print.printAsync).mockRejectedValueOnce(new Error('No printer service'));
    await printLabel('https://x.test/label.pdf');
    expect(Sharing.shareAsync).toHaveBeenCalledWith('https://x.test/label.pdf');
  });

  it('does nothing more when the seller cancels', async () => {
    vi.mocked(Print.printAsync).mockRejectedValueOnce(new Error('Printing did not complete'));
    await printLabel('https://x.test/label.pdf');
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('opens the URL on web', async () => {
    platform.OS = 'web';
    await printLabel('https://x.test/label.pdf');
    expect(Print.printAsync).not.toHaveBeenCalled();
    expect(Linking.openURL).toHaveBeenCalledWith('https://x.test/label.pdf');
  });
});

describe('printPackingSlip', () => {
  it('prints the slip html directly', async () => {
    await printPackingSlip(order);
    expect(Print.printAsync).toHaveBeenCalledWith({ html: '<html>slip</html>' });
    expect(sharePackingSlip).not.toHaveBeenCalled();
  });

  it('shares the slip on web and on errors', async () => {
    vi.mocked(Print.printAsync).mockRejectedValueOnce(new Error('boom'));
    await printPackingSlip(order);
    expect(sharePackingSlip).toHaveBeenCalledTimes(1);
    platform.OS = 'web';
    await printPackingSlip(order);
    expect(sharePackingSlip).toHaveBeenCalledTimes(2);
  });
});

describe('isPrintCancel', () => {
  it('recognises cancellation messages', () => {
    expect(isPrintCancel(new Error('Print cancelled'))).toBe(true);
    expect(isPrintCancel(new Error('No printer'))).toBe(false);
  });
});
