/**
 * AirPrint helpers: send a shipping label or packing slip straight to the
 * system print dialog (Shopify's "Print" action), falling back to the share
 * sheet on web or when printing is unavailable.
 */
import { Linking, Platform } from 'react-native';
import type * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { buildPackingSlipHtml, sharePackingSlip } from '@/lib/packingSlip';
import type { Order } from '@/services/orderTypes';

const IMAGE_LABEL = /\.(png|jpe?g|gif)(\?|#|$)/i;

/** The print dialog was dismissed by the seller: not an error, no fallback. */
export function isPrintCancel(err: unknown): boolean {
  const message = String((err as { message?: unknown } | null)?.message ?? err ?? '');
  return /cancel|did not complete/i.test(message);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

/** Print options for a carrier label URL: PDFs print as-is, images wrap in a page. */
export function labelPrintOptions(labelUrl: string): Print.PrintOptions {
  if (IMAGE_LABEL.test(labelUrl)) {
    return {
      html: `<html><body style="margin:0"><img src="${escapeAttr(labelUrl)}" style="width:100%" /></body></html>`,
    };
  }
  return { uri: labelUrl };
}

async function shareLabelUrl(labelUrl: string): Promise<void> {
  try {
    if (Platform.OS !== 'web' && await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(labelUrl);
      return;
    }
  } catch {
    // Fall through to opening the URL.
  }
  await Linking.openURL(labelUrl).catch(() => {});
}

/** Open the AirPrint dialog for a shipping label. */
export async function printLabel(labelUrl: string): Promise<void> {
  if (Platform.OS === 'web') {
    await Linking.openURL(labelUrl).catch(() => {});
    return;
  }
  try {
    const Print = await import('expo-print');
    await Print.printAsync(labelPrintOptions(labelUrl));
  } catch (err) {
    if (isPrintCancel(err)) return;
    await shareLabelUrl(labelUrl);
  }
}

/** Open the AirPrint dialog for an order's packing slip. */
export async function printPackingSlip(order: Order): Promise<void> {
  if (Platform.OS === 'web') {
    await sharePackingSlip(order);
    return;
  }
  try {
    const Print = await import('expo-print');
    await Print.printAsync({ html: buildPackingSlipHtml(order) });
  } catch (err) {
    if (isPrintCancel(err)) return;
    await sharePackingSlip(order);
  }
}
