import type { StreamMetadata } from '@opticast/protocol';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { FilePreview } from '../components/FilePreview';
import { ScanLayout } from '../components/ScanLayout';
import {
  saveReceivedFile,
  type ReceivedFile,
  type SaveOutcome,
} from '../lib/receivedFile';
import { formatBytes, formatDuration, theme } from '../theme';

interface Props {
  file: ReceivedFile;
  metadata: StreamMetadata;
  onDiscard: () => void;
  onScanAnother: () => void;
}

const OUTCOME_TEXT: Record<SaveOutcome['status'], string> = {
  'saved-to-library': 'Saved to your library',
  shared: 'Handed off to the share sheet',
  cancelled: 'Save cancelled',
  failed: 'Save failed',
};

/**
 * Same geometry as the scan: the file preview takes over the frame the camera
 * occupied a moment ago, and the bottom panel swaps progress for actions.
 */
export function ResultScreen({
  file,
  metadata,
  onDiscard,
  onScanAnother,
}: Props) {
  const [saving, setSaving] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);

  async function handleSave() {
    setSaving(true);
    setOutcome(await saveReceivedFile(file));
    setSaving(false);
  }

  const detailParts = [
    `${metadata.transport.frames.toLocaleString()} frames`,
    metadata.encryption ? 'AES-256-GCM' : 'unencrypted',
  ];
  if (metadata.media?.width && metadata.media?.height) {
    detailParts.push(`${metadata.media.width} × ${metadata.media.height}`);
  }
  if (metadata.media?.durationSec !== undefined) {
    detailParts.push(formatDuration(metadata.media.durationSec));
  }

  return (
    <ScanLayout
      border={{ color: theme.ok, width: 3 }}
      preview={<FilePreview file={file} />}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.successRow}>
          <Text style={styles.successIcon}>✅</Text>
          <View style={styles.successText}>
            <Text style={styles.title} numberOfLines={1}>
              {file.name}
            </Text>
            <Text style={styles.subtitle}>
              Checksum verified{metadata.encryption ? ' · decrypted' : ''}
            </Text>
          </View>
        </View>

        <Text style={styles.meta}>
          {formatBytes(file.size)} · {file.mime}
        </Text>
        <Text style={styles.meta}>{detailParts.join(' · ')}</Text>
        <Text style={styles.hash} numberOfLines={1}>
          sha256 {metadata.file.sha256}
        </Text>

        {outcome && (
          <Text
            style={[
              styles.outcome,
              outcome.status === 'failed' && styles.outcomeError,
            ]}
          >
            {OUTCOME_TEXT[outcome.status]}
            {outcome.status === 'failed' ? `: ${outcome.message}` : ''}
          </Text>
        )}

        <View style={styles.actions}>
          <Pressable
            style={[styles.primary, saving && styles.disabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.primaryText}>
              {saving ? 'Saving…' : 'Save file'}
            </Text>
          </Pressable>
          <View style={styles.actionRow}>
            <Pressable style={styles.ghost} onPress={onScanAnother}>
              <Text style={styles.ghostText}>Scan another</Text>
            </Pressable>
            <Pressable style={styles.ghost} onPress={onDiscard}>
              <Text style={[styles.ghostText, styles.danger]}>Discard</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </ScanLayout>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    gap: 8,
    paddingBottom: 16,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  successIcon: {
    fontSize: 24,
  },
  successText: {
    flex: 1,
  },
  title: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.ok,
    fontSize: 13,
    marginTop: 2,
  },
  meta: {
    color: theme.muted,
    fontSize: 13,
  },
  hash: {
    color: theme.muted,
    fontSize: 10,
    fontFamily: 'Courier',
  },
  outcome: {
    color: theme.ok,
    fontSize: 13,
  },
  outcomeError: {
    color: theme.danger,
  },
  actions: {
    gap: 10,
    marginTop: 8,
  },
  primary: {
    backgroundColor: theme.accent,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  ghost: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  ghostText: {
    color: theme.muted,
    fontWeight: '600',
  },
  danger: {
    color: theme.danger,
  },
  disabled: {
    opacity: 0.5,
  },
});
