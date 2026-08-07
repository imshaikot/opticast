import { useCallback, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  displayPath,
  listRegistry,
  removeEntry,
  type RegistryEntry,
} from '../lib/fileRegistry';
import { saveReceivedFile, type SaveOutcome } from '../lib/receivedFile';
import { formatBytes, theme } from '../theme';

interface Props {
  onClose: () => void;
}

const KIND_ICON: Record<RegistryEntry['kind'], string> = {
  image: '🖼️',
  video: '🎬',
  audio: '🎵',
  other: '📄',
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
        <Pressable style={styles.back} onPress={onClose} hitSlop={12}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>
        <Text style={styles.heading}>Your Files</Text>
        <View style={styles.back} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {notice && <Text style={styles.notice}>{notice}</Text>}

        {entries.length === 0 && (
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>🗂️</Text>
            <Text style={styles.emptyTitle}>Nothing here yet</Text>
            <Text style={styles.emptyText}>
              Capture a file and it will show up in this list.
            </Text>
          </View>
        )}

        {inProgress.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>In progress</Text>
            <Text style={styles.sectionHint}>
              These scans were interrupted. Scan the video again to finish one.
            </Text>
            {inProgress.map((entry) => (
              <View key={entry.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.icon}>{KIND_ICON[entry.kind]}</Text>
                  <View style={styles.cardBody}>
                    <Text style={styles.name} numberOfLines={1}>
                      {entry.name}
                      {entry.encrypted ? '  🔒' : ''}
                    </Text>
                    <Text style={styles.meta}>
                      {formatBytes(entry.size)} ·{' '}
                      {Math.round(entry.progress * 100)}% scanned ·{' '}
                      {formatWhen(entry.updatedAt)}
                    </Text>
                  </View>
                  <Pressable
                    style={styles.action}
                    onPress={() => confirmRemove(entry)}
                    hitSlop={8}
                  >
                    <Text style={styles.actionDanger}>Remove</Text>
                  </Pressable>
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${Math.round(entry.progress * 100)}%` },
                    ]}
                  />
                </View>
              </View>
            ))}
          </>
        )}

        {completed.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Completed</Text>
            {completed.map((entry) => (
              <View key={entry.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.icon}>{KIND_ICON[entry.kind]}</Text>
                  <View style={styles.cardBody}>
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
                  </View>
                </View>
                <View style={styles.cardActions}>
                  <Pressable
                    style={styles.button}
                    onPress={() => void handleSave(entry)}
                  >
                    <Text style={styles.buttonText}>Save / Share</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.button, styles.buttonGhost]}
                    onPress={() => confirmRemove(entry)}
                  >
                    <Text style={styles.actionDanger}>Delete</Text>
                  </Pressable>
                </View>
              </View>
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
    backgroundColor: theme.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 60,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  back: {
    minWidth: 60,
  },
  backText: {
    color: theme.accent,
    fontSize: 16,
    fontWeight: '600',
  },
  heading: {
    color: theme.text,
    fontSize: 18,
    fontWeight: '700',
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
    gap: 10,
  },
  notice: {
    color: theme.ok,
    fontSize: 13,
    textAlign: 'center',
    marginBottom: 4,
  },
  empty: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 80,
  },
  emptyIcon: {
    fontSize: 40,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '600',
  },
  emptyText: {
    color: theme.muted,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 260,
  },
  sectionTitle: {
    color: theme.muted,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginTop: 14,
  },
  sectionHint: {
    color: theme.muted,
    fontSize: 12,
    marginTop: -4,
  },
  card: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: theme.radius,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  icon: {
    fontSize: 26,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  name: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    color: theme.muted,
    fontSize: 12,
  },
  path: {
    color: theme.muted,
    fontSize: 11,
    fontFamily: 'Courier',
    marginTop: 2,
  },
  track: {
    height: 5,
    backgroundColor: theme.panel2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: theme.accent,
    borderRadius: 999,
  },
  action: {
    paddingVertical: 6,
    paddingLeft: 8,
  },
  actionDanger: {
    color: theme.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    gap: 10,
  },
  button: {
    flex: 1,
    borderWidth: 1,
    borderColor: theme.accent,
    borderRadius: 9,
    paddingVertical: 10,
    alignItems: 'center',
  },
  buttonGhost: {
    borderColor: theme.border,
  },
  buttonText: {
    color: theme.accent,
    fontSize: 13,
    fontWeight: '700',
  },
});
