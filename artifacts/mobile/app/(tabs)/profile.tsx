import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';

const bg = '#000000';
const fg = '#FFFFFF';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  function nav(route: string | null) {
    if (!route) return;
    if (route === '__help__') {
      Alert.alert('Help & Support', 'How can we help?', [
        { text: 'Browse FAQ',  onPress: () => {} },
        { text: 'Contact Us',  onPress: () => {} },
        { text: 'Cancel', style: 'cancel' },
      ]);
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(route as never);
  }

  return (
    <ScrollView
      style={[styles.container, { backgroundColor: bg }]}
      contentContainerStyle={{ paddingBottom: 130 }}
      showsVerticalScrollIndicator={false}
    >
      {/* ─ Top bar ─ */}
      <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
        <TouchableOpacity
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          activeOpacity={0.7}
          onPress={() => nav('/team')}
        >
          <Feather name="user-plus" size={22} color={fg} />
        </TouchableOpacity>
        <View style={styles.topBarRight}>
          <TouchableOpacity
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            onPress={() => nav('/customers')}
          >
            <Feather name="bell" size={21} color={fg} />
          </TouchableOpacity>
          <TouchableOpacity
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              nav('/settings');
            }}
          >
            <Feather name="settings" size={20} color={fg} />
          </TouchableOpacity>
          <TouchableOpacity
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            activeOpacity={0.7}
            onPress={() => nav('/settings')}
          >
            <Feather name="menu" size={22} color={fg} />
          </TouchableOpacity>
        </View>
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 16 },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
});
