import { StyleSheet, Text, View } from 'react-native';

import type { ScanProgress } from '../hooks/useStreamAssembler';
import { fonts, glow, formatBytes, theme } from '../theme';
import { Meter, type as type_, Window } from './Chassis';

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
      <Window title="FAULT">
        <Text style={styles.title} numberOfLines={2}>
          Cannot read this stream
        </Text>
        <Text style={styles.warning}>{warning}</Text>
        <Text style={styles.footnote}>
          {progress.stats.scans.toLocaleString()} barcodes seen ·{' '}
          {progress.stats.ignored.toLocaleString()} unrecognised
        </Text>
      </Window>
    );
  }

  if (!known) {
    return (
      <Window title="SEARCHING" bodyStyle={styles.centeredBody}>
        <Text style={styles.searching}>Looking for a stream…</Text>
      </Window>
    );
  }

  const done = progress.ratio >= 1;
  const percent = Math.min(Math.round(progress.ratio * 100), 100);

  return (
    <Window title="STREAM">
      <Text style={styles.title} numberOfLines={1}>
        {metadata.file.name}
      </Text>
      <Text style={styles.meta}>
        {formatBytes(metadata.file.size)} · {metadata.file.mime}
        {metadata.encryption ? ' · PIN' : ''}
      </Text>

      <View style={styles.progressRow}>
        <View style={styles.meterWrap}>
          <Meter ratio={progress.ratio} tone={done ? theme.ok : theme.accent} />
        </View>
        <Text style={[styles.percent, done && styles.percentDone]}>
          {done ? 'OK' : `${percent}%`}
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
    </Window>
  );
}

const styles = StyleSheet.create({
  centeredBody: {
    alignItems: 'center',
    paddingVertical: 22,
  },
  title: {
    fontFamily: fonts.bodyBold,
    fontSize: 15,
    color: theme.cream,
  },
  meta: {
    ...type_.muted,
    marginTop: 3,
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginTop: 12,
  },
  meterWrap: {
    flex: 1,
  },
  percent: {
    fontFamily: fonts.display,
    fontSize: 11,
    lineHeight: 16,
    color: theme.cream,
    ...glow,
    minWidth: 46,
    textAlign: 'right',
  },
  percentDone: {
    color: theme.ok,
  },
  frames: {
    ...type_.muted,
    marginTop: 8,
  },
  searching: {
    fontFamily: fonts.bodySemi,
    fontSize: 13,
    color: theme.cream,
  },
  footnote: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 16,
    color: theme.inkSoft,
    marginTop: 7,
  },
  warning: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 18,
    color: theme.warn,
    marginTop: 5,
  },
});
