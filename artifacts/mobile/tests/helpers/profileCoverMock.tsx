/**
 * Test stand-in for components/profile/ProfileCover (which pulls in
 * expo-image-picker / expo-video native modules at import time). Screen tests
 * only need the hook's shape and the hero affordance to render.
 *
 * Usage: vi.mock('@/components/profile/ProfileCover', async () =>
 *          (await import('./helpers/profileCoverMock')).profileCoverMockModule);
 */
import React from 'react';

function useProfileCover({ cover }: { own: boolean; cover: { videoUrl: string | null; posterUrl: string | null } }) {
  return {
    cover,
    hasCover: !!cover.videoUrl,
    busy: null,
    coachmarkVisible: false,
    dismissCoachmark: () => {},
    startAdd: () => {},
    openManage: () => {},
    manageOpen: false,
    closeManage: () => {},
    changeFromManage: () => {},
    remove: async () => {},
    trimSource: null,
    cancelTrim: () => {},
    confirmTrim: () => {},
  };
}

function CoverHeroAffordance({ hasCover, onAdd, onManage }: { hasCover: boolean; onAdd: () => void; onManage: () => void }) {
  return React.createElement('Pressable', { testID: 'profile-cover-affordance', onPress: hasCover ? onManage : onAdd });
}

const Nothing = () => null;

export const profileCoverMockModule = {
  useProfileCover,
  CoverHeroAffordance,
  CoverCoachmarkSheet: Nothing,
  CoverManageSheet: Nothing,
  CoverTrimSheet: Nothing,
};
