import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ProgressPanel } from '../components/ProgressPanel';
import { ScanLayout } from '../components/ScanLayout';
import type { ScanProgress } from '../hooks/useStreamAssembler';
import { theme } from '../theme';

interface Props {
  progress: ScanProgress;
  onBarcodeScanned: (result: BarcodeScanningResult) => void;
  onEnterPin: () => void;
  onCancel: () => void;
  /** True once a PIN has been supplied, so the prompt button can hide. */
  pinReady: boolean;
}

/** The frame border doubles as the progress bar: thin at 0%, thick at 100%. */
const BORDER_MIN = 3;
const BORDER_MAX = 12;

export function ScannerScreen({
  progress,
  onBarcodeScanned,
  onEnterPin,
  onCancel,
  pinReady,
}: Props) {
  const needsPin = progress.metadata?.encryption != null;
  const searching = progress.metadata === null;
  const done = progress.ratio >= 1;
  const capturing = !searching && !done && progress.received > 0;

  // borderWidth cannot be driven natively, but progress reaches React at most
  // every 120ms, so the JS driver has an easy job.
  const thickness = useRef(new Animated.Value(BORDER_MIN)).current;
  useEffect(() => {
    Animated.timing(thickness, {
      toValue:
        BORDER_MIN + (BORDER_MAX - BORDER_MIN) * Math.min(progress.ratio, 1),
      duration: 220,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [progress.ratio, thickness]);

  const breath = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!searching) {
      breath.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, {
          toValue: 0.35,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
        Animated.timing(breath, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [searching, breath]);

  // Every newly accepted frame flashes the preview, so capture shows where the
  // camera is pointed rather than only in the numbers below.
  const flash = useRef(new Animated.Value(0)).current;
  const lastReceived = useRef(0);
  useEffect(() => {
    if (progress.received < lastReceived.current) lastReceived.current = 0;
    if (progress.received === lastReceived.current) return;
    lastReceived.current = progress.received;
    flash.setValue(0.3);
    Animated.timing(flash, {
      toValue: 0,
      duration: 280,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [progress.received, flash]);

  const dotPulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!capturing) {
      dotPulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotPulse, {
          toValue: 0.25,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(dotPulse, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [capturing, dotPulse]);

  return (
    <ScanLayout
      border={{
        color: done ? theme.ok : theme.accent,
        width: thickness,
        opacity: breath,
      }}
      preview={
        <>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={onBarcodeScanned}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.flash, { opacity: flash }]}
          />
          {(capturing || done) && (
            <View style={styles.statusPill} pointerEvents="none">
              <Animated.View
                style={[
                  styles.dot,
                  done && styles.dotDone,
                  { opacity: done ? 1 : dotPulse },
                ]}
              />
              <Text style={styles.statusText}>
                {done ? 'Captured' : 'Capturing'}
              </Text>
            </View>
          )}
        </>
      }
    >
      <View style={styles.headerRow}>
        <Pressable style={styles.close} onPress={onCancel} hitSlop={10}>
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        {needsPin && !pinReady && (
          <Pressable
            style={[styles.chip, styles.chipAccent]}
            onPress={onEnterPin}
          >
            <Text style={styles.chipText}>🔒 Enter PIN</Text>
          </Pressable>
        )}
        {needsPin && pinReady && (
          <View style={[styles.chip, styles.chipOk]}>
            <Text style={styles.chipText}>🔓 PIN set</Text>
          </View>
        )}
      </View>

      <ProgressPanel progress={progress} />

      {searching && (
        <Text style={styles.hint}>Point your camera at the playing video</Text>
      )}
    </ScanLayout>
  );
}

const styles = StyleSheet.create({
  flash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: theme.accent,
  },
  statusPill: {
    position: 'absolute',
    top: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(15,17,21,0.75)',
    borderWidth: 1,
    borderColor: theme.border,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.accent,
  },
  dotDone: {
    backgroundColor: theme.ok,
  },
  statusText: {
    color: theme.text,
    fontSize: 12,
    fontWeight: '600',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  close: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: theme.text,
    fontSize: 16,
    fontWeight: '600',
  },
  chip: {
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.border,
  },
  chipAccent: {
    borderColor: theme.accent,
  },
  chipOk: {
    borderColor: theme.ok,
  },
  chipText: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '600',
  },
  hint: {
    color: theme.muted,
    fontSize: 13,
    textAlign: 'center',
    marginTop: 14,
  },
});
