/**
 * Create a group — name, short description, photo, Public / Private — plus the
 * invite-link entry for joining a private group by link or code.
 * On success replaces itself with the new group's chat.
 */
import React, { useState } from 'react';
import { Keyboard, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import { GroupFormFields, type GroupFormErrors, type GroupFormValue } from '@/components/community/GroupFormFields';
import { SignInPrompt } from '@/components/community/SignInPrompt';
import { useBuyerTabBarInset } from '@/components/buyer-nav/buyerTabBarMetrics';
import { useCommunityClient } from '@/lib/communities/useCommunityClient';
import { describeCommunityError } from '@/lib/communities/errors';
import { pickAndUploadCommunityPhoto } from '@/lib/communities/pickPhoto';
import { parseInviteCode } from '@/lib/communities/inviteLink';
import { WEB_INPUT_RESET } from '@/lib/inputReset';
import { validateGroupDescription, validateGroupName } from '@/lib/communities/validation';
import { hapticSuccess } from '@/lib/haptics';
import { useColors } from '@/hooks/useColors';
import { COMP, FONT, FS, RADIUS, SP } from '@/lib/theme';

export default function CommunityCreateScreen() {
  const colors = useColors();
  const router = useRouter();
  const client = useCommunityClient();
  const barInset = useBuyerTabBarInset();

  const [form, setForm] = useState<GroupFormValue>({ name: '', description: '', visibility: 'public', requireApproval: false });
  const [errors, setErrors] = useState<GroupFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [inviteText, setInviteText] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);

  const submitInvite = () => {
    const code = parseInviteCode(inviteText);
    if (!code) {
      setInviteError("That doesn't look like an invite link. Paste the full link or the code.");
      return;
    }
    setInviteError(null);
    Keyboard.dismiss();
    setInviteText('');
    router.push(`/community-join?code=${encodeURIComponent(code)}` as never);
  };

  const patch = (p: Partial<GroupFormValue>) => {
    setForm((f) => ({ ...f, ...p }));
    if (p.name !== undefined && errors.name) setErrors((e) => ({ ...e, name: null }));
    if (formError) setFormError(null);
  };

  const pickPhoto = async () => {
    setErrors((e) => ({ ...e, photo: null }));
    setUploading(true);
    try {
      const picked = await pickAndUploadCommunityPhoto(client);
      if (picked) { setPhotoUrl(picked.url); setForm((f) => ({ ...f, photoUri: picked.uri })); }
    } catch (e) {
      const info = describeCommunityError(e, "We couldn't upload that photo. Try another one.");
      if (info.authRequired) setNeedsSignIn(true);
      else setErrors((prev) => ({ ...prev, photo: info.message }));
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const nameError = validateGroupName(form.name);
    const descError = validateGroupDescription(form.description);
    if (nameError || descError) { setErrors({ name: nameError, description: descError }); return; }
    setSaving(true);
    setFormError(null);
    setNeedsSignIn(false);
    try {
      const created = await client.create({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        visibility: form.visibility,
        requireApproval: form.visibility === 'private' ? form.requireApproval : false,
        iconUrl: photoUrl,
      });
      hapticSuccess();
      router.replace(`/community-chat?id=${encodeURIComponent(created.id)}` as never);
    } catch (e) {
      const info = describeCommunityError(e);
      if (info.authRequired) setNeedsSignIn(true);
      else if (info.code === 'NAME_RESERVED') setErrors((prev) => ({ ...prev, name: info.message }));
      else setFormError(info.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <ScreenHeader title="New group" />
      <KeyboardAwareScrollViewCompat
        contentContainerStyle={[styles.content, { paddingBottom: barInset + SP.xl }]}
        showsVerticalScrollIndicator={false}
        keyboardDismissMode="on-drag"
      >
        <GroupFormFields
          value={form}
          onChange={patch}
          errors={errors}
          uploading={uploading}
          onPickPhoto={() => { void pickPhoto(); }}
          onRemovePhoto={() => { setPhotoUrl(null); setForm((f) => ({ ...f, photoUri: undefined })); }}
        />
        {formError ? <Text style={[styles.note, { color: colors.mutedForeground }]}>{formError}</Text> : null}
        {needsSignIn ? <SignInPrompt message="Sign in to create a group." /> : null}
        <Button label="Create group" onPress={() => { void submit(); }} loading={saving} disabled={uploading} fullWidth />

        <View style={styles.inviteBlock}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Have an invite link?</Text>
          <View style={styles.inviteRow}>
            <View style={[styles.inviteField, { backgroundColor: colors.card }]}>
              <Feather name="link" size={16} color={colors.mutedForeground} />
              <TextInput
                value={inviteText}
                onChangeText={(t) => { setInviteText(t); if (inviteError) setInviteError(null); }}
                placeholder="Paste link or code"
                placeholderTextColor={colors.subtle}
                style={[styles.inviteInput, { color: colors.foreground }, WEB_INPUT_RESET]}
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={submitInvite}
                accessibilityLabel="Invite link or code"
              />
            </View>
            <Button label="Open" size="small" variant="secondary" disabled={!inviteText.trim()} onPress={submitInvite} />
          </View>
          {inviteError ? <Text style={[styles.note, { color: colors.mutedForeground }]}>{inviteError}</Text> : null}
        </View>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: SP.md, paddingTop: SP.md, gap: SP.md },
  note: { fontFamily: FONT.regular, fontSize: FS.sm, lineHeight: 19 },
  inviteBlock: { marginTop: SP.sm, gap: SP.sm },
  sectionTitle: { fontFamily: FONT.bold, fontSize: FS.md, letterSpacing: -0.2 },
  inviteRow: { flexDirection: 'row', alignItems: 'center', gap: SP.sm },
  inviteField: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: SP.sm, height: COMP.minTouchTarget, paddingHorizontal: SP.md, borderRadius: RADIUS.md },
  inviteInput: { flex: 1, fontFamily: FONT.regular, fontSize: FS.base },
});
