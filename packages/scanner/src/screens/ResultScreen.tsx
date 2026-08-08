import type { StreamMetadata } from '@opticast/protocol';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Key, Led, type as type_, Window } from '../components/Chassis';
import { FilePreview } from '../components/FilePreview';
import { ScanLayout } from '../components/ScanLayout';
import {
  saveReceivedFile,
  type ReceivedFile,
  type SaveOutcome,
} from '../lib/receivedFile';
import { fonts, formatBytes, formatDuration, theme } from '../theme';

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
      border={{ color: theme.led, width: 3 }}
      preview={<FilePreview file={file} />}
    >
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Window title="RECEIVED">
          <View style={styles.successRow}>
            <Led on color={theme.led} />
            <Text style={styles.title} numberOfLines={1}>
              {file.name}
            </Text>
          </View>
          <Text style={styles.subtitle}>
            CHECKSUM VERIFIED{metadata.encryption ? ' · DECRYPTED' : ''}
          </Text>

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
            <Key
              label={saving ? 'Saving…' : 'Save File'}
              tone="primary"
              onPress={handleSave}
              disabled={saving}
            />
            <View style={styles.actionRow}>
              <Key
                compact
                label="Scan Another"
                onPress={onScanAnother}
                style={styles.actionHalf}
              />
              <Key
                compact
                tone="danger"
                label="Discard"
                onPress={onDiscard}
                style={styles.actionHalf}
              />
            </View>
          </View>
        </Window>
      </ScrollView>
    </ScanLayout>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 16,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },
  title: {
    flex: 1,
    fontFamily: fonts.bodyBold,
    fontSize: 16,
    color: theme.cream,
  },
  subtitle: {
    fontFamily: fonts.display,
    fontSize: 8,
    lineHeight: 13,
    letterSpacing: 0.4,
    color: theme.ok,
    marginTop: 7,
  },
  meta: {
    ...type_.muted,
    marginTop: 5,
  },
  hash: {
    fontFamily: fonts.body,
    fontSize: 10,
    color: theme.inkSoft,
    marginTop: 5,
  },
  outcome: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: theme.ok,
    marginTop: 9,
  },
  outcomeError: {
    color: theme.danger,
  },
  actions: {
    gap: 9,
    marginTop: 14,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 9,
  },
  actionHalf: {
    flex: 1,
  },
});
