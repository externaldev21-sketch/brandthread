/**
 * One bus for the two native-feeling menus, rendered by
 * `<ContextMenuHost />` (mounted once in app/_layout.tsx):
 *
 *  - `openContextMenu`  — long-press preview menu (Instagram grid long-press:
 *    the screen blurs, an enlarged preview card of the item appears with the
 *    action list under it). Plays the "rigid" haptic when it opens.
 *  - `openPullDownMenu` — the ⋯ header button menu, laid out like an iOS
 *    UIMenu pull-down (Apple HIG "Pull-down buttons"): anchored to the
 *    button, label left / symbol right, destructive items red.
 *
 * Call sites keep their existing `{ text, style, onPress }` button arrays:
 * `menuItemsFromButtons` converts them and drops the Cancel entry, because a
 * menu is dismissed by tapping outside it.
 *
 * Pure module (no react-native import) so it is unit-tested directly.
 */
import type { ComponentProps } from 'react';
import type { Feather } from '@expo/vector-icons';

export type MenuIcon = ComponentProps<typeof Feather>['name'];

export interface MenuItem {
  key?: string;
  label: string;
  icon?: MenuIcon;
  destructive?: boolean;
  disabled?: boolean;
  /** Shows a check mark (a picked option in a pull-down). */
  checked?: boolean;
  onPress?: () => void;
}

export interface ContextMenuPreview {
  /** Media shown big in the preview card (image or video poster). */
  imageUri?: string | null;
  /** width / height of the media; clamped to a sensible card shape. */
  aspectRatio?: number;
  title?: string | null;
  subtitle?: string | null;
  avatarUri?: string | null;
  /** Text-only preview (a message, a conversation's last message). */
  body?: string | null;
}

export interface ContextMenuRequest {
  id: number;
  preview: ContextMenuPreview;
  items: MenuItem[];
  /** Tapping the preview card itself (usually: open the item). */
  onPreviewPress?: () => void;
}

export interface MenuAnchor {
  /** Window coordinates of the touch / button. */
  x: number;
  y: number;
}

export interface PullDownRequest {
  id: number;
  title?: string;
  items: MenuItem[];
  anchor: MenuAnchor | null;
  /** Runs when the menu closes without an item being picked. */
  onDismiss?: () => void;
}

type State = { context: ContextMenuRequest | null; pullDown: PullDownRequest | null };
type Listener = (state: State) => void;

let state: State = { context: null, pullDown: null };
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(state);
}

export function subscribeMenus(listener: Listener): () => void {
  listeners.add(listener);
  listener(state);
  return () => { listeners.delete(listener); };
}

export function hasMenuHost(): boolean {
  return listeners.size > 0;
}

export function getMenuState(): State {
  return state;
}

/** Same shape as `Alert.alert` / `showActionSheet` buttons. */
export type LegacyMenuButton = { text?: string; style?: 'default' | 'cancel' | 'destructive'; onPress?: () => void };

export function menuItemsFromButtons(
  buttons: ReadonlyArray<LegacyMenuButton | null | undefined | false>,
  icons?: Record<string, MenuIcon | undefined>,
): MenuItem[] {
  return buttons
    .filter((b): b is LegacyMenuButton => !!b && typeof b === 'object')
    .filter((b) => b.style !== 'cancel' && !!b.text && b.text.trim().toLowerCase() !== 'cancel')
    .map((b) => ({
      key: b.text,
      label: b.text as string,
      destructive: b.style === 'destructive',
      icon: icons?.[b.text as string],
      onPress: b.onPress,
    }));
}

/** Reads a touch's window position from an RN press event, if there is one. */
export function anchorFromEvent(event: unknown): MenuAnchor | null {
  const ne = (event as { nativeEvent?: { pageX?: unknown; pageY?: unknown } } | null | undefined)?.nativeEvent;
  if (!ne || typeof ne.pageX !== 'number' || typeof ne.pageY !== 'number') return null;
  if (!Number.isFinite(ne.pageX) || !Number.isFinite(ne.pageY)) return null;
  return { x: ne.pageX, y: ne.pageY };
}

/**
 * Opens the long-press preview menu. Returns false (and does nothing) when
 * there are no items or no host is mounted, so callers can keep a fallback.
 */
export function openContextMenu(req: Omit<ContextMenuRequest, 'id'>): boolean {
  const items = req.items.filter((i) => !!i && !!i.label);
  if (!items.length || !hasMenuHost()) return false;
  state = { ...state, context: { ...req, items, id: nextId++ } };
  emit();
  return true;
}

/**
 * Opens the ⋯ pull-down menu anchored at the press event (falls back to the
 * top-right header slot when the event carries no position).
 */
export function openPullDownMenu(
  event: unknown,
  items: MenuItem[],
  opts?: { title?: string; onDismiss?: () => void },
): boolean {
  const clean = items.filter((i) => !!i && !!i.label);
  if (!clean.length || !hasMenuHost()) return false;
  state = {
    ...state,
    pullDown: { id: nextId++, title: opts?.title, items: clean, anchor: anchorFromEvent(event), onDismiss: opts?.onDismiss },
  };
  emit();
  return true;
}

/** `openPullDownMenu` for a caller that already holds the anchor. */
export function openPullDownMenuAt(anchor: MenuAnchor | null, items: MenuItem[], opts?: { title?: string; onDismiss?: () => void }): boolean {
  return openPullDownMenu(anchor ? { nativeEvent: { pageX: anchor.x, pageY: anchor.y } } : null, items, opts);
}

export function closeContextMenu(): void {
  if (!state.context) return;
  state = { ...state, context: null };
  emit();
}

export function closePullDownMenu(): void {
  if (!state.pullDown) return;
  state = { ...state, pullDown: null };
  emit();
}

/** Clamp a media aspect ratio into the card shapes the preview supports
 *  (4:5 portrait … 1.91:1 landscape, Instagram's feed range). */
export function previewAspectRatio(ratio: number | null | undefined): number {
  if (!ratio || !Number.isFinite(ratio) || ratio <= 0) return 4 / 5;
  return Math.min(1.91, Math.max(4 / 5, ratio));
}

/**
 * Where to place a pull-down menu of `menuWidth` × `menuHeight` for an
 * anchor inside a window, iOS-style: it drops below the button and aligns
 * its trailing edge with the button when the button sits on the right half
 * (leading edge otherwise), never leaving the safe area.
 */
export function placePullDown(
  anchor: MenuAnchor | null,
  menu: { width: number; height: number },
  win: { width: number; height: number; top: number; bottom: number },
): { left: number; top: number; origin: 'left' | 'right' } {
  const margin = 8;
  const a = anchor ?? { x: win.width - 28, y: win.top + 28 };
  const right = a.x > win.width / 2;
  let left = right ? a.x + 22 - menu.width : a.x - 22;
  left = Math.max(margin, Math.min(win.width - menu.width - margin, left));
  let top = a.y + 22;
  const maxTop = win.height - win.bottom - margin - menu.height;
  if (top > maxTop) top = Math.max(win.top + margin, a.y - 22 - menu.height);
  return { left: Math.round(left), top: Math.round(Math.max(win.top + margin, top)), origin: right ? 'right' : 'left' };
}

/** Tests only. */
export function resetMenus(): void {
  state = { context: null, pullDown: null };
  emit();
}
