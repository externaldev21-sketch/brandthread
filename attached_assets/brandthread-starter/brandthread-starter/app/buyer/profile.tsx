import { router } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Card, PrimaryButton, Title } from '@/components/UI';
import { useApp } from '@/context/AppContext';
import { useTheme } from '@/context/ThemeContext';

export default function BuyerProfile() {
  const { profile, signOut } = useApp();
  const { theme, toggleTheme } = useTheme();
  return (
    <Screen>
      <View style={{ alignItems: 'center', gap: 10, paddingTop: 20 }}>
        <View style={{ width: 90, height: 90, borderRadius: 45, backgroundColor: theme.border }} />
        <Title>{profile?.name ?? 'Brandthread User'}</Title>
        <Text style={{ color: theme.muted }}>@{profile?.username ?? 'username'}</Text>
      </View>
      <Card>
        <Text style={{ color: theme.text, fontWeight: '900' }}>Your posts</Text>
        <Text style={{ color: theme.muted, marginTop: 6 }}>Buyer posts live on your profile and follow your privacy settings.</Text>
      </Card>
      <PrimaryButton label="Toggle theme" onPress={toggleTheme} />
      <PrimaryButton label="Switch to seller demo" onPress={() => router.replace('/seller')} />
      <PrimaryButton label="Sign out" onPress={async () => { await signOut(); router.replace('/welcome'); }} />
    </Screen>
  );
}
