import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { DEFAULT_CHANNEL_ID } from '../slack/config';
import type { PairingInput } from '../slack/useSlack';

interface SlackPairingProps {
  /** Runs authTest + connects; resolves to an error message or null. */
  onPair: (input: PairingInput) => Promise<string | null>;
  onForget: () => void;
  onClose: () => void;
}

export function SlackPairing({ onPair, onForget, onClose }: SlackPairingProps) {
  const [botToken, setBotToken] = useState('');
  const [appToken, setAppToken] = useState('');
  const [channelId, setChannelId] = useState(DEFAULT_CHANNEL_ID);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const problem = await onPair({
      botToken: botToken.trim(),
      appToken: appToken.trim(),
      channelId: channelId.trim(),
    });
    setBusy(false);
    if (problem) setError(problem);
    else onClose();
  };

  const field = (label: string, value: string, set: (v: string) => void, placeholder: string) => (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={set}
        placeholder={placeholder}
        placeholderTextColor="#4e5a54"
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
    </View>
  );

  return (
    <View style={styles.backdrop} pointerEvents="box-none">
      <View style={styles.panel}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>SLACK PAIRING</Text>
          <Pressable onPress={onClose} hitSlop={12}>
            <Text style={styles.close}>CLOSE</Text>
          </Pressable>
        </View>
        {field('BOT TOKEN', botToken, setBotToken, 'xoxb-…')}
        {field('APP TOKEN', appToken, setAppToken, 'xapp-…')}
        {field('CHANNEL ID', channelId, setChannelId, 'C…')}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <View style={styles.row}>
          <Pressable style={styles.btn} onPress={() => void save()}>
            <Text style={styles.btnLabel}>{busy ? 'Pairing…' : 'Pair'}</Text>
          </Pressable>
          <Pressable
            style={styles.btn}
            onPress={() => {
              onForget();
              onClose();
            }}
          >
            <Text style={styles.btnLabel}>Forget</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: 420,
    padding: 16,
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2d2a',
    backgroundColor: 'rgba(14,16,14,0.98)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 10,
    letterSpacing: 1.4,
    color: '#5c625c',
  },
  close: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#a8ada8',
  },
  field: {
    gap: 4,
  },
  fieldLabel: {
    fontFamily: 'JetBrainsMono_500Medium',
    fontSize: 9,
    letterSpacing: 1.2,
    color: '#5c625c',
  },
  input: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 12,
    color: '#d6efe4',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2d2a',
    backgroundColor: '#101210',
  },
  error: {
    fontFamily: 'JetBrainsMono_400Regular',
    fontSize: 11,
    color: '#c97b6b',
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flexGrow: 1,
    alignItems: 'center',
    paddingVertical: 9,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2d2a',
    backgroundColor: '#1b1d1b',
  },
  btnLabel: {
    fontFamily: 'SpaceGrotesk_500Medium',
    fontSize: 12,
    color: '#a8ada8',
  },
});
