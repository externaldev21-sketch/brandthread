/**
 * Backup codes — generate a fresh set of one-time codes for two-factor sign-in.
 * Clerk never re-displays old codes, so this always creates a new set.
 */
import React, { useState } from 'react';
import { View, Text } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useUser, useReverification } from '@clerk/expo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Button } from '@/components/ui/Button';
import { SecurityBody, SecurityIntro, SecurityErrorBox } from '@/components/security/SecurityFormKit';
import { useColors } from '@/hooks/useColors';
import { mapSecurityError } from '@/lib/accountSecurityErrors';
import { FONT } from '@/lib/theme';
import { RADII } from '@/constants/radii';
import { SPACING } from '@/constants/spacing';

export default function BackupCodes() {
  const colors = useColors();
  const { user } = useUser();
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const createBackupCodes = useReverification(() => user!.createBackupCode());

  async function generate() {
    if (!user || busy) return;
    setBusy(true);
    setError('');
    setCopied(false);
    try {
      const result = await createBackupCodes();
      setCodes(result?.codes ?? []);
    } catch (e) {
      setError(mapSecurityError(e, 'twoFactor').message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScreenHeader title="Backup codes" />
      <SecurityBody>
        <SecurityIntro>
          Each code works once. New codes replace your old ones.
        </SecurityIntro>

        {codes ? (
          <>
            <View
              style={{
                backgroundColor: colors.card, borderRadius: RADII.chip, borderWidth: 1, borderColor: colors.border,
                padding: SPACING.md, flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs,
              }}
            >
              {codes.map((code) => (
                <Text
                  key={code}
                  selectable
                  style={{
                    fontFamily: FONT.regular, fontSize: 14, color: colors.foreground,
                    backgroundColor: colors.elevated, borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4,
                  }}
                >
                  {code}
                </Text>
              ))}
            </View>
            <Button
              testID="copy-backup-codes"
              label={copied ? 'Copied' : 'Copy codes'}
              variant="secondary"
              icon={copied ? 'check' : 'copy'}
              fullWidth
              style={{ marginTop: SPACING.md }}
              onPress={async () => {
                await Clipboard.setStringAsync(codes.join('\n'));
                setCopied(true);
              }}
            />
          </>
        ) : null}

        <SecurityErrorBox message={error} testID="backup-codes-error" />

        <Button
          testID="generate-backup-codes"
          label={codes ? 'Generate new codes' : 'Generate backup codes'}
          variant={codes ? 'tertiary' : 'primary'}
          onPress={generate}
          loading={busy}
          fullWidth
          style={{ marginTop: SPACING.md }}
        />
      </SecurityBody>
    </View>
  );
}
