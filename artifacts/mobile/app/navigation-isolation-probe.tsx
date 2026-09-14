import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

const FLOWS = [
  { label: 'Buyer card', href: '/buyer-product-detail?id=scene-isolation-product' },
  { label: 'Seller card', href: '/setup' },
  { label: 'Editor card', href: '/product-editor?id=scene-isolation-product' },
  { label: 'Live modal', href: '/seller-go-live' },
  { label: 'Comments modal', href: '/buyer-post-comments?postId=scene-isolation-post' },
  { label: 'Report modal', href: '/buyer-report?targetType=post&targetId=scene-isolation-post' },
] as const;

export default function NavigationIsolationProbe() {
  const router = useRouter();

  return (
    <View testID="navigation-isolation-origin" style={styles.root}>
      <Text style={styles.title}>Navigation isolation probe</Text>
      {FLOWS.map((flow) => (
        <Pressable
          key={flow.label}
          accessibilityRole="button"
          accessibilityLabel={flow.label}
          onPress={() => router.push(flow.href as never)}
          style={styles.button}
        >
          <Text style={styles.buttonText}>{flow.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0B',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  title: {
    color: '#F5F5F7',
    fontFamily: 'Inter_700Bold',
    fontSize: 22,
    marginBottom: 8,
  },
  button: {
    minHeight: 48,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#34343A',
    borderRadius: 10,
    paddingHorizontal: 16,
    backgroundColor: '#18181B',
  },
  buttonText: {
    color: '#F5F5F7',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 15,
  },
});