import QRCode from 'qrcode';
import type { EcLevel } from '@opticast/protocol';

import type { QrColors } from './palette.js';

export interface QrPlan {
  /** QR version (1-40) forced on every frame of the stream. */
  version: number;
  /** Modules per side for that version, excluding the quiet zone. */
  modules: number;
  /** Modules per side including the quiet zone on both sides. */
  modulesWithMargin: number;
  ec: EcLevel;
  margin: number;
}

function versionFor(text: string, ec: EcLevel): number {
  return QRCode.create(text, { errorCorrectionLevel: ec }).version;
}

/**
 * One QR version big enough for every frame: `image2pipe` needs a constant
 * input size, and the metadata frame is a different length from the data ones.
 * Only three candidates matter — metadata, a full data frame, and the last one.
 */
export function planQr(
  metadataFrame: string,
  dataFrames: string[],
  ec: EcLevel,
  margin: number
): QrPlan {
  const candidates = [metadataFrame];
  if (dataFrames.length > 0) {
    candidates.push(dataFrames[0]);
    candidates.push(dataFrames[dataFrames.length - 1]);
  }

  let version = 1;
  for (const candidate of candidates) {
    version = Math.max(version, versionFor(candidate, ec));
  }

  const modules = version * 4 + 17;
  return {
    version,
    modules,
    modulesWithMargin: modules + margin * 2,
    ec,
    margin,
  };
}

/** One pixel per module; ffmpeg does the upscale with nearest-neighbour. */
export function renderQrPng(
  text: string,
  plan: QrPlan,
  colors?: QrColors
): Promise<Buffer> {
  return QRCode.toBuffer(text, {
    type: 'png',
    errorCorrectionLevel: plan.ec,
    version: plan.version,
    margin: plan.margin,
    scale: 1,
    color: {
      dark: `${colors?.dark ?? '#000000'}ff`,
      light: `${colors?.light ?? '#ffffff'}ff`,
    },
  });
}

export interface ScalePlan {
  /** Side length ffmpeg scales the tiled grid up to, an exact module multiple. */
  scaledSide: number;
  /** Final video side length, always even for yuv420p. */
  outputSide: number;
  /** Integer pixels per QR module in the output. */
  moduleSize: number;
  /** Barcodes per side of the grid. 1 is a single centred code. */
  tile: number;
  /** Output pixels across one barcode, including its quiet zone. */
  codeSide: number;
}

/**
 * Blows the tiny PNGs up to the requested video size. The scale factor is
 * floored to an integer so every module lands on a whole pixel — a fractional
 * factor smears module edges and is what makes a barcode unreadable. The
 * leftover becomes a white border via `pad`.
 *
 * Under tiling the grid is scaled as a unit, so adjacent codes are separated by
 * `margin * 2` modules — which is why `margin` must stay at 2 or above.
 */
export function planScale(
  plan: QrPlan,
  requestedWidth: number,
  tile = 1
): ScalePlan {
  const outputSide = requestedWidth % 2 === 0 ? requestedWidth : requestedWidth - 1;
  const gridModules = plan.modulesWithMargin * tile;
  const moduleSize = Math.max(1, Math.floor(outputSide / gridModules));
  return {
    moduleSize,
    scaledSide: moduleSize * gridModules,
    outputSide,
    tile,
    codeSide: moduleSize * plan.modulesWithMargin,
  };
}
