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
import { SaveToCollectionSheet, type SaveToCollectionItem } from '@/components/SaveToCollectionSheet';
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
  /** Non-product item (a saved post) the sheet is filing, with its thumbnail. */
  const [sheetItem, setSheetItem] = useState<{ item: SaveToCollectionItem; thumbnailUri?: string } | null>(null);
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
      setSheetItem(null);
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
      setSheetItem(null);
      setSheetDraft(action.draft);
      setSheetOpen(true);
    } else if (action.kind === 'save-to-collection') {
      setSheetDraft(null);
      setSheetItem({ item: action.item, thumbnailUri: action.thumbnailUri });
      setSheetOpen(true);
    } else if (action.kind === 'view-collection') {
      router.push(`/buyer-collection?collectionId=${encodeURIComponent(action.collectionId)}` as never);
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
        thumbnailUri={toast?.thumbnailUri}
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
        } : sheetItem?.item ?? null}
        onClose={() => setSheetOpen(false)}
        onSaved={(collectionId, collectionName) => {
          if (sheetDraft) {
            savedProducts.markSaved(sheetDraft.productId);
            showToast({ message: collectionId ? 'Saved to collection' : 'Saved' });
            return;
          }
          // Saved posts: Instagram's "Saved to <collection> · View" bar.
          showToast(collectionId ? {
            message: collectionName ? `Saved to ${collectionName}` : 'Saved to collection',
            thumbnailUri: sheetItem?.thumbnailUri,
            actionLabel: 'View',
            action: { kind: 'view-collection', collectionId },
          } : { message: 'Saved', thumbnailUri: sheetItem?.thumbnailUri });
        }}
      />
    </>
  );
}
