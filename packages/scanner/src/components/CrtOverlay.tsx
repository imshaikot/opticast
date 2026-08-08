import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, {
  Defs,
  LinearGradient,
  Pattern,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';

import { theme } from '../theme';

/**
 * Turns whatever is behind it into a CRT: scanlines, a vignette standing in
 * for tube curvature, a glare streak, and — while the camera is live — a
 * sweep band rolling down the glass.
 *
 * Safe to draw over the camera, unlike the dashboard's player. `onBarcodeScanned`
 * is fed by the native capture pipeline straight off the sensor buffer; these
 * views are composited for display only and never reach the decoder. The real
 * cost is human: the person holding the phone is aiming with this preview, so
 * every layer here is deliberately weak enough to see through.
 */

/** Line every 3px. Tile is 4 wide only so it repeats cheaply across. */
const SCANLINE_PITCH = 3;
const SCANLINE_ALPHA = 0.18;

const SWEEP_HEIGHT = 130;
const SWEEP_MS = 4200;

interface Props {
  /** Run the rolling sweep. Off for the decrypt and result screens. */
  live?: boolean;
}

export function CrtOverlay({ live }: Props) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const sweep = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!live || size.height === 0) {
      sweep.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(sweep, {
        toValue: 1,
        duration: SWEEP_MS,
        easing: Easing.linear,
        // Transform only, so the band never touches the JS thread while the
        // barcode callback is firing.
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [live, size.height, sweep]);

  const translateY = sweep.interpolate({
    inputRange: [0, 1],
    outputRange: [-SWEEP_HEIGHT, size.height],
  });

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        setSize((previous) =>
          previous.width === width && previous.height === height
            ? previous
            : { width, height },
        );
      }}
    >
      {size.width > 0 && (
        <>
          <Svg
            width={size.width}
            height={size.height}
            style={StyleSheet.absoluteFill}
          >
            <Defs>
              <Pattern
                id="scanlines"
                x="0"
                y="0"
                width="4"
                height={SCANLINE_PITCH}
                patternUnits="userSpaceOnUse"
              >
                <Rect
                  x="0"
                  y="0"
                  width="4"
                  height="1"
                  fill="#000"
                  opacity={SCANLINE_ALPHA}
                />
              </Pattern>

              {/* Corners fall away, the way a tube's does. */}
              <RadialGradient id="vignette" cx="50%" cy="50%" rx="72%" ry="72%">
                <Stop offset="0.5" stopColor="#000" stopOpacity="0" />
                <Stop offset="1" stopColor="#000" stopOpacity="0.5" />
              </RadialGradient>

              {/* Room light on the glass, upper-left. */}
              <LinearGradient id="glare" x1="0" y1="0" x2="0.7" y2="1">
                <Stop offset="0" stopColor="#fff" stopOpacity="0.07" />
                <Stop offset="0.35" stopColor="#fff" stopOpacity="0" />
              </LinearGradient>
            </Defs>

            <Rect
              width={size.width}
              height={size.height}
              fill="url(#scanlines)"
            />
            <Rect width={size.width} height={size.height} fill="url(#vignette)" />
            <Rect width={size.width} height={size.height} fill="url(#glare)" />
          </Svg>

          {live && (
            <Animated.View
              style={[
                styles.sweep,
                { width: size.width, transform: [{ translateY }] },
              ]}
            >
              <Svg width={size.width} height={SWEEP_HEIGHT}>
                <Defs>
                  <LinearGradient id="sweepBand" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={theme.signal} stopOpacity="0" />
                    <Stop
                      offset="0.5"
                      stopColor={theme.phosphor}
                      stopOpacity="0.13"
                    />
                    <Stop offset="1" stopColor={theme.signal} stopOpacity="0" />
                  </LinearGradient>
                </Defs>
                <Rect
                  width={size.width}
                  height={SWEEP_HEIGHT}
                  fill="url(#sweepBand)"
                />
              </Svg>
            </Animated.View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sweep: {
    position: 'absolute',
    top: 0,
    left: 0,
    height: SWEEP_HEIGHT,
  },
});
