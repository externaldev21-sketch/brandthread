/**
 * Profile steps after the account exists, following Instagram's sign-up
 * (https://mobbin.com/flows/4a6da069-d7db-4720-94e6-db74d80428c0):
 * name → (brand name, sellers) → username → profile picture → welcome.
 */
import React, { useEffect } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon, Input } from '@/components/ui';
import { useColors } from '@/hooks/useColors';
import { FILL_ELEVATED, FONT, TEXT } from '@/lib/theme';
import { SPACING } from '@/constants/spacing';
import { StepScreen } from './StepScreen';
import { AvailableCheck, ClearButton } from './FieldAccessories';

export const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,30}$/;

export function NameStep({ name, onChange, onNext, seller }: {
  name: string;
  onChange: (v: string) => void;
  onNext: () => void;
  seller: boolean;
}) {
  const ok = name.trim().length >= 2;
  return (
    <StepScreen
      testID="onboarding-name-step"
      title="What's your name?"
      subtitle={seller ? 'This is how your workspace will greet you.' : 'This is how your profile will appear.'}
      primary={{ label: 'Next', onPress: onNext, disabled: !ok, testID: 'onboarding-name-next' }}
    >
      <Input
        autoFocus={Platform.OS !== 'web'}
        testID="onboarding-first-name-input"
        label="Full name"
        value={name}
        onChangeText={onChange}
        autoCapitalize="words"
        autoComplete="name"
        textContentType="name"
        maxLength={60}
        onSubmitEditing={() => { if (ok) onNext(); }}
        right={<ClearButton visible={name.length > 0} onPress={() => onChange('')} />}
      />
    </StepScreen>
  );
}

export function BrandNameStep({ brandName, onChange, onNext }: {
  brandName: string;
  onChange: (v: string) => void;
  onNext: () => void;
}) {
  const ok = brandName.trim().length >= 1;
  return (
    <StepScreen
      testID="onboarding-brand-name-step"
      title="What's your brand called?"
      subtitle="Use your current name or a working name. You can change it later."
      primary={{ label: 'Next', onPress: onNext, disabled: !ok, testID: 'onboarding-brand-name-next' }}
    >
      <Input
        autoFocus={Platform.OS !== 'web'}
        testID="onboarding-brand-name-input"
        label="Brand name"
        value={brandName}
        onChangeText={onChange}
        autoCapitalize="words"
        maxLength={60}
        onSubmitEditing={() => { if (ok) onNext(); }}
        right={<ClearButton visible={brandName.length > 0} onPress={() => onChange('')} />}
      />
    </StepScreen>
  );
}

export function UsernameStep({ username, onChange, onNext, checking, takenError, loading }: {
  username: string;
  onChange: (v: string) => void;
  onNext: () => void;
  checking: boolean;
  takenError: string;
  loading?: boolean;
}) {
  const formatOk = USERNAME_PATTERN.test(username);
  const formatError = username.length > 0 && username.length < 3 ? 'Use at least 3 characters.' : '';
  const available = formatOk && !checking && !takenError;
  return (
    <StepScreen
      testID="onboarding-username-step"
      title="Create a username"
      subtitle="Add a username or use our suggestion. You can change this at any time."
      primary={{ label: 'Next', onPress: onNext, disabled: !available, loading, testID: 'onboarding-username-next' }}
    >
      <Input
        testID="onboarding-username-input"
        label="Username"
        value={username}
        onChangeText={(v) => onChange(v.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30))}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        textContentType="username"
        maxLength={30}
        error={formatError || takenError || null}
        onSubmitEditing={() => { if (available) onNext(); }}
        right={checking && formatOk ? <ActivityIndicator size="small" /> : <AvailableCheck visible={available} />}
      />
    </StepScreen>
  );
}

function BigAvatar({ uri, size = 168 }: { uri: string | null; size?: number }) {
  const palette = useColors();
  return (
    <View style={[styles.bigAvatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: FILL_ELEVATED }]}>
      {uri ? (
        <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} accessibilityLabel="Profile picture" />
      ) : (
        <Icon name="user" size={size * 0.42} color={palette.mutedForeground} />
      )}
    </View>
  );
}

export function PhotoStep({ photoUri, onPick, onNext, onSkip, uploading, error }: {
  photoUri: string | null;
  onPick: () => void;
  onNext: () => void;
  onSkip: () => void;
  uploading?: boolean;
  error?: string | null;
}) {
  return (
    <StepScreen
      testID="onboarding-photo-step"
      title="Add a profile picture"
      subtitle="Add a profile picture so people know it's you. Everyone will be able to see your picture."
      error={error}
      primary={photoUri
        ? { label: 'Next', onPress: onNext, loading: uploading, testID: 'onboarding-photo-next' }
        : { label: 'Add picture', onPress: onPick, loading: uploading, testID: 'onboarding-photo-add' }}
      secondary={photoUri
        ? { label: 'Change picture', onPress: onPick, disabled: uploading, testID: 'onboarding-photo-change' }
        : { label: 'Skip', onPress: onSkip, testID: 'onboarding-photo-skip' }}
    >
      <Pressable onPress={onPick} accessibilityRole="button" accessibilityLabel="Choose a profile picture" style={styles.photoWrap}>
        <BigAvatar uri={photoUri} />
      </Pressable>
    </StepScreen>
  );
}

/**
 * Instagram's "Welcome to Instagram, username" moment: shown briefly, then
 * the flow moves on by itself (tap to continue sooner).
 */
export function WelcomeUserStep({ username, photoUri, onDone, holdMs = 1800 }: {
  username: string;
  photoUri: string | null;
  onDone: () => void;
  holdMs?: number;
}) {
  const palette = useColors();
  useEffect(() => {
    const t = setTimeout(onDone, holdMs);
    return () => clearTimeout(t);
  }, [onDone, holdMs]);
  return (
    <Pressable
      testID="onboarding-welcome-user"
      onPress={onDone}
      accessibilityRole="button"
      accessibilityLabel={`Welcome to Brandthread, ${username}. Continue`}
      style={styles.welcome}
    >
      <BigAvatar uri={photoUri} size={176} />
      <View style={styles.welcomeCopy}>
        <Text style={[styles.welcomeTitle, { color: palette.foreground }]}>Welcome to Brandthread,{'\n'}{username}</Text>
        <Text style={[styles.welcomeSub, { color: palette.mutedForeground }]}>Let's set up your feed.</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bigAvatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  photoWrap: { alignSelf: 'center', marginVertical: SPACING.md },
  welcome: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: Platform.OS === 'web' ? 0 : SPACING.huge },
  welcomeCopy: { alignSelf: 'stretch', marginTop: SPACING.xxl, paddingHorizontal: SPACING.md },
  welcomeTitle: { ...TEXT.title2, fontFamily: FONT.bold },
  welcomeSub: { ...TEXT.subhead, marginTop: SPACING.xs },
});
