/**
 * Default spoken labels for icon-only controls.
 *
 * An icon-only button has no text for a screen reader to fall back on, so an
 * unlabeled one is announced as just "button". The shared IconButton
 * primitives use this table to derive a sensible label from the Feather glyph
 * name when a call site did not pass an explicit `accessibilityLabel` (an
 * explicit label always wins). Names are the action the control performs, not
 * a description of the picture.
 */
export const ICON_LABELS: Readonly<Record<string, string>> = {
  'arrow-left': 'Back',
  'chevron-left': 'Back',
  'arrow-right': 'Next',
  'chevron-right': 'Next',
  'chevron-down': 'Expand',
  'chevron-up': 'Collapse',
  x: 'Close',
  'x-circle': 'Clear',
  check: 'Done',
  heart: 'Like',
  'message-circle': 'Comments',
  'message-square': 'Messages',
  send: 'Send',
  share: 'Share',
  'share-2': 'Share',
  upload: 'Upload',
  download: 'Download',
  bookmark: 'Save',
  'more-horizontal': 'More options',
  'more-vertical': 'More options',
  search: 'Search',
  plus: 'Add',
  'plus-circle': 'Add',
  minus: 'Remove',
  'shopping-bag': 'Cart',
  'shopping-cart': 'Cart',
  bell: 'Notifications',
  settings: 'Settings',
  user: 'Profile',
  home: 'Home',
  camera: 'Camera',
  image: 'Photos',
  edit: 'Edit',
  'edit-2': 'Edit',
  'edit-3': 'Edit',
  trash: 'Delete',
  'trash-2': 'Delete',
  copy: 'Copy',
  link: 'Copy link',
  filter: 'Filter',
  sliders: 'Filters',
  mic: 'Record voice message',
  phone: 'Call',
  video: 'Video call',
  flag: 'Report',
  info: 'Information',
  'help-circle': 'Help',
  'refresh-cw': 'Refresh',
  'external-link': 'Open link',
  lock: 'Locked',
  eye: 'Show',
  'eye-off': 'Hide',
  star: 'Favorite',
  play: 'Play',
  pause: 'Pause',
  'volume-2': 'Sound on',
  'volume-x': 'Sound off',
};

/** Fallback for a glyph not in the table: "arrow-up-right" -> "Arrow up right". */
function humanize(name: string): string {
  const words = name.replace(/[-_]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : '';
}

/**
 * The label to speak for an icon-only control: the explicit label if the
 * caller gave a non-empty one, else the mapped default, else a humanized
 * glyph name (never undefined, so the control is never announced bare).
 */
export function iconAccessibilityLabel(name: string, explicit?: string | null): string {
  const trimmed = explicit?.trim();
  if (trimmed) return trimmed;
  return ICON_LABELS[name] ?? humanize(name);
}
