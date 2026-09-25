/**
 * Test stand-in for components/profile/ProfileShell. The real shell's hero
 * video, scroll animation and virtualized list need a native runtime; screen
 * tests only care that each slot a screen passes in is rendered and wired, so
 * this renders every slot inline (tabs through the real ProfileTabs, grid rows
 * through the screen's own renderItem).
 *
 * Usage: vi.mock('@/components/profile/ProfileShell', async () =>
 *          (await import('./helpers/profileShellMock')).profileShellMockModule);
 */
import React from 'react';
import { ProfileTabs } from '@/components/profile/ProfileControls';

function ProfileShell(props: any) {
  const data: unknown[] = Array.isArray(props.data) ? props.data : [];
  return React.createElement(
    'View',
    { testID: props.testID },
    React.createElement('Text', { testID: 'profile-hero-brand-name' }, props.identity?.name),
    React.createElement('Text', { testID: 'profile-hero-handle' }, props.identity?.handle ?? ''),
    props.avatar?.onPress
      ? React.createElement('Pressable', {
          testID: 'profile-avatar',
          onPress: props.avatar.onPress,
          accessibilityLabel: props.avatar.accessibilityLabel,
        })
      : null,
    props.hero ? React.createElement('View', { testID: 'profile-hero-media', hero: props.hero }) : null,
    props.topLeft,
    props.topRight,
    props.meta,
    React.createElement(
      'View',
      { testID: 'profile-stats' },
      (props.stats ?? []).map((stat: any) => React.createElement(
        'Pressable',
        {
          key: stat.key,
          testID: `profile-stat-${stat.key}`,
          onPress: stat.onPress,
          accessibilityLabel: `${stat.value} ${stat.label}`,
        },
        React.createElement('Text', null, `${stat.value} ${stat.label}`),
      )),
    ),
    props.actions,
    props.extras,
    props.tabs
      ? React.createElement(ProfileTabs, { tabs: props.tabs.items, active: props.tabs.active, onChange: props.tabs.onChange })
      : null,
    props.section ? React.createElement('Text', { testID: 'profile-section' }, props.section.label) : null,
    data.length > 0
      ? data.map((item, index) => React.createElement(
          React.Fragment,
          { key: props.keyExtractor(item, index) },
          props.renderItem({ item, index, separators: {} }),
        ))
      : props.ListEmptyComponent ?? null,
    props.ListFooterComponent ?? null,
    props.renderFloating ? props.renderFloating(0) : null,
  );
}

function ProfileMeta({ bio, website, location, children }: any) {
  return React.createElement(
    'View',
    { testID: 'profile-meta' },
    bio ? React.createElement('Text', null, bio) : null,
    website ? React.createElement('Text', null, website) : null,
    location ? React.createElement('Text', null, location) : null,
    children,
  );
}

export const profileShellMockModule = { ProfileShell, ProfileMeta };
