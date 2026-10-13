import { describe, expect, it } from 'vitest';
import { isConfirmationAlert, toIOSActionSheetOptions, toastIconFor } from '@/lib/confirmationSheet';

describe('confirmations are bottom action sheets', () => {
  it('treats 2+ buttons as a confirmation, one or none as a notice', () => {
    expect(isConfirmationAlert([{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive' }])).toBe(true);
    expect(isConfirmationAlert([{ text: 'OK' }])).toBe(false);
    expect(isConfirmationAlert(undefined)).toBe(false);
  });

  it('maps an Alert button list onto the iOS action sheet', () => {
    expect(toIOSActionSheetOptions('Delete post?', 'This can’t be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Archive' },
      { text: 'Delete', style: 'destructive' },
    ])).toEqual({
      options: ['Cancel', 'Archive', 'Delete'],
      cancelButtonIndex: 0,
      destructiveButtonIndex: [2],
      title: 'Delete post?',
      message: 'This can’t be undone.',
      userInterfaceStyle: 'dark',
    });
  });

  it('leaves out indexes and copy that are not there', () => {
    expect(toIOSActionSheetOptions(undefined, undefined, [{ text: 'A' }, { text: 'B' }])).toEqual({
      options: ['A', 'B'], userInterfaceStyle: 'dark',
    });
  });
});

describe('toast icon', () => {
  it('uses a check for confirmations and an alert for failures', () => {
    expect(toastIconFor('Link copied')).toBe('check');
    expect(toastIconFor("Couldn't save")).toBe('alert-circle');
    expect(toastIconFor('Failed to send')).toBe('alert-circle');
  });
});
