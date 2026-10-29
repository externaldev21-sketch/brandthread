/**
 * `Alert.alert` is a silent no-op on react-native-web, so confirms, errors and
 * Alert-built menus were dead taps in the web build. lib/actionSheet.ts's
 * `showAlert` keeps native on `Alert.alert` (unchanged) and hands web alerts
 * to the themed modal host (components/ui/WebAlertHost.tsx).
 */
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { alertMock, platform } = vi.hoisted(() => ({
  alertMock: vi.fn(),
  platform: { OS: 'ios' as string },
}));

vi.mock('react-native', () => ({
  Alert: { alert: alertMock },
  ActionSheetIOS: { showActionSheetWithOptions: vi.fn() },
  Platform: platform,
}));

const root = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

async function load() {
  vi.resetModules();
  return import('@/lib/actionSheet');
}

beforeEach(() => {
  alertMock.mockReset();
  platform.OS = 'ios';
});

describe('showAlert', () => {
  it('calls the native Alert.alert with the exact same arguments on iOS/Android', async () => {
    const { showAlert, registerWebAlertPresenter } = await load();
    const presenter = vi.fn();
    registerWebAlertPresenter(presenter);
    const buttons = [{ text: 'Cancel', style: 'cancel' as const }, { text: 'Delete', style: 'destructive' as const, onPress: vi.fn() }];

    showAlert('Delete Layer', 'This cannot be undone.', buttons);
    platform.OS = 'android';
    showAlert('Saved', 'Photo saved to your library.');

    expect(alertMock).toHaveBeenNthCalledWith(1, 'Delete Layer', 'This cannot be undone.', buttons, undefined);
    expect(alertMock).toHaveBeenNthCalledWith(2, 'Saved', 'Photo saved to your library.', undefined, undefined);
    expect(presenter).not.toHaveBeenCalled();
  });

  it('hands the alert to the web host on web, defaulting to a single OK button', async () => {
    platform.OS = 'web';
    const { showAlert, registerWebAlertPresenter } = await load();
    const presenter = vi.fn();
    registerWebAlertPresenter(presenter);
    const onPress = vi.fn();

    showAlert('Could not delete', 'Check your connection and try again.');
    showAlert('Your story', undefined, [{ text: 'Delete', style: 'destructive', onPress }]);

    expect(alertMock).not.toHaveBeenCalled();
    expect(presenter).toHaveBeenNthCalledWith(1, {
      title: 'Could not delete', message: 'Check your connection and try again.', buttons: [{ text: 'OK' }], options: undefined,
    });
    expect(presenter.mock.calls[1][0].buttons[0].onPress).toBe(onPress);
  });

  it('queues web alerts raised before the host mounts and flushes them on register', async () => {
    platform.OS = 'web';
    const { showAlert, registerWebAlertPresenter } = await load();
    showAlert('Early', 'Before mount');
    const presenter = vi.fn();
    registerWebAlertPresenter(presenter);
    expect(presenter).toHaveBeenCalledWith(expect.objectContaining({ title: 'Early', message: 'Before mount' }));
  });

  it('confirmAlert resolves with the chosen button on every platform', async () => {
    platform.OS = 'web';
    const { confirmAlert, registerWebAlertPresenter } = await load();
    let last: { buttons: Array<{ text?: string; onPress?: () => void }> } | null = null;
    registerWebAlertPresenter((req) => { last = req; });

    const yes = confirmAlert({ title: 'Delete story?', confirmLabel: 'Delete', destructive: true });
    last!.buttons.find((b) => b.text === 'Delete')!.onPress!();
    await expect(yes).resolves.toBe(true);

    const no = confirmAlert({ title: 'Delete story?', confirmLabel: 'Delete' });
    last!.buttons.find((b) => b.text === 'Cancel')!.onPress!();
    await expect(no).resolves.toBe(false);
  });
});

describe('web alert host wiring', () => {
  it('is mounted once at the app root next to the action sheet host', () => {
    const layout = read('app/_layout.tsx');
    expect(layout).toContain("import { WebAlertHost } from '@/components/ui/WebAlertHost';");
    expect(layout.match(/<WebAlertHost \/>/g)).toHaveLength(1);
  });

  it('renders only on web, from theme tokens and Inter', () => {
    const host = read('components/ui/WebAlertHost.tsx');
    expect(host).toContain("if (Platform.OS !== 'web') return null;");
    expect(host).toContain('registerWebAlertPresenter(');
    expect(host).toContain('backgroundColor: theme.card, borderColor: theme.border');
    expect(host).toContain('fontFamily: FONT.semibold');
  });
});

describe('high-impact call sites use showAlert instead of the dead-on-web Alert.alert', () => {
  const files = [
    'app/buyer-story-viewer.tsx',
    'app/design-canvas.tsx',
    'app/product-variants.tsx',
    'app/activity-center.tsx',
    'app/seller-activity.tsx',
    'app/buyer-notifications.tsx',
    'components/chat/MediaViewer.tsx',
  ];
  it.each(files)('%s', (file) => {
    const src = read(file);
    expect(src).not.toMatch(/\bAlert\.alert\(/);
    expect(src).toContain("import { showAlert } from '@/lib/actionSheet';");
    expect(src).toMatch(/\bshowAlert\(/);
  });

  it('keeps the story viewer delete confirm copy and handler shape', () => {
    const src = read('app/buyer-story-viewer.tsx');
    expect(src).toContain("showAlert('Your story', undefined, [");
    expect(src).toContain("showAlert('Couldn’t delete', 'Try again.');");
  });

  it('deletes a design canvas layer instantly and undoably, like Procreate (no confirm to go dead on web)', () => {
    const src = read('app/design-canvas.tsx');
    const fn = src.slice(src.indexOf('function handleDeleteLayer('), src.indexOf('function handleDuplicateLayer('));
    expect(fn).toContain('mutateLayer(prev => prev.filter(l => l.id !== id));');
    expect(fn).not.toMatch(/Alert|confirm/);
  });
});
