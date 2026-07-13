import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Input, PrimaryButton, Subtitle, Title } from '@/components/UI';
import { useApp } from '@/context/AppContext';

export default function ProfileSetup() {
  const { accountType, completeOnboarding } = useApp();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');

  const finish = async () => {
    if (!accountType || !name.trim() || !username.trim()) return;
    await completeOnboarding({
      id: 'demo-user',
      name: name.trim(),
      username: username.trim().replace('@', ''),
      accountType
    });
    router.replace(accountType === 'seller' ? '/seller' : '/buyer/thread');
  };

  return (
    <Screen>
      <Title>Create your profile</Title>
      <Subtitle>This is how people will recognize you on Brandthread.</Subtitle>
      <View style={{ gap: 12 }}>
        <Input placeholder="Full name" value={name} onChangeText={setName} />
        <Input placeholder="Username" value={username} onChangeText={setUsername} autoCapitalize="none" />
      </View>
      <PrimaryButton label="Enter Brandthread" onPress={finish} disabled={!name.trim() || !username.trim()} />
    </Screen>
  );
}
