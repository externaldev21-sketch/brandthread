import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useColorScheme } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function ShoppingPreferences() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const isDark = useColorScheme() !== 'light';
  const bg  = isDark ? '#0A0A0A' : '#FAFAF8';
  const fg  = isDark ? '#FFFFFF' : '#1A1A1A';
  const sub = isDark ? '#888'    : '#999';

  return (
    <View style={[s.container, { backgroundColor: bg, paddingTop: insets.top }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.back}>
          <Feather name="arrow-left" size={22} color={fg} />
        </TouchableOpacity>
        <Text style={[s.title, { color: fg }]}>Shopping Preferences</Text>
        <View style={{ width: 40 }} />
      </View>
      <View style={s.body}>
        <Text style={[s.empty, { color: sub }]}>Coming soon</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 14 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontFamily: 'Inter_600SemiBold' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { fontSize: 15, fontFamily: 'Inter_400Regular' },
});
