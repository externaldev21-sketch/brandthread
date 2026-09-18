import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'components/ThreadShareSheet.tsx'), 'utf8');
const feed = readFileSync(resolve(process.cwd(), 'app/(tabs)/feed.tsx'), 'utf8');

describe('Thread video sharing flow', () => {
  it('opens Brandthread sharing before the native system sheet', () => {
    expect(feed).toContain('setShareOpen(true)');
    expect(feed).toContain('<ThreadShareSheet');
    expect(source).toContain('<Text style={styles.title}>Share to</Text>');
  });

  it('provides real recipient, external share, moderation, and download actions', () => {
    for (const label of [
      'More friends',
      'Copy link',
      'Messages',
      'Email',
      'More',
      'Report',
      'Not interested',
      'Save video',
    ]) {
      expect(source).toContain(`label="${label}"`);
    }
    expect(source).toContain('createOrGetConversation');
    expect(source).toContain('sendMessage(');
    expect(source).toContain('actionInFlightRef.current');
    expect(source).toContain('Clipboard.setStringAsync');
    expect(source).toContain('File.downloadFileAsync');
    expect(source).toContain('MediaLibrary.Asset.create');
  });

  it('shows cancellable save progress above the bottom tab bar', () => {
    expect(source).toContain('{savingProgress}% Saving…');
    expect(source).toContain("abortRef.current?.abort()");
    expect(source).toContain("onFeedback('Video save cancelled.'");
    expect(source).toContain('destination.delete()');
    expect(source).toContain('bottom: insets.bottom + 70');
  });

  it('handles permanent Photos denial without requesting permission before Save video is tapped', () => {
    const saveVideoStart = source.indexOf('async function saveVideo()');
    const permissionRequest = source.indexOf('MediaLibrary.requestPermissionsAsync()', saveVideoStart);
    const saveAction = source.indexOf('label="Save video"');

    expect(saveVideoStart).toBeGreaterThan(-1);
    expect(permissionRequest).toBeGreaterThan(saveVideoStart);
    expect(saveAction).toBeGreaterThan(permissionRequest);
    expect(source).toContain('if (!permission.canAskAgain)');
    expect(source).toContain('Linking.openSettings()');
    expect(source).toContain('Photos access is off');
  });
});