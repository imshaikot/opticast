import { CameraView, type BarcodeScanningResult } from 'expo-camera';
import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { Key, Led } from '../components/Chassis';
import { ProgressPanel } from '../components/ProgressPanel';
import { ScanLayout } from '../components/ScanLayout';
import type { ScanProgress } from '../hooks/useStreamAssembler';
import { fonts, glow, raised, theme } from '../theme';

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
        color: done ? theme.ok : theme.signal,
        width: thickness,
        opacity: breath,
      }}
      live={!done}
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
            <View style={[styles.statusTag, raised]} pointerEvents="none">
              <Animated.View style={{ opacity: done ? 1 : dotPulse }}>
                <Led on color={done ? theme.led : theme.signal} />
              </Animated.View>
              <Text style={styles.statusText}>
                {done ? 'CAPTURED' : 'CAPTURING'}
              </Text>
            </View>
          )}
        </>
      }
    >
      <View style={styles.headerRow}>
        <Key compact label="Stop" onPress={onCancel} style={styles.headerKey} />
        {needsPin && !pinReady && (
          <Key
            compact
            tone="primary"
            label="Enter PIN"
            onPress={onEnterPin}
            style={styles.headerKey}
          />
        )}
        {needsPin && pinReady && (
          <View style={[styles.pinSet, raised]}>
            <Led on />
            <Text style={styles.pinSetText}>PIN SET</Text>
          </View>
        )}
      </View>

      <ProgressPanel progress={progress} />

      {/* Plain, not another window: it sits directly under the SEARCHING
          readout and a second frame around one line of advice reads as two
          instruments disagreeing about whose job it is. */}
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
    backgroundColor: theme.signal,
  },
  /* A little plate riveted to the glass, so it reads as part of the machine
     rather than as an overlay drawn by software. */
  statusTag: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 6,
    paddingHorizontal: 9,
    backgroundColor: theme.plate,
  },
  statusText: {
    fontFamily: fonts.display,
    fontSize: 8,
    lineHeight: 12,
    letterSpacing: 0.4,
    color: theme.cream,
    ...glow,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  headerKey: {
    minWidth: 92,
  },
  pinSet: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 9,
    paddingHorizontal: 11,
    backgroundColor: theme.plate,
  },
  pinSetText: {
    fontFamily: fonts.display,
    fontSize: 8,
    lineHeight: 12,
    color: theme.cream,
  },
  hint: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: theme.inkSoft,
    textAlign: 'center',
    marginTop: 14,
  },
});
