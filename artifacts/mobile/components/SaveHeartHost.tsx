/**
 * SaveHeartHost — mounted once at the app root. Owns the saved-products
 * cache's auth sync plus the single toast and "Save to…" sheet every
 * SaveHeart reports into (see lib/saved/saveHeartBus.ts).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSegments } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { Snackbar } from '@/components/ui/Snackbar';
import { SaveToCollectionSheet } from '@/components/SaveToCollectionSheet';
import { useSavedProductsSync } from '@/hooks/useSavedProduct';
import { registerSaveHeartHost, type SaveHeartToast } from '@/lib/saved/saveHeartBus';
import { savedProducts } from '@/lib/saved/savedProducts';
import type { SavedProductDraft } from '@/lib/saved/savedProductsStore';

const TOAST_MS = 4000;
/** Height of the sticky Add to cart footer on product detail (before the bottom safe area). */
const DETAIL_FOOTER_H = 84;

export function SaveHeartHost() {
  useSavedProductsSync();
  const router = useRouter();
  const segments = useSegments() as string[];
  const insets = useSafeAreaInsets();
  const barInset = useBuyerTabBarInset();
  const [toast, setToast] = useState<SaveHeartToast | null>(null);
  const [sheetDraft, setSheetDraft] = useState<SavedProductDraft | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };

  const showToast = useCallback((next: SaveHeartToast) => {
    clearTimer();
    setToast(next);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);

  useEffect(() => registerSaveHeartHost((event) => {
    if (event.type === 'toast') {
      showToast(event.toast);
    } else {
      clearTimer();
      setToast(null);
      setSheetDraft(event.draft);
      setSheetOpen(true);
    }
  }), [showToast]);

  useEffect(() => clearTimer, []);

  const onToastAction = useCallback(() => {
    const action = toast?.action;
    clearTimer();
    setToast(null);
    if (!action) return;
    if (action.kind === 'collection') {
      setSheetDraft(action.draft);
      setSheetOpen(true);
    } else {
      router.push('/sign-in' as never);
    }
  }, [toast, router]);

  // Keep the toast clear of the floating buyer tab bar and of product
  // detail's sticky purchase footer; everywhere else the default applies.
  const isDetail = segments.some((seg) => seg === 'thread-product-detail' || seg === 'buyer-product-detail');
  const bottomOffset = isDetail
    ? insets.bottom + DETAIL_FOOTER_H + 12
    : segments[0] === '(buyer)' ? barInset + 12 : undefined;

  return (
    <>
      <Snackbar
        bottomOffset={bottomOffset}
        visible={!!toast}
        message={toast?.message ?? ''}
        actionLabel={toast?.actionLabel}
        onAction={toast?.action ? onToastAction : undefined}
      />
      <SaveToCollectionSheet
        visible={sheetOpen}
        item={sheetDraft ? {
          type: 'product',
          targetId: sheetDraft.productId,
          title: sheetDraft.title,
          subtitle: sheetDraft.brand,
          priceCents: sheetDraft.priceCents,
        } : null}
        onClose={() => setSheetOpen(false)}
        onSaved={(collectionId) => {
          if (sheetDraft) savedProducts.markSaved(sheetDraft.productId);
          showToast({ message: collectionId ? 'Saved to collection' : 'Saved' });
        }}
      />
    </>
  );
}
