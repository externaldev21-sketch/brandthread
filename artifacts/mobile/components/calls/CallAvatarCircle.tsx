/**
 * CallAvatarCircle — the peer/self avatar treatment shared by every call
 * screen (outgoing, incoming, in-call, ended). Calls need larger sizes than
 * the shared `components/ui/Avatar.tsx` API exposes (its `size` prop is a
 * closed union topping out at 96, and it always reads its identity tint from
 * `theme.accentDim`/`theme.accentLight` rather than a per-call-peer color) —
 * so this is a small dedicated component built for arbitrary sizes and the
 * peer's own identity color, per `CallPeer.color`.
 *
 * `// theme-exempt` on the fill/initials colors below, per design-rules
 * §1.2 — a person's identity color is user data (same convention as
 * components/ui/Avatar.tsx and every other avatar in the app), not part of
 * the monochrome theme system.
 */
import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { TYPE_SCALE } from '@/constants/typography';
import { FONT } from '@/lib/theme';
import { useAppTheme } from '@/contexts/AppThemeContext';

export interface CallAvatarCircleProps {
  name: string;
  initials: string;
  color: string;
  avatarUri?: string | null;
  size: number;
  /** Rendered bold, directly under the circle (e.g. the peer's name). */
  title?: string;
  /** Rendered muted, directly under the title (e.g. "Calling…"). */
  subtitle?: string;
  gap?: number;
}

export function CallAvatarCircle({
  name, initials, color, avatarUri, size, title, subtitle, gap = 16,
}: CallAvatarCircleProps) {
  const { theme } = useAppTheme();
  return (
    <View style={[styles.wrap, { gap }]}>
      {avatarUri ? (
        <Image
          source={{ uri: avatarUri }}
          accessibilityLabel={`${name}'s avatar`}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <View
          accessibilityLabel={`${name}'s avatar`}
          style={[
            styles.fallback,
            // theme-exempt: per-user identity color, not app theme
            { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
          ]}
        >
          <Text style={[styles.initials, { fontSize: size * 0.36, color: '#FFFFFF' }]}>{initials}</Text>
        </View>
      )}
      {(title || subtitle) && (
        <View style={styles.textWrap}>
          {title ? (
            <Text style={[TYPE_SCALE.title2, styles.title, { color: theme.text }]} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
          {subtitle ? (
            <Text style={[TYPE_SCALE.body, styles.subtitle, { color: theme.muted }]} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  fallback: { alignItems: 'center', justifyContent: 'center' },
  initials: { fontFamily: FONT.bold },
  textWrap: { alignItems: 'center', gap: 4 },
  title: { textAlign: 'center', fontWeight: '700' },
  subtitle: { textAlign: 'center' },
});
