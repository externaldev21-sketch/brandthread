import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

interface IconOption {
  id: string;
  label: string;
  colors: [string, string];
}

const ICONS: IconOption[] = [
  { id: 'default', label: 'Default', colors: ['#727A84', '#F8FAFC'] },
  { id: 'spring26', label: "Spring '26", colors: ['#38BDF8', '#0F766E'] },
  { id: 'winter26', label: "Winter '26", colors: ['#C9A96E', '#B45309'] },
  { id: 'summer25', label: "Summer '25", colors: ['#0EA5E9', '#EC4899'] },
  { id: 'winter25', label: "Winter '25", colors: ['#FACC15', '#EA580C'] },
  { id: 'summer24', label: "Summer '24", colors: ['#14B8A6', '#0EA5E9'] },
  { id: 'winter24', label: "Winter '24", colors: ['#1F2937', '#111827'] },
  { id: 'summer23', label: "Summer '23", colors: ['#3B82F6', '#6366F1'] },
  { id: 'winter23', label: "Winter '23", colors: ['#F97316', '#B45309'] },
  { id: 'summer22', label: "Summer '22", colors: ['#34D399', '#38BDF8'] },
];

export default function AppIconScreen() {
  const colors = useColors();
  const [selected, setSelected] = useState('winter24');

  function select(id: string) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelected(id);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScreenHeader title="App icon" />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingTop: 20, paddingBottom: 60, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.grid}>
          {ICONS.map((icon) => {
            const isSelected = selected === icon.id;
            return (
              <TouchableOpacity
                key={icon.id}
                onPress={() => select(icon.id)}
                activeOpacity={0.8}
                style={styles.item}
              >
                <View
                  style={[
                    styles.iconCard,
                    { borderColor: isSelected ? colors.primary : colors.border, backgroundColor: colors.card },
                  ]}
                >
                  <LinearGradient colors={icon.colors} style={styles.iconGlyph}>
                    <Feather name="shopping-bag" size={28} color="#FFFFFF" />
                  </LinearGradient>
                  <View
                    style={[
                      styles.checkbox,
                      {
                        borderColor: isSelected ? colors.primary : colors.border,
                        backgroundColor: isSelected ? colors.primary : 'transparent',
                      },
                    ]}
                  >
                    {isSelected && <Feather name="check" size={12} color={colors.primaryForeground} />}
                  </View>
                </View>
                <Text style={[styles.label, { color: colors.foreground }]}>{icon.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  item: { width: '22%', minWidth: 78, alignItems: 'center' },
  iconCard: {
    width: '100%',
    aspectRatio: 0.85,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 10,
  },
  iconGlyph: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 6, textAlign: 'center' },
});
