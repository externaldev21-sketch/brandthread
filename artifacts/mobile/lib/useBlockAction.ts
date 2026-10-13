/**
 * Reusable "Block @name" action: confirmation alert -> POST /api/social/block.
 * Resolves true only when the server saved the block.
 * Every menu that offers Block should call this instead of hand-rolling it.
 */
import { useCallback } from 'react';
import { useApi } from '@/lib/api';
import { confirmBlock, type BlockSubject } from '@/lib/safety';

export function useBlockAction(): (subject: BlockSubject) => Promise<boolean> {
  const api = useApi();
  return useCallback(async (subject: BlockSubject) => {
    const done = await confirmBlock(subject, api.social.block);
    return done;
  }, [api]);
}
