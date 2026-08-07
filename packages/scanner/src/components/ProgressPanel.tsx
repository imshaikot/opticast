import { StyleSheet, Text, View } from 'react-native';

import type { ScanProgress } from '../hooks/useStreamAssembler';
import { formatBytes, theme } from '../theme';

interface Props {
  progress: ScanProgress;
}

/**
 * The metadata + progress readout in the bottom panel. The frame border above
 * carries the same ratio; these are the numbers behind it. The engineering
 * footnote is dev-build only.
 */
export function ProgressPanel({ progress }: Props) {
  const { metadata } = progress;
  const known = metadata !== null;

  // Reading barcodes, knows the stream, has nothing to show for it — what a
  // scanner older than the video looks like. Longer pointing never fixes it.
  const mismatched =
    known && progress.received === 0 && progress.stats.ignored > 40;
  const warning =
    progress.unsupported ??
    (mismatched
      ? 'Reading barcodes, but none of them belong to this stream. The scanner may be older than the video — reinstall the app.'
      : null);

  if (warning) {
    return (
      <View style={styles.panel}>
        <Text style={styles.title} numberOfLines={2}>
          Cannot read this stream
        </Text>
        <Text style={styles.warning}>{warning}</Text>
        <Text style={styles.footnote}>
          {progress.stats.scans.toLocaleString()} barcodes seen ·{' '}
          {progress.stats.ignored.toLocaleString()} unrecognised
        </Text>
      </View>
    );
  }

  if (!known) {
    return (
      <View style={[styles.panel, styles.panelCentered]}>
        <Text style={styles.searching}>Looking for a stream…</Text>
      </View>
    );
  }

  const done = progress.ratio >= 1;
  const percent = Math.min(Math.round(progress.ratio * 100), 100);

  return (
    <View style={styles.panel}>
      <Text style={styles.title} numberOfLines={1}>
        {metadata.file.name}
      </Text>
      <Text style={styles.meta}>
        {formatBytes(metadata.file.size)} · {metadata.file.mime}
        {metadata.encryption ? ' · 🔒 PIN protected' : ''}
      </Text>

      <View style={styles.progressRow}>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              {
                width: `${percent}%`,
                backgroundColor: done ? theme.ok : theme.accent,
              },
            ]}
          />
        </View>
        <Text style={[styles.percent, done && styles.percentDone]}>
          {done ? '✓' : `${percent}%`}
        </Text>
      </View>

      <Text style={styles.frames}>
        {progress.received.toLocaleString()} of{' '}
        {progress.total.toLocaleString()} frames captured
      </Text>

      {/* Captured vs offered: level with the second number means `frameRepeat`
          could come down and the video get shorter. */}
      {__DEV__ && progress.captureRate > 0 && (
        <Text style={styles.footnote}>
          {progress.captureRate.toFixed(1)} of{' '}
          {metadata.transport.symbolRate.toFixed(1)} frames/s captured
          {progress.captureRate >= metadata.transport.symbolRate * 0.9
            ? ' — keeping up'
            : ''}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: theme.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: theme.border,
    paddingVertical: 16,
    paddingHorizontal: 18,
    gap: 4,
  },
  panelCentered: {
    alignItems: 'center',
  },
  title: {
    color: theme.text,
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    color: theme.muted,
    fontSize: 13,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  track: {
    flex: 1,
    height: 6,
    backgroundColor: theme.panel2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
  },
  percent: {
    color: theme.text,
    fontSize: 17,
    fontWeight: '700',
    minWidth: 44,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  percentDone: {
    color: theme.ok,
  },
  frames: {
    color: theme.muted,
    fontSize: 12,
    marginTop: 2,
  },
  searching: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '500',
    opacity: 0.9,
  },
  footnote: {
    color: theme.muted,
    fontSize: 11,
    marginTop: 6,
  },
  warning: {
    color: theme.warn,
    fontSize: 13,
    lineHeight: 18,
  },
});
