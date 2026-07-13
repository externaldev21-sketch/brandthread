import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { PrimaryButton, Subtitle, Title } from '@/components/UI';
import { useTheme } from '@/context/ThemeContext';

export default function Welcome() {
  const { theme } = useTheme();
  return (
    <Screen style={{ flexGrow: 1, justifyContent: 'space-between' }}>
      <View style={{ paddingTop: 70, gap: 14 }}>
        <Text style={[styles.logo, { color: theme.text }]}>BT</Text>
        <Title>Everything your clothing brand needs. In one place.</Title>
        <Subtitle>
          Design products, find manufacturers, build your store, create content, take orders,
          manage production, ship, and get paid.
        </Subtitle>
      </View>
      <View style={{ gap: 12, paddingBottom: 20 }}>
        <PrimaryButton label="Get started" onPress={() => router.push('/onboarding/account-type')} />
        <Text onPress={() => router.push('/onboarding/account-type')} style={{ color: theme.muted, textAlign: 'center' }}>
          I already have an account
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logo: {
    width: 70,
    height: 70,
    borderRadius: 22,
    borderWidth: 2,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 28,
    fontWeight: '900'
  }
});
