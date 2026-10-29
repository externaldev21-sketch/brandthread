import { afterEach, describe, expect, it, vi } from 'vitest';
import { Platform } from 'react-native';
import { registerWebAlertPresenter } from './actionSheet';
import { AI_CREDITS_ALERT_COPY, surfaceAiCreditsError } from './aiCreditsError';

const originalOS = Platform.OS;
afterEach(() => {
  (Platform as { OS: string }).OS = originalOS;
  registerWebAlertPresenter(null);
});

describe('surfaceAiCreditsError on web', () => {
  it('shows the daily-cap alert through the web alert host (Alert.alert is a no-op on web)', () => {
    (Platform as { OS: string }).OS = 'web';
    const presenter = vi.fn();
    registerWebAlertPresenter(presenter);
    surfaceAiCreditsError('user_daily_cap', 1_000_000);
    expect(presenter).toHaveBeenCalledTimes(1);
    expect(presenter.mock.calls[0][0]).toMatchObject({
      title: AI_CREDITS_ALERT_COPY.user_daily_cap.title,
      message: AI_CREDITS_ALERT_COPY.user_daily_cap.message,
    });
  });
});
