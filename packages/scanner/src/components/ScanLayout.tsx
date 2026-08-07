import type { ReactNode } from 'react';
import { Animated, SafeAreaView, StyleSheet, View } from 'react-native';

import { theme } from '../theme';

interface FrameBorder {
  color: string;
  width: number | Animated.Value;
  opacity?: number | Animated.Value;
}

interface Props {
  /** The rounded border around the preview; doubles as the progress bar. */
  border: FrameBorder;
  /** Fills the top frame edge-to-edge, clipped to the rounded corners. */
  preview: ReactNode;
  /** The bottom panel: metadata, progress, actions. */
  children: ReactNode;
}

const FRAME_RADIUS = 28;

/**
 * The one screen geometry for a scan: preview in the top ~60% behind a rounded
 * border, everything textual in the bottom ~40%. The live scan, the decrypt
 * interstitial and the result all render through this, which is what lets the
 * camera "become" the file preview on completion instead of the app cutting to
 * a differently-shaped screen.
 */
export function ScanLayout({ border, preview, children }: Props) {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.previewArea}>
        <View style={styles.frame}>
          <View style={styles.clip}>{preview}</View>
          {/* Drawn over the clip, not on it: a growing borderWidth would
              otherwise push the preview content inward. */}
          <Animated.View
            pointerEvents="none"
            style={[
              styles.frameBorder,
              {
                borderColor: border.color,
                borderWidth: border.width,
                opacity: border.opacity ?? 1,
              },
            ]}
          />
        </View>
      </View>
      <View style={styles.panel}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.bg,
  },
  previewArea: {
    flex: 6,
    paddingTop: 12,
    paddingHorizontal: 16,
  },
  frame: {
    flex: 1,
  },
  clip: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: FRAME_RADIUS,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  frameBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: FRAME_RADIUS,
  },
  panel: {
    flex: 4,
    paddingTop: 16,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
});
