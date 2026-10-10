/**
 * Feather name → SF Symbol (iOS) + Material Icons (Android/web) map, used by
 * `components/ui/Icon.tsx`.
 *
 * Keyed by the Feather names the app already uses so a screen moves off
 * Feather by swapping the import only (`<Feather name="x" />` →
 * `<Icon name="x" />`), with no renaming. A name missing here, or missing a
 * platform entry, renders the Feather glyph instead of nothing, so a gap is
 * a visual inconsistency, never a blank or a crash. Brand marks (facebook,
 * instagram, …) are left out on purpose: neither symbol set has them.
 *
 * Every SF name is available on iOS 15 (SF Symbols 3), checked against
 * sf-symbols-typescript by tests/icon-map.test.ts.
 */
import type { Feather, MaterialIcons } from '@expo/vector-icons';

export type FeatherName = keyof typeof Feather.glyphMap;
export type MaterialName = keyof typeof MaterialIcons.glyphMap;

export interface IconMapping {
  sf?: string;
  material?: MaterialName;
}

export const ICON_MAP: Partial<Record<FeatherName, IconMapping>> = {
  // Navigation and chevrons
  'chevron-right': { sf: 'chevron.right', material: 'chevron-right' },
  'chevron-left': { sf: 'chevron.left', material: 'chevron-left' },
  'chevron-down': { sf: 'chevron.down', material: 'expand-more' },
  'chevron-up': { sf: 'chevron.up', material: 'expand-less' },
  'chevrons-up': { sf: 'chevron.up', material: 'keyboard-double-arrow-up' },
  'chevrons-down': { sf: 'chevron.down', material: 'keyboard-double-arrow-down' },
  'arrow-left': { sf: 'arrow.left', material: 'arrow-back' },
  'arrow-right': { sf: 'arrow.right', material: 'arrow-forward' },
  'arrow-up': { sf: 'arrow.up', material: 'arrow-upward' },
  'arrow-down': { sf: 'arrow.down', material: 'arrow-downward' },
  'arrow-up-right': { sf: 'arrow.up.right', material: 'north-east' },
  'arrow-down-left': { sf: 'arrow.down.left', material: 'south-west' },
  'arrow-right-circle': { sf: 'arrow.right.circle', material: 'arrow-circle-right' },
  'arrow-down-circle': { sf: 'arrow.down.circle', material: 'arrow-circle-down' },
  'corner-up-left': { sf: 'arrowshape.turn.up.left', material: 'reply' },
  'corner-up-right': { sf: 'arrowshape.turn.up.right', material: 'forward' },
  'corner-down-right': { sf: 'arrow.turn.down.right', material: 'subdirectory-arrow-right' },
  'external-link': { sf: 'arrow.up.right.square', material: 'open-in-new' },
  menu: { sf: 'line.3.horizontal', material: 'menu' },
  'more-horizontal': { sf: 'ellipsis', material: 'more-horiz' },
  'more-vertical': { material: 'more-vert' },
  home: { sf: 'house', material: 'home' },
  compass: { sf: 'safari', material: 'explore' },
  'log-out': { sf: 'rectangle.portrait.and.arrow.right', material: 'logout' },
  'log-in': { sf: 'arrow.right.square', material: 'login' },

  // Actions
  check: { sf: 'checkmark', material: 'check' },
  x: { sf: 'xmark', material: 'close' },
  plus: { sf: 'plus', material: 'add' },
  minus: { sf: 'minus', material: 'remove' },
  search: { sf: 'magnifyingglass', material: 'search' },
  'zoom-in': { sf: 'plus.magnifyingglass', material: 'zoom-in' },
  'zoom-out': { sf: 'minus.magnifyingglass', material: 'zoom-out' },
  edit: { sf: 'square.and.pencil', material: 'edit' },
  'edit-2': { sf: 'pencil', material: 'edit' },
  'edit-3': { sf: 'pencil', material: 'edit' },
  'trash-2': { sf: 'trash', material: 'delete-outline' },
  trash: { sf: 'trash', material: 'delete-outline' },
  copy: { sf: 'doc.on.doc', material: 'content-copy' },
  clipboard: { sf: 'doc.on.clipboard', material: 'content-paste' },
  share: { sf: 'square.and.arrow.up', material: 'ios-share' },
  'share-2': { sf: 'square.and.arrow.up', material: 'share' },
  send: { sf: 'paperplane', material: 'send' },
  download: { sf: 'arrow.down.to.line', material: 'file-download' },
  upload: { sf: 'arrow.up.to.line', material: 'file-upload' },
  'upload-cloud': { sf: 'icloud.and.arrow.up', material: 'cloud-upload' },
  'cloud-off': { sf: 'icloud.slash', material: 'cloud-off' },
  save: { sf: 'square.and.arrow.down', material: 'save' },
  'refresh-cw': { sf: 'arrow.clockwise', material: 'refresh' },
  'refresh-ccw': { sf: 'arrow.counterclockwise', material: 'refresh' },
  'rotate-ccw': { sf: 'arrow.counterclockwise', material: 'replay' },
  'rotate-cw': { sf: 'arrow.clockwise', material: 'refresh' },
  repeat: { sf: 'repeat', material: 'repeat' },
  shuffle: { sf: 'shuffle', material: 'shuffle' },
  filter: { sf: 'line.3.horizontal.decrease', material: 'filter-list' },
  sliders: { sf: 'slider.horizontal.3', material: 'tune' },
  crop: { sf: 'crop', material: 'crop' },
  scissors: { sf: 'scissors', material: 'content-cut' },
  link: { sf: 'link', material: 'link' },
  'link-2': { sf: 'link', material: 'link' },
  paperclip: { sf: 'paperclip', material: 'attach-file' },
  printer: { sf: 'printer', material: 'print' },
  maximize: { sf: 'arrow.up.left.and.arrow.down.right', material: 'fullscreen' },
  'maximize-2': { sf: 'arrow.up.left.and.arrow.down.right', material: 'open-in-full' },
  'minimize-2': { sf: 'arrow.down.right.and.arrow.up.left', material: 'close-fullscreen' },
  lock: { sf: 'lock', material: 'lock-outline' },
  unlock: { sf: 'lock.open', material: 'lock-open' },
  key: { sf: 'key', material: 'vpn-key' },
  eye: { sf: 'eye', material: 'visibility' },
  'eye-off': { sf: 'eye.slash', material: 'visibility-off' },
  slash: { sf: 'nosign', material: 'block' },
  flag: { sf: 'flag', material: 'outlined-flag' },
  bookmark: { sf: 'bookmark', material: 'bookmark-border' },
  heart: { sf: 'heart', material: 'favorite-border' },
  star: { sf: 'star', material: 'star-border' },
  'thumbs-up': { sf: 'hand.thumbsup', material: 'thumb-up-off-alt' },
  'thumbs-down': { sf: 'hand.thumbsdown', material: 'thumb-down-off-alt' },

  // Status
  'alert-circle': { sf: 'exclamationmark.circle', material: 'error-outline' },
  'alert-triangle': { sf: 'exclamationmark.triangle', material: 'warning-amber' },
  'alert-octagon': { sf: 'exclamationmark.octagon', material: 'report' },
  info: { sf: 'info.circle', material: 'info-outline' },
  'help-circle': { sf: 'questionmark.circle', material: 'help-outline' },
  'check-circle': { sf: 'checkmark.circle', material: 'check-circle-outline' },
  'x-circle': { sf: 'xmark.circle', material: 'highlight-off' },
  'plus-circle': { sf: 'plus.circle', material: 'add-circle-outline' },
  'minus-circle': { sf: 'minus.circle', material: 'remove-circle-outline' },
  'check-square': { sf: 'checkmark.square', material: 'check-box' },
  square: { sf: 'square', material: 'check-box-outline-blank' },
  circle: { sf: 'circle', material: 'radio-button-unchecked' },
  loader: { sf: 'hourglass', material: 'hourglass-empty' },
  clock: { sf: 'clock', material: 'schedule' },
  calendar: { sf: 'calendar', material: 'event' },
  'wifi-off': { sf: 'wifi.slash', material: 'wifi-off' },
  shield: { sf: 'shield', material: 'shield' },
  zap: { sf: 'bolt', material: 'bolt' },
  activity: { sf: 'waveform.path.ecg', material: 'show-chart' },
  'trending-up': { sf: 'chart.line.uptrend.xyaxis', material: 'trending-up' },
  'trending-down': { sf: 'arrow.down.right', material: 'trending-down' },
  'bar-chart': { sf: 'chart.bar', material: 'bar-chart' },
  'bar-chart-2': { sf: 'chart.bar', material: 'bar-chart' },
  target: { sf: 'scope', material: 'gps-fixed' },
  award: { sf: 'rosette', material: 'military-tech' },

  // People and communication
  user: { sf: 'person', material: 'person-outline' },
  users: { sf: 'person.2', material: 'people-outline' },
  'user-plus': { sf: 'person.badge.plus', material: 'person-add-alt' },
  'user-x': { sf: 'person.badge.minus', material: 'person-remove' },
  'user-check': { sf: 'person.fill.checkmark', material: 'how-to-reg' },
  'message-circle': { sf: 'message', material: 'chat-bubble-outline' },
  'message-square': { sf: 'bubble.left', material: 'message' },
  mail: { sf: 'envelope', material: 'mail-outline' },
  inbox: { sf: 'tray', material: 'inbox' },
  'at-sign': { sf: 'at', material: 'alternate-email' },
  hash: { sf: 'number', material: 'tag' },
  bell: { sf: 'bell', material: 'notifications-none' },
  'bell-off': { sf: 'bell.slash', material: 'notifications-off' },
  phone: { sf: 'phone', material: 'phone' },
  'phone-off': { sf: 'phone.down', material: 'call-end' },
  mic: { sf: 'mic', material: 'mic-none' },
  'mic-off': { sf: 'mic.slash', material: 'mic-off' },
  headphones: { sf: 'headphones', material: 'headset' },
  'life-buoy': { sf: 'lifepreserver', material: 'support' },
  smile: { sf: 'face.smiling', material: 'sentiment-satisfied-alt' },
  globe: { sf: 'globe', material: 'public' },
  'map-pin': { sf: 'mappin', material: 'place' },
  map: { sf: 'map', material: 'map' },
  radio: { sf: 'dot.radiowaves.left.and.right', material: 'sensors' },
  rss: { sf: 'dot.radiowaves.up.forward', material: 'rss-feed' },

  // Commerce
  'shopping-bag': { sf: 'bag', material: 'shopping-bag' },
  'shopping-cart': { sf: 'cart', material: 'shopping-cart' },
  package: { sf: 'shippingbox', material: 'inventory-2' },
  box: { sf: 'cube', material: 'inventory-2' },
  truck: { sf: 'shippingbox', material: 'local-shipping' },
  tag: { sf: 'tag', material: 'local-offer' },
  gift: { sf: 'gift', material: 'card-giftcard' },
  'credit-card': { sf: 'creditcard', material: 'credit-card' },
  'dollar-sign': { sf: 'dollarsign.circle', material: 'attach-money' },
  percent: { sf: 'percent', material: 'percent' },
  briefcase: { sf: 'briefcase', material: 'work-outline' },
  archive: { sf: 'archivebox', material: 'archive' },

  // Media
  image: { sf: 'photo', material: 'image' },
  camera: { sf: 'camera', material: 'photo-camera' },
  aperture: { sf: 'camera.aperture', material: 'camera' },
  video: { sf: 'video', material: 'videocam' },
  'video-off': { sf: 'video.slash', material: 'videocam-off' },
  film: { sf: 'film', material: 'movie' },
  play: { sf: 'play', material: 'play-arrow' },
  'play-circle': { sf: 'play.circle', material: 'play-circle-outline' },
  'pause-circle': { sf: 'pause.circle', material: 'pause-circle-outline' },
  'fast-forward': { sf: 'forward', material: 'fast-forward' },
  'volume-x': { sf: 'speaker.slash', material: 'volume-off' },
  music: { sf: 'music.note', material: 'music-note' },
  tv: { sf: 'tv', material: 'tv' },
  disc: { sf: 'opticaldisc', material: 'album' },

  // Content and layout
  'file-text': { sf: 'doc.text', material: 'description' },
  file: { sf: 'doc', material: 'insert-drive-file' },
  folder: { sf: 'folder', material: 'folder-open' },
  'folder-plus': { sf: 'folder.badge.plus', material: 'create-new-folder' },
  'book-open': { sf: 'book', material: 'menu-book' },
  grid: { sf: 'square.grid.2x2', material: 'grid-view' },
  layers: { sf: 'square.stack.3d.up', material: 'layers' },
  layout: { sf: 'rectangle.split.2x1', material: 'dashboard' },
  columns: { sf: 'rectangle.split.2x1', material: 'view-column' },
  list: { sf: 'list.bullet', material: 'format-list-bulleted' },
  'align-left': { sf: 'text.alignleft', material: 'format-align-left' },
  type: { sf: 'textformat', material: 'text-fields' },
  code: { sf: 'chevron.left.forwardslash.chevron.right', material: 'code' },
  database: { sf: 'cylinder', material: 'storage' },
  cpu: { sf: 'cpu', material: 'memory' },
  tool: { sf: 'wrench', material: 'build' },
  settings: { sf: 'gearshape', material: 'settings' },
  droplet: { sf: 'drop', material: 'water-drop' },
  sun: { sf: 'sun.max', material: 'wb-sunny' },
  moon: { sf: 'moon', material: 'dark-mode' },
  'git-branch': { sf: 'arrow.triangle.branch', material: 'call-split' },
  'git-merge': { sf: 'arrow.triangle.merge', material: 'merge-type' },

  // Devices
  smartphone: { sf: 'iphone', material: 'smartphone' },
  tablet: { sf: 'ipad', material: 'tablet' },
  monitor: { sf: 'desktopcomputer', material: 'desktop-windows' },
};

/** Resolves a Feather name to its mapping, or an empty mapping (render Feather). */
export function iconMappingFor(name: FeatherName): IconMapping {
  return ICON_MAP[name] ?? {};
}

/**
 * Material glyphs (Android/web) that are solid shapes where the Feather
 * original is a line drawing. Icon renders the Feather glyph instead for
 * these, so a screen never mixes filled and outline icons off iOS (where
 * SF Symbols are used). Everything else in ICON_MAP is a line glyph.
 */
export const MATERIAL_FILLED: ReadonlySet<MaterialName> = new Set<MaterialName>([
  'album', 'archive', 'bar-chart', 'bolt', 'build', 'call-end', 'camera', 'check-box', 'cloud-off', 'cloud-upload',
  'content-paste', 'dark-mode', 'dashboard', 'description', 'edit', 'event', 'explore', 'forward', 'headset', 'home',
  'how-to-reg', 'image', 'inbox', 'insert-drive-file', 'inventory-2', 'layers', 'local-offer', 'local-shipping', 'lock-open',
  'map', 'memory', 'menu-book', 'message', 'mic-off', 'military-tech', 'movie', 'music-note', 'person-add-alt', 'person-remove',
  'phone', 'photo-camera', 'place', 'print', 'public', 'report', 'save', 'send', 'sensors', 'settings', 'share', 'shield',
  'shopping-bag', 'shopping-cart', 'smartphone', 'storage', 'support', 'tablet', 'tv', 'videocam', 'videocam-off', 'view-column',
  'visibility', 'visibility-off', 'volume-off', 'vpn-key', 'water-drop', 'wb-sunny', 'wifi-off',
]);
