import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Key, Meter, type as type_, Window } from '../components/Chassis';
import {
  displayPath,
  listRegistry,
  removeEntry,
  type RegistryEntry,
} from '../lib/fileRegistry';
import { saveReceivedFile, type SaveOutcome } from '../lib/receivedFile';
import { fonts, glow, formatBytes, theme } from '../theme';

interface Props {
  onClose: () => void;
}

/** Doubles as the window title, so the kind is legible without an icon font. */
const KIND_LABEL: Record<RegistryEntry['kind'], string> = {
  image: 'IMAGE',
  video: 'VIDEO',
  audio: 'AUDIO',
  other: 'FILE',
};

const OUTCOME_TEXT: Record<SaveOutcome['status'], string> = {
  'saved-to-library': 'Saved to your library',
  shared: 'Handed off to the share sheet',
  cancelled: 'Save cancelled',
  failed: 'Save failed',
};

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Everything the device has scanned, in two piles: interrupted scans (which
 * cannot be resumed, only redone) and files that landed on disk.
 */
export function FilesScreen({ onClose }: Props) {
  const [entries, setEntries] = useState<RegistryEntry[]>(() => listRegistry());
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(() => setEntries(listRegistry()), []);

  const confirmRemove = useCallback(
    (entry: RegistryEntry) => {
      Alert.alert(
        entry.status === 'completed' ? 'Delete file?' : 'Remove from list?',
        entry.status === 'completed'
          ? `"${entry.name}" will be deleted from this device.`
          : `The unfinished scan of "${entry.name}" will be forgotten.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: entry.status === 'completed' ? 'Delete' : 'Remove',
            style: 'destructive',
            onPress: () => {
              removeEntry(entry.id);
              refresh();
            },
          },
        ],
      );
    },
    [refresh],
  );

  const handleSave = useCallback(async (entry: RegistryEntry) => {
    if (!entry.path) return;
    const outcome = await saveReceivedFile({
      id: entry.id,
      uri: entry.path,
      name: entry.name,
      mime: entry.mime,
      size: entry.size,
      kind: entry.kind,
    });
    setNotice(
      outcome.status === 'failed'
        ? `${OUTCOME_TEXT.failed}: ${outcome.message}`
        : OUTCOME_TEXT[outcome.status],
    );
  }, []);

  const inProgress = entries.filter((entry) => entry.status === 'in-progress');
  const completed = entries.filter((entry) => entry.status === 'completed');

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Key compact label="Back" onPress={onClose} style={styles.back} />
        <Text style={styles.heading}>YOUR FILES</Text>
        <View style={styles.back} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {notice && <Text style={styles.notice}>{notice}</Text>}

        {entries.length === 0 && (
          <Window title="EMPTY" bodyStyle={styles.emptyBody}>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyText}>
              Capture a file and it will show up in this list.
            </Text>
          </Window>
        )}

        {inProgress.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>IN PROGRESS</Text>
            <Text style={styles.sectionHint}>
              These scans were interrupted. Scan the video again to finish one.
            </Text>
            {inProgress.map((entry) => (
              <Window key={entry.id} title={KIND_LABEL[entry.kind]}>
                <Text style={styles.name} numberOfLines={1}>
                  {entry.name}
                  {entry.encrypted ? '  · PIN' : ''}
                </Text>
                <Text style={styles.meta}>
                  {formatBytes(entry.size)} ·{' '}
                  {Math.round(entry.progress * 100)}% scanned ·{' '}
                  {formatWhen(entry.updatedAt)}
                </Text>
                <View style={styles.meterRow}>
                  <Meter ratio={entry.progress} height={12} />
                </View>
                <View style={styles.cardActions}>
                  <Key
                    compact
                    tone="danger"
                    label="Remove"
                    onPress={() => confirmRemove(entry)}
                    style={styles.cardAction}
                  />
                </View>
              </Window>
            ))}
          </>
        )}

        {completed.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>COMPLETED</Text>
            {completed.map((entry) => (
              <Window key={entry.id} title={KIND_LABEL[entry.kind]}>
                <Text style={styles.name} numberOfLines={1}>
                  {entry.name}
                </Text>
                <Text style={styles.meta}>
                  {formatBytes(entry.size)} · {entry.mime} ·{' '}
                  {formatWhen(entry.updatedAt)}
                </Text>
                {entry.path && (
                  <Text style={styles.path} numberOfLines={2}>
                    {displayPath(entry.path)}
                  </Text>
                )}
                <View style={styles.cardActions}>
                  <Key
                    compact
                    tone="primary"
                    label="Save / Share"
                    onPress={() => void handleSave(entry)}
                    style={styles.cardAction}
                  />
                  <Key
                    compact
                    tone="danger"
                    label="Delete"
                    onPress={() => confirmRemove(entry)}
                    style={styles.cardAction}
                  />
                </View>
              </Window>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.case,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 58,
    paddingHorizontal: 14,
    paddingBottom: 12,
  },
  back: {
    minWidth: 78,
  },
  heading: {
    fontFamily: fonts.display,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0.5,
    color: theme.cream,
    ...glow,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 14,
    paddingBottom: 48,
    gap: 12,
  },
  notice: {
    fontFamily: fonts.bodySemi,
    fontSize: 12,
    color: theme.ok,
    textAlign: 'center',
  },
  emptyBody: {
    alignItems: 'center',
    paddingVertical: 44,
    gap: 8,
  },
  emptyTitle: {
    fontFamily: fonts.display,
    fontSize: 11,
    lineHeight: 17,
    color: theme.cream,
  },
  emptyText: {
    ...type_.muted,
    textAlign: 'center',
    maxWidth: 250,
  },
  sectionTitle: {
    fontFamily: fonts.display,
    fontSize: 9,
    lineHeight: 15,
    letterSpacing: 0.6,
    color: theme.inkSoft,
    marginTop: 8,
  },
  sectionHint: {
    ...type_.muted,
    marginTop: -6,
  },
  name: {
    fontFamily: fonts.bodyBold,
    fontSize: 14,
    color: theme.cream,
  },
  meta: {
    ...type_.muted,
    marginTop: 4,
  },
  path: {
    fontFamily: fonts.body,
    fontSize: 10,
    lineHeight: 15,
    color: theme.inkSoft,
    marginTop: 5,
  },
  meterRow: {
    marginTop: 11,
  },
  cardActions: {
    flexDirection: 'row',
    gap: 9,
    marginTop: 12,
  },
  cardAction: {
    flex: 1,
  },
});
