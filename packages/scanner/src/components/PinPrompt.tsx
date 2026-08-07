import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { theme } from '../theme';

interface Props {
  visible: boolean;
  fileName?: string;
  error?: string | null;
  busy?: boolean;
  onSubmit: (pin: string) => void;
  onCancel: () => void;
}

export function PinPrompt({
  visible,
  fileName,
  error,
  busy,
  onSubmit,
  onCancel,
}: Props) {
  const [pin, setPin] = useState('');

  // Clear the field whenever the sheet reopens, and after a rejected attempt.
  useEffect(() => {
    if (visible) setPin('');
  }, [visible]);
  useEffect(() => {
    if (error) setPin('');
  }, [error]);

  const tooShort = pin.length < 4;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
          <Text style={styles.title}>PIN required</Text>
          <Text style={styles.subtitle}>
            {fileName
              ? `"${fileName}" is encrypted. Enter the PIN it was created with.`
              : 'This stream is encrypted. Enter the PIN it was created with.'}
          </Text>

          <TextInput
            style={styles.input}
            value={pin}
            onChangeText={setPin}
            placeholder="••••"
            placeholderTextColor={theme.muted}
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
            editable={!busy}
            onSubmitEditing={() => !tooShort && !busy && onSubmit(pin)}
            returnKeyType="done"
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <Pressable style={styles.ghost} onPress={onCancel} disabled={busy}>
              <Text style={styles.ghostText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.primary, (tooShort || busy) && styles.disabled]}
              onPress={() => onSubmit(pin)}
              disabled={tooShort || busy}
            >
              <Text style={styles.primaryText}>{busy ? 'Decrypting…' : 'Unlock'}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    padding: 24,
  },
  sheet: {
    backgroundColor: theme.panel,
    borderRadius: theme.radius,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
  },
  title: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.muted,
    fontSize: 13,
    marginTop: 6,
  },
  input: {
    backgroundColor: theme.panel2,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 8,
    color: theme.text,
    fontSize: 22,
    letterSpacing: 6,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 16,
    textAlign: 'center',
  },
  error: {
    color: theme.danger,
    fontSize: 13,
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 18,
  },
  ghost: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.border,
  },
  ghostText: {
    color: theme.muted,
    fontWeight: '600',
  },
  primary: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: theme.accent,
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.45,
  },
});
