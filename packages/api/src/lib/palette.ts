/**
 * Per-barcode colours. Free because every decoder binarizes on luminance and
 * throws chroma away — a QR has to be dark-on-light, not black-on-white.
 *
 * Two invariants keep it scannable, both enforced by `palette.spec.ts`:
 * polarity stays dark-on-light (MLKit will not decode an inverted symbol), and
 * the grayscale gap survives every hue. HSL lightness is not luminance, so the
 * constants below were swept across all 360 hues under both the Rec.709 and
 * Rec.601 weightings. Don't retune by eye; the spec measures it.
 */

export interface QrColors {
  /** Module colour, `#rrggbb`. Always the dark side. */
  dark: string;
  /** Background and quiet-zone colour, `#rrggbb`. Always the light side. */
  light: string;
}

/** Degrees per barcode. At 80 barcodes/s that is a full wheel every ~7.5s. */
const HUE_STEP_DEG = 0.6;

/** Background hue leads the module hue, giving a duotone rather than a tint. */
const LIGHT_HUE_OFFSET_DEG = 40;

const DARK_S = 0.62;
const DARK_L = 0.18;
const LIGHT_S = 0.5;
const LIGHT_L = 0.93;

function channelHex(value: number): string {
  return Math.round(value * 255)
    .toString(16)
    .padStart(2, '0');
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb: [number, number, number];
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = l - c / 2;
  return `#${rgb.map((v) => channelHex(v + m)).join('')}`;
}

/** Deterministic in `index`, so re-rendering a stream produces identical frames. */
export function barcodeColors(index: number): QrColors {
  const hue = (index * HUE_STEP_DEG) % 360;
  return {
    dark: hslToHex(hue, DARK_S, DARK_L),
    light: hslToHex(hue + LIGHT_HUE_OFFSET_DEG, LIGHT_S, LIGHT_L),
  };
}
