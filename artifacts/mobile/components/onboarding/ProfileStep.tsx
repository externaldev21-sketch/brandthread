/**
 * Name + @handle, with live availability (the same public username check
 * the old sign-up form used). Buyers see "Your profile"; sellers reuse it
 * as "Your store" with the store name in the first field.
 */
import React, { forwardRef } from 'react';
import type { TextInput } from 'react-native';
import { useUsernameLiveCheck } from '@/lib/onboarding/useUsernameLiveCheck';
import { Body, Field, Headline, SquareButton, StepScreen } from './kit';

export const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,30}$/;

/** Letters, numbers and underscores only, 30 max — applied as the person types. */
export function cleanUsername(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '').slice(0, 30);
}

export interface ProfileStepProps {
  counter: { current: number; total: number } | null;
  title: string;
  body: string;
  nameLabel: string;
  namePlaceholder: string;
  name: string;
  onNameChange: (value: string) => void;
  username: string;
  onUsernameChange: (value: string) => void;
  onNext: () => void;
  onNameFocus?: () => void;
}

export const ProfileStep = forwardRef<TextInput, ProfileStepProps>(function ProfileStep(
  { counter, title, body, nameLabel, namePlaceholder, name, onNameChange, username, onUsernameChange, onNext, onNameFocus },
  nameRef,
) {
  const live = useUsernameLiveCheck(username);
  const trimmed = username.trim();
  const formatError = trimmed.length > 0 && trimmed.length < 3 ? 'At least 3 characters.' : '';
  const usernameError = formatError || live.error || '';
  const usernameValid = USERNAME_REGEX.test(trimmed) && !live.error && !live.checking;
  const canContinue = name.trim().length >= 2 && usernameValid;

  const hint = live.checking
    ? 'Checking…'
    : usernameValid
      ? `@${trimmed.toLowerCase()} is available`
      : 'Letters, numbers and underscores.';

  return (
    <StepScreen
      counter={counter}
      testID="onboarding-profile"
      footer={<SquareButton testID="onboarding-next" label="Next" onPress={onNext} disabled={!canContinue} />}
    >
      <Headline>{title}</Headline>
      <Body>{body}</Body>
      <Field
        ref={nameRef}
        testID="onboarding-first-name-input"
        label={nameLabel}
        placeholder={namePlaceholder}
        value={name}
        onChangeText={onNameChange}
        onFocus={onNameFocus}
        autoCapitalize="words"
        autoComplete="name"
        maxLength={60}
      />
      <Field
        testID="onboarding-username-input"
        label="Username"
        prefix="@"
        placeholder="username"
        value={username}
        editable
        onChangeText={(v) => onUsernameChange(cleanUsername(v))}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username"
        maxLength={30}
        error={usernameError || null}
        hint={usernameError ? null : hint}
      />
    </StepScreen>
  );
});
