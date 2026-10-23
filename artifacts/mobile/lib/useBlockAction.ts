/**
 * Reusable "Block @name" action: confirmation alert -> POST /api/social/block
 * -> success haptic. Resolves true only when the server saved the block.
 * Every menu that offers Block should call this instead of hand-rolling it.
 */
import { useCallback } from 'react';
import { Platform } from 'react-native';
import { useApi } from '@/lib/api';
import { confirmBlock, type BlockSubject } from '@/lib/safety';
import { hapticSuccess } from '@/lib/haptics';
import { showActionSheet } from '@/components/ui/ActionSheet';

export function useBlockAction(): (subject: BlockSubject) => Promise<boolean> {
  const api = useApi();
  return useCallback(async (subject: BlockSubject) => {
    // Native keeps the system Alert; web gets the themed sheet, since
    // react-native-web's Alert.alert renders nothing.
    const done = await confirmBlock(subject, api.social.block, Platform.OS === 'web' ? showActionSheet : undefined);
    if (done) hapticSuccess();
    return done;
  }, [api]);
}
