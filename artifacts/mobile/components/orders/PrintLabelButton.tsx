/**
 * "Print label" action for seller order detail. Renders nothing until the
 * order has a purchased label with a printable file; then opens AirPrint.
 */
import React, { useEffect, useState } from 'react';
import { SecondaryButton } from '@/components/BrandthreadUI';
import { printLabel } from '@/lib/airPrint';
import { getPrintableLabelUrl } from '@/services/orderService';
import { isGeneratedSellerOrderId } from '@/lib/previewSellerOrders';
import { getPreviewSellerOrder } from '@/lib/previewOrders';

export function PrintLabelButton({ orderId }: { orderId: string }) {
  const [labelUrl, setLabelUrl] = useState<string | null>(null);

  useEffect(() => {
    // Preview/demo orders have no account and no labels: never call the API.
    if (!orderId || isGeneratedSellerOrderId(orderId) || getPreviewSellerOrder(orderId)) return;
    let alive = true;
    getPrintableLabelUrl(orderId)
      .then(url => { if (alive) setLabelUrl(url); })
      .catch(() => {});
    return () => { alive = false; };
  }, [orderId]);

  if (!labelUrl) return null;
  return <SecondaryButton label="Print label" icon="printer" onPress={() => { printLabel(labelUrl); }} />;
}
