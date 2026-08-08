import type { ReactNode } from 'react';
import { Animated, SafeAreaView, StyleSheet, View } from 'react-native';

import { raised, sunken, theme } from '../theme';
import { CrtOverlay } from './CrtOverlay';

interface FrameBorder {
  color: string;
  width: number | Animated.Value;
  opacity?: number | Animated.Value;
}

interface Props {
  /** The border around the glass; doubles as the progress bar. */
  border: FrameBorder;
  /** Fills the screen edge-to-edge, clipped to the glass corners. */
  preview: ReactNode;
  /** Runs the CRT sweep. On while the camera is capturing, off otherwise. */
  live?: boolean;
  /** The bottom panel: metadata, progress, actions. */
  children: ReactNode;
}

/**
 * The one screen geometry for a scan: preview in the top ~60% behind a bezel,
 * everything textual in the bottom ~40%. The live scan, the decrypt
 * interstitial and the result all render through this, which is what lets the
 * camera "become" the file preview on completion instead of the app cutting to
 * a differently-shaped screen.
 *
 * The preview is a monitor now — beige bezel raised out of the case, glass
 * sunk into it. Only the glass keeps a radius; a CRT had one and nothing else
 * in this app does.
 */
const GLASS_RADIUS = 14;

export function ScanLayout({ border, preview, live, children }: Props) {
  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.previewArea}>
        <View style={[styles.bezel, raised]}>
          <View style={[styles.glassWell, sunken]}>
            <View style={styles.frame}>
              {/* Inside the clip, so the scanlines and vignette are cut to
                  the glass corners rather than running under the bezel. */}
              <View style={styles.clip}>
                {preview}
                <CrtOverlay live={live} />
              </View>
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
        </View>
      </View>
      <View style={styles.panel}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.case,
  },
  previewArea: {
    flex: 6,
    paddingTop: 10,
    paddingHorizontal: 12,
  },
  bezel: {
    flex: 1,
    backgroundColor: theme.case,
    padding: 9,
    borderWidth: 2,
  },
  glassWell: {
    flex: 1,
    backgroundColor: theme.screen,
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
    borderRadius: GLASS_RADIUS,
    overflow: 'hidden',
    backgroundColor: theme.screen,
  },
  frameBorder: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: GLASS_RADIUS,
  },
  panel: {
    flex: 4,
    paddingTop: 12,
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
});
