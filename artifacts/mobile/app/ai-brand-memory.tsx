/**
 * Brandthread AI Brain — Brand Memory Settings Screen
 */

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Switch,
  TouchableOpacity,
  Pressable,
  Alert,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '@clerk/expo';
import { Feather } from '@expo/vector-icons';
import {
  BG, CARD, BORDER, FG, MUTED, SUBTLE, PURPLE, CYAN, RED,
  FONT, FS, SP, RADIUS,
} from '../lib/theme';
import { BrandMemory, DEFAULT_BRAND_MEMORY } from '../services/aiTypes';
import {
  getBrandMemory,
  saveBrandMemory,
  toggleMemoryField,
  clearBrandMemory,
  rebuildBrandMemory,
} from '../services/aiBrandMemory';

const BORDER_COLOR = 'rgba(255,255,255,0.07)';

export default function AiBrandMemoryScreen() {
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
    router.back();
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
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Feather name="chevron-left" size={24} color={FG} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Brand Memory</Text>
        <TouchableOpacity onPress={handleSave} style={styles.headerSave} disabled={saving}>
          {saving
            ? <ActivityIndicator size="small" color={PURPLE} />
            : <Text style={styles.headerSaveText}>Save</Text>
          }
        </TouchableOpacity>
      </View>

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
        <Pressable style={styles.rebuildRow} onPress={handleRebuild}>
          <Feather name="refresh-cw" size={16} color={CYAN} />
          <Text style={styles.rebuildText}>Rebuild from data</Text>
        </Pressable>

        {/* Memory fields */}
        {localMemory && memoryKeys.map((key, index) => {
          const field = localMemory[key];
          return (
            <View key={key}>
              <View style={styles.fieldCard}>
                {/* Row header */}
                <View style={styles.fieldHeader}>
                  <Text style={styles.fieldLabel}>{field.label}</Text>
                  <Switch
                    value={field.enabled}
                    onValueChange={() => handleToggle(key)}
                    trackColor={{ false: BORDER_COLOR, true: PURPLE }}
                    thumbColor={FG}
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
                    placeholderTextColor={SUBTLE}
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
            <ActivityIndicator color={PURPLE} />
          </View>
        )}

        {/* Clear all */}
        <TouchableOpacity style={styles.clearButton} onPress={handleClearAll}>
          <Text style={styles.clearText}>Clear all memory</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SP.md,
    paddingTop: 56,
    paddingBottom: SP.md,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_COLOR,
    backgroundColor: BG,
  },
  headerBack: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: FONT.semibold,
    fontSize: FS.md,
    color: FG,
  },
  headerSave: {
    width: 60,
    height: 40,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  headerSaveText: {
    fontFamily: FONT.semibold,
    fontSize: FS.base,
    color: PURPLE,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: SP.md,
    paddingTop: SP.md,
    paddingBottom: 48,
  },
  infoCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
  },
  infoText: {
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    color: MUTED,
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
    color: CYAN,
  },
  fieldCard: {
    backgroundColor: CARD,
    borderRadius: 12,
    padding: SP.md,
    borderWidth: 1,
    borderColor: BORDER_COLOR,
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
    color: FG,
    flex: 1,
    paddingRight: SP.sm,
  },
  fieldInput: {
    color: FG,
    backgroundColor: BG,
    borderColor: BORDER_COLOR,
    borderWidth: 1,
    fontFamily: FONT.regular,
    fontSize: FS.sm,
    borderRadius: 10,
    padding: 10,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  fieldDisabled: {
    fontFamily: FONT.regular,
    fontSize: FS.xs,
    color: SUBTLE,
    padding: 8,
  },
  divider: {
    height: 8,
  },
  loadingContainer: {
    paddingVertical: SP.xl,
    alignItems: 'center',
  },
  clearButton: {
    alignItems: 'center',
    paddingVertical: SP.md,
    marginTop: SP.md,
  },
  clearText: {
    fontFamily: FONT.medium,
    fontSize: FS.sm,
    color: RED,
  },
});
