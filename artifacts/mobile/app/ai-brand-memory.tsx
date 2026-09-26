/**
 * Brandthread AI Brain — Brand Memory Settings Screen
 */

import React, { useMemo, useState, useEffect } from 'react';
import { useColors } from '@/hooks/useColors';
import { goBackOr } from '@/lib/navigation/goBackOr';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import { FONT, FS, SP, RADIUS } from '@/lib/theme';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale, HapticSwitch, TertiaryButton } from '@/components/BrandthreadUI';
import { BrandMemory, DEFAULT_BRAND_MEMORY } from '../services/aiTypes';
import {
  getBrandMemory,
  saveBrandMemory,
  toggleMemoryField,
  clearBrandMemory,
  rebuildBrandMemory,
} from '../services/aiBrandMemory';

export default function AiBrandMemoryScreen() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const router = useRouter();
  const { getToken } = useAuth();
  const [localMemory, setLocalMemory] = useState<BrandMemory | null>(null);
  const [saving, setSaving] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    getBrandMemory().then(setLocalMemory);
  }, []);

  const handleToggle = (key: keyof BrandMemory) => {
    toggleMemoryField(key).then(setLocalMemory);
  };

  const handleTextChange = (key: keyof BrandMemory, newText: string) => {
    setLocalMemory(prev =>
      prev ? { ...prev, [key]: { ...prev[key], value: newText } } : prev,
    );
  };

  const handleRebuild = async () => {
    setRebuilding(true);
    try {
      const token = await getToken().catch(() => null);
      const m = await rebuildBrandMemory(token);
      setLocalMemory(m);
      Alert.alert('Brand memory rebuilt', 'Your brand profile has been derived from your products, posts, and store data.');
    } catch {
      Alert.alert('Could not rebuild', 'There was a problem rebuilding brand memory. Try again.');
    } finally {
      setRebuilding(false);
    }
  };

  const handleSave = async () => {
    if (!localMemory) return;
    setSaving(true);
    await saveBrandMemory(localMemory);
    setSaving(false);
    goBackOr(router);
  };

  const handleClearAll = () => {
    Alert.alert(
      'Clear all memory',
      'This will reset all brand memory fields to their defaults. Are you sure?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            clearBrandMemory().then(m => {
              setLocalMemory(m);
              Alert.alert('Memory cleared');
            });
          },
        },
      ],
    );
  };

  const memoryKeys = Object.keys(DEFAULT_BRAND_MEMORY) as (keyof BrandMemory)[];

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Brand Memory"
        rightElement={
          <PressableScale
            onPress={handleSave}
            disabled={saving}
            style={styles.headerSave}
            accessibilityRole="button"
            accessibilityLabel="Save brand memory"
          >
            {saving
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Text style={styles.headerSaveText}>Save</Text>
            }
          </PressableScale>
        }
      />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Info card */}
        <View style={styles.infoCard}>
          <Text style={styles.infoText}>
            Brand Memory helps Brandthread AI understand your brand's voice, audience, and style.
            Only enabled fields are shared with the AI.
          </Text>
        </View>

        {/* Rebuild row */}
        <PressableScale style={styles.rebuildRow} onPress={handleRebuild} disabled={rebuilding}>
          {rebuilding
            ? <ActivityIndicator size="small" color={colors.info} />
            : <Feather name="refresh-cw" size={16} color={colors.info} />
          }
          <Text style={styles.rebuildText}>Rebuild from data</Text>
        </PressableScale>

        {/* Memory fields */}
        {localMemory && memoryKeys.map((key, index) => {
          const field = localMemory[key];
          return (
            <View key={key}>
              <View style={styles.fieldCard}>
                {/* Row header */}
                <View style={styles.fieldHeader}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  <HapticSwitch
                    value={field.enabled}
                    onValueChange={() => handleToggle(key)}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor={colors.foreground}
                  />
                </View>

                {/* Content */}
                {field.enabled ? (
                  <TextInput
                    style={styles.fieldInput}
                    value={field.value}
                    onChangeText={text => handleTextChange(key, text)}
                    multiline
                    numberOfLines={3}
                    placeholder={`Enter ${field.label.toLowerCase()}…`}
                    placeholderTextColor={colors.subtle}
                  />
                ) : (
                  <Text style={styles.fieldDisabled}>
                    Disabled — tap toggle to enable
                  </Text>
                )}
              </View>

              {/* Divider */}
              {index < memoryKeys.length - 1 && <View style={styles.divider} />}
            </View>
          );
        })}

        {!localMemory && (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {/* Clear all */}
        <TertiaryButton label="Clear all memory" onPress={handleClearAll} accent={colors.destructive} style={styles.clearButton} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (colors: ReturnType<typeof useColors>) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  headerSave: {
    minHeight: 40,
    paddingHorizontal: SP.sm,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerSaveText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: colors.primary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    paddingBottom: SP.xxl,
  },
  infoCard: {
    backgroundColor: colors.card,
    borderRadius: RADIUS.md,
    padding: SP.md,
    marginBottom: SP.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: colors.mutedForeground,
    lineHeight: 20,
  },
  rebuildRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SP.sm,
    paddingVertical: SP.sm,
    marginBottom: SP.md,
  },
  rebuildText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: colors.info,
  },
  fieldCard: {
    backgroundColor: colors.card,
    borderRadius: RADIUS.md,
    padding: SP.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SP.sm,
  },
  fieldLabel: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: colors.foreground,
    flex: 1,
    paddingRight: SP.sm,
  },
  fieldInput: {
    color: colors.foreground,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    borderRadius: RADIUS.sm,
    padding: SP.sm,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  fieldDisabled: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: colors.subtle,
    padding: SP.sm,
  },
  divider: {
    height: SP.sm,
  },
  loadingContainer: {
    paddingVertical: SP.xl,
    alignItems: 'center',
  },
  clearButton: {
    marginTop: SP.md,
  },
});
