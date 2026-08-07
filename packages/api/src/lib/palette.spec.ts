import { describe, expect, it } from 'vitest';

import { barcodeColors } from './palette.js';

/**
 * Every hue the drift can produce must binarize cleanly. HSL lightness is not
 * luminance, so this sweeps the whole wheel and checks the *worst* case under
 * both weightings in the pipeline: Rec.709 (jsQR) and Rec.601 (camera YUV).
 * Black-on-white scores 255; the floors below keep two thirds of that.
 */

function parseHex(hex: string): [number, number, number] {
  expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

const gray709 = ([r, g, b]: [number, number, number]) =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;
const gray601 = ([r, g, b]: [number, number, number]) =>
  0.299 * r + 0.587 * g + 0.114 * b;

// 600 indices at 0.6°/step is one full lap of the hue wheel.
const FULL_CYCLE = 600;

describe('barcode palette', () => {
  it('keeps a decodable grayscale gap at every hue, under both weightings', () => {
    for (let index = 0; index < FULL_CYCLE; index++) {
      const { dark, light } = barcodeColors(index);
      const darkRgb = parseHex(dark);
      const lightRgb = parseHex(light);

      for (const gray of [gray709, gray601]) {
        const d = gray(darkRgb);
        const l = gray(lightRgb);
        // Dark-on-light, always: MLKit will not decode an inverted symbol.
        expect(l).toBeGreaterThan(d);
        expect(l - d).toBeGreaterThanOrEqual(160);
        // Absolute bounds, so a global threshold has room on both sides.
        expect(d).toBeLessThanOrEqual(90);
        expect(l).toBeGreaterThanOrEqual(215);
      }
    }
  });

  it('is deterministic and periodic in the index', () => {
    expect(barcodeColors(7)).toEqual(barcodeColors(7));
    expect(barcodeColors(0)).toEqual(barcodeColors(FULL_CYCLE));
  });
});
