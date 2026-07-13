import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';

export function Title({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return <Text style={[styles.title, { color: theme.text }]}>{children}</Text>;
}

export function Subtitle({ children }: { children: React.ReactNode }) {
  const { theme } = useTheme();
  return <Text style={[styles.subtitle, { color: theme.muted }]}>{children}</Text>;
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { theme } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }, style]}>
      {children}
    </View>
  );
}

export function PrimaryButton({
  label,
  onPress,
  disabled
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { theme } = useTheme();
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: disabled ? theme.border : theme.primary, opacity: pressed ? 0.75 : 1 }
      ]}
    >
      <Text style={{ color: theme.background, fontWeight: '800', fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

export function Input(props: React.ComponentProps<typeof TextInput>) {
  const { theme } = useTheme();
  return (
    <TextInput
      placeholderTextColor={theme.muted}
      {...props}
      style={[
        styles.input,
        { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface },
        props.style
      ]}
    />
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 30, lineHeight: 36, fontWeight: '900', letterSpacing: -1 },
  subtitle: { fontSize: 15, lineHeight: 22 },
  card: { borderRadius: 22, borderWidth: 1, padding: 16 },
  button: { height: 56, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  input: { height: 54, borderRadius: 16, borderWidth: 1, paddingHorizontal: 16, fontSize: 16 }
});
