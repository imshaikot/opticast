import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { fonts, glow, raised, sunken, theme } from '../theme';

/**
 * The parts a beige machine is assembled from. Every surface in the app is one
 * of these, so depth stays consistent: light up-left means it sticks out and
 * you can press it, dark up-left means it is a hole and something lives in it.
 */

/** Shared text ramps. Weight comes from the family — see `fonts` in theme.ts. */
export const type = StyleSheet.create({
  /** Pixel display face. Small sizes only; it has no hinting to spare. */
  display: {
    fontFamily: fonts.display,
    color: theme.ink,
  },
  /** The engraved caption over a control. */
  label: {
    fontFamily: fonts.display,
    fontSize: 8,
    lineHeight: 13,
    letterSpacing: 0.4,
    color: theme.inkSoft,
  },
  body: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: theme.ink,
  },
  bodyBold: {
    fontFamily: fonts.bodyBold,
    fontSize: 13,
    color: theme.ink,
  },
  muted: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: theme.inkSoft,
  },
});

const STRIPES = [0, 1, 2, 3, 4, 5];

function Stripes() {
  return (
    <View style={styles.stripes}>
      {STRIPES.map((index) => (
        <View key={index} style={styles.stripe} />
      ))}
    </View>
  );
}

interface WindowProps {
  title: string;
  /** Renders the close box at the left of the title bar. */
  onClose?: () => void;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  bodyStyle?: StyleProp<ViewStyle>;
}

/**
 * A titled window: hard outline, raised case, and the striped title bar that
 * every 1-bit desktop used to say "this whole rectangle is one thing". The
 * title sits in a gap punched through the stripes rather than over them.
 */
export function Window({
  title,
  onClose,
  children,
  style,
  bodyStyle,
}: WindowProps) {
  return (
    <View style={[styles.window, style]}>
      <View style={styles.windowInner}>
        <View style={styles.titleBar}>
          {onClose ? (
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [
                styles.closeBox,
                pressed ? sunken : raised,
              ]}
            />
          ) : null}
          <Stripes />
          <Text style={styles.titleText} numberOfLines={1}>
            {title}
          </Text>
          <Stripes />
        </View>
        <View style={[styles.windowBody, bodyStyle]}>{children}</View>
      </View>
    </View>
  );
}

interface KeyProps {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  /** `primary` is the silk-screened action key; `danger` only tints the text. */
  tone?: 'default' | 'primary' | 'danger';
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}

/** A keycap. Raised at rest, sunken while held — the whole animation budget. */
export function Key({
  label,
  onPress,
  disabled,
  tone = 'default',
  compact,
  style,
  textStyle,
}: KeyProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [
        styles.key,
        compact && styles.keyCompact,
        tone === 'primary' && styles.keyPrimary,
        pressed && !disabled ? sunken : raised,
        disabled && styles.keyDisabled,
        style,
      ]}
    >
      <Text
        style={[
          styles.keyLabel,
          compact && styles.keyLabelCompact,
          tone === 'primary' && styles.keyLabelPrimary,
          tone === 'danger' && styles.keyLabelDanger,
          disabled && styles.keyLabelDisabled,
          textStyle,
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** A panel lamp, set into the case behind its own little bezel. */
export function Led({ on, color = theme.led }: { on?: boolean; color?: string }) {
  return (
    <View style={[styles.ledWell, sunken]}>
      <View
        style={[
          styles.ledCore,
          { backgroundColor: on ? color : theme.caseDark, opacity: on ? 1 : 0.5 },
        ]}
      />
    </View>
  );
}

const CELLS = Array.from({ length: 20 }, (_, index) => index);

/**
 * Segmented bar meter. The fill is one solid block; the cell dividers are an
 * overlay in the track colour, so they read as gaps punched out of the fill
 * and stay invisible over the empty remainder.
 */
export function Meter({
  ratio,
  tone = theme.accent,
  height = 14,
}: {
  ratio: number;
  tone?: string;
  height?: number;
}) {
  const percent = Math.max(0, Math.min(1, ratio)) * 100;
  return (
    <View style={[styles.meterTrack, sunken, { height }]}>
      <View
        style={[styles.meterFill, { width: `${percent}%`, backgroundColor: tone }]}
      />
      <View style={styles.meterCells} pointerEvents="none">
        {CELLS.map((index) => (
          <View key={index} style={styles.meterCell} />
        ))}
      </View>
    </View>
  );
}

/** A recessed plate — the surface readouts and list rows sit on. */
export function Plate({
  children,
  style,
}: {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  return <View style={[styles.plate, sunken, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  window: {
    borderWidth: 1,
    borderColor: theme.caseEdge,
    backgroundColor: theme.panel,
  },
  windowInner: {
    ...raised,
  },
  titleBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 7,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.caseDark,
  },
  stripes: {
    flex: 1,
    gap: 2,
  },
  stripe: {
    height: 1,
    backgroundColor: theme.caseEdge,
    opacity: 0.5,
  },
  titleText: {
    fontFamily: fonts.display,
    fontSize: 9,
    lineHeight: 14,
    color: theme.cream,
    letterSpacing: 0.4,
    maxWidth: '62%',
    ...glow,
  },
  closeBox: {
    width: 13,
    height: 13,
    backgroundColor: theme.case,
  },
  windowBody: {
    padding: 14,
  },

  key: {
    backgroundColor: theme.case,
    paddingVertical: 13,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyCompact: {
    paddingVertical: 9,
    paddingHorizontal: 11,
  },
  keyPrimary: {
    backgroundColor: theme.accent,
  },
  keyDisabled: {
    opacity: 0.45,
  },
  keyLabel: {
    fontFamily: fonts.display,
    fontSize: 10,
    lineHeight: 15,
    letterSpacing: 0.3,
    color: theme.ink,
    textAlign: 'center',
    ...glow,
  },
  keyLabelCompact: {
    fontSize: 8,
    lineHeight: 12,
  },
  keyLabelPrimary: {
    // Dark on the moulded-orange key, the way the legend was actually printed.
    color: theme.case,
    textShadowRadius: 0,
  },
  keyLabelDanger: {
    color: theme.danger,
  },
  keyLabelDisabled: {
    color: theme.inkSoft,
  },

  ledWell: {
    width: 14,
    height: 14,
    backgroundColor: theme.well,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ledCore: {
    width: 6,
    height: 6,
  },

  meterTrack: {
    backgroundColor: theme.well,
    overflow: 'hidden',
  },
  meterFill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
  },
  meterCells: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
  },
  meterCell: {
    flex: 1,
    borderRightWidth: 2,
    borderRightColor: theme.well,
  },

  plate: {
    backgroundColor: theme.plate,
    padding: 13,
  },
});
