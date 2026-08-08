import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { fonts, sunken, theme } from '../theme';
import { Key, type as type_, Window } from './Chassis';

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
        <Window title="PIN REQUIRED" onClose={busy ? undefined : onCancel}>
          <Text style={styles.subtitle}>
            {fileName
              ? `"${fileName}" is encrypted. Enter the PIN it was created with.`
              : 'This stream is encrypted. Enter the PIN it was created with.'}
          </Text>

          <TextInput
            style={[styles.input, sunken]}
            value={pin}
            onChangeText={setPin}
            placeholder="····"
            placeholderTextColor={theme.inkSoft}
            keyboardType="number-pad"
            secureTextEntry
            autoFocus
            editable={!busy}
            onSubmitEditing={() => !tooShort && !busy && onSubmit(pin)}
            returnKeyType="done"
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <Key
              compact
              label="Cancel"
              onPress={onCancel}
              disabled={busy}
              style={styles.action}
            />
            <Key
              compact
              tone="primary"
              label={busy ? 'Decrypting…' : 'Unlock'}
              onPress={() => onSubmit(pin)}
              disabled={tooShort || busy}
              style={styles.action}
            />
          </View>
        </Window>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(20,17,10,0.72)',
    justifyContent: 'center',
    padding: 22,
  },
  subtitle: {
    ...type_.muted,
  },
  input: {
    backgroundColor: theme.well,
    color: theme.cream,
    fontFamily: fonts.bodyBold,
    fontSize: 22,
    letterSpacing: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginTop: 14,
    textAlign: 'center',
  },
  error: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    lineHeight: 17,
    color: theme.danger,
    marginTop: 10,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  action: {
    minWidth: 104,
  },
});
