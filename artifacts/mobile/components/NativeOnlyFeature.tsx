import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { goBackOr } from '@/lib/navigation/goBackOr';

interface NativeOnlyFeatureProps {
  title: string;
  description: string;
  icon?: keyof typeof Feather.glyphMap;
}

/**
 * Honest browser fallback for capabilities backed by native SDKs.
 * Keep the route usable and navigable without suggesting the action succeeded.
 */
export default function NativeOnlyFeature({
  title,
  description,
  icon = 'smartphone',
}: NativeOnlyFeatureProps) {
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + 24,
          paddingBottom: insets.bottom + 24,
        },
      ]}
    >
      <View style={[styles.iconBox, { backgroundColor: colors.accent }]}>
        <Feather name={icon} size={34} color={colors.primary} />
      </View>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      <Text style={[styles.description, { color: colors.mutedForeground }]}>
        {description}
      </Text>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={() => goBackOr(router)}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>Go back</Text>
      </TouchableOpacity>
      {Platform.OS === 'web' && (
        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          Open Brandthread on iOS or Android to use this feature.
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  iconBox: {
    width: 76,
    height: 76,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    maxWidth: 560,
    fontSize: 26,
    lineHeight: 32,
    fontFamily: 'Inter_700Bold',
    textAlign: 'center',
    marginBottom: 10,
  },
  description: {
    maxWidth: 560,
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    marginBottom: 24,
  },
  button: {
    borderRadius: 14,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  buttonText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
  },
  hint: {
    marginTop: 14,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
  },
});