/**
 * Regenerates every app icon, favicon and the splash lockup.
 *
 *   node tools/brand/build-icons.mjs
 *
 * The mark is a CRT tube showing QR finder patterns with a scan beam across
 * it — barcode + screen + scanning, which is the whole product in one glyph.
 * Colours track `packages/scanner/src/theme.ts`; change them in both places.
 *
 * The icons are generated, not drawn by hand, so this file is the source and
 * the PNGs are output. Rasterising goes through headless Chrome because the
 * machine has no SVG converter and this repo is already macOS/Xcode-bound.
 * `sips` (macOS) does the favicon downscales.
 *
 * After running this, the new icon and splash only reach a device through a
 * native rebuild — `yarn scanner:prebuild && yarn scanner:ios`. A Metro reload
 * cannot change an app icon.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url).pathname;
const IMAGES = join(ROOT, 'packages/scanner/assets/images');
const FONT = join(ROOT, 'packages/scanner/assets/fonts/PressStart2P-Regular.ttf');
const DASHBOARD_PUBLIC = join(ROOT, 'packages/dashboard/public');
const CHROME =
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const OUT = mkdtempSync(join(tmpdir(), 'opticast-brand-'));
mkdirSync(OUT, { recursive: true });

const C = {
  caseTop: '#4d3718',
  caseBottom: '#2a1c0b',
  // The page behind the case, a step darker so the chassis reads as an object.
  bgDeep: '#140d05',
  edge: '#7d5720',
  glass: '#070502',
  glassEdge: '#a8721f',
  amber: '#f2ad3e',
  hot: '#ffc85f',
  orange: '#dd7320',
};

const defs = `
  <radialGradient id="halo" cx="50%" cy="44%" r="58%">
    <stop offset="0" stop-color="#6b4512" stop-opacity="0.75"/>
    <stop offset="1" stop-color="#6b4512" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="case" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${C.caseTop}"/>
    <stop offset="1" stop-color="${C.caseBottom}"/>
  </linearGradient>
  <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0"    stop-color="${C.hot}" stop-opacity="0"/>
    <stop offset="0.5"  stop-color="${C.hot}" stop-opacity="1"/>
    <stop offset="1"    stop-color="${C.hot}" stop-opacity="0"/>
  </linearGradient>
  <radialGradient id="vignette" cx="50%" cy="50%" r="72%">
    <stop offset="0.45" stop-color="#000" stop-opacity="0"/>
    <stop offset="1"    stop-color="#000" stop-opacity="0.55"/>
  </radialGradient>`;

/** QR finder: a ring with a solid core, drawn so `size` is the outer edge. */
function finder(x, y, size = 148, stroke = 26) {
  const h = stroke / 2;
  const core = size * 0.35;
  const co = (size - core) / 2;
  return `
    <rect x="${x + h}" y="${y + h}" width="${size - stroke}" height="${size - stroke}"
          fill="none" stroke="${C.amber}" stroke-width="${stroke}"/>
    <rect x="${x + co}" y="${y + co}" width="${core}" height="${core}" fill="${C.amber}"/>`;
}

/** Loose data modules — the payload the finders bracket. */
function modules(x0, y0) {
  const cell = 40;
  const step = 52;
  const at = [
    [0, 0, 1],
    [2, 0, 0.55],
    [1, 1, 0.85],
    [0, 2, 0.5],
    [2, 2, 1],
  ];
  return at
    .map(
      ([cx, cy, o]) =>
        `<rect x="${x0 + cx * step}" y="${y0 + cy * step}" width="${cell}" height="${cell}" fill="${C.amber}" opacity="${o}"/>`,
    )
    .join('');
}

/**
 * The tube and everything on it. `bezel` adds the surrounding case; `tube`
 * scales the glass within it — at 40-60px an app icon has no pixels to spare
 * on a wide frame, so the icon runs a slim bezel and a bigger tube.
 */
function mark({ bezel = true, tube = 1 } = {}) {
  const inner = { x: 242, y: 242, w: 540 };
  const fs = 148;
  const right = inner.x + inner.w - fs;
  const bottom = inner.y + inner.w - fs;

  return `
  ${
    bezel
      ? `<rect x="118" y="118" width="788" height="788" rx="112"
             fill="url(#case)" stroke="${C.edge}" stroke-width="6"/>`
      : ''
  }
  <g transform="translate(512,512) scale(${tube}) translate(-512,-512)">
  <rect x="186" y="186" width="652" height="652" rx="66"
        fill="${C.glass}" stroke="${C.glassEdge}" stroke-width="5"/>

  <g style="filter: drop-shadow(0 0 20px rgba(242,173,62,0.55))">
    ${finder(inner.x, inner.y, fs)}
    ${finder(right, inner.y, fs)}
    ${finder(inner.x, bottom, fs)}
    ${modules(right - 8, bottom - 8)}

    <!-- The scan beam, in the gap the finders leave across the middle. -->
    <rect x="${inner.x}" y="498" width="${inner.w}" height="16" rx="8" fill="url(#beam)"/>
    <rect x="${inner.x}" y="486" width="${inner.w}" height="40" rx="20" fill="url(#beam)" opacity="0.28"/>
  </g>

  <rect x="186" y="186" width="652" height="652" rx="66" fill="url(#vignette)"/>
  </g>`;
}

function page({ width, height, body, background = 'transparent', extraCss = '' }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @font-face {
      font-family: 'PressStart2P';
      src: url('file://${FONT}') format('truetype');
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: ${width}px; height: ${height}px; background: ${background}; overflow: hidden; }
    ${extraCss}
  </style></head><body>${body}</body></html>`;
}

// ---- iOS / general app icon: full bleed, the system applies the mask ----
writeFileSync(
  `${OUT}/icon.html`,
  page({
    width: 1024,
    height: 1024,
    background: C.bgDeep,
    body: `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <defs>${defs}</defs>
      <rect width="1024" height="1024" fill="${C.bgDeep}"/>
      <rect width="1024" height="1024" fill="url(#halo)"/>
      ${mark({ tube: 1.12 })}
    </svg>`,
  }),
);

// ---- Android adaptive foreground: transparent, inside the 66% safe circle ----
writeFileSync(
  `${OUT}/adaptive.html`,
  page({
    width: 1024,
    height: 1024,
    body: `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
      <defs>${defs}</defs>
      <g transform="translate(512,512) scale(0.60) translate(-512,-512)">
        ${mark({ tube: 1.12 })}
      </g>
    </svg>`,
  }),
);

// ---- Favicons: no bezel, the tube alone survives 48px ----
const faviconSvg = `<svg width="512" height="512" viewBox="118 118 788 788" xmlns="http://www.w3.org/2000/svg">
  <defs>${defs}</defs>
  <rect x="118" y="118" width="788" height="788" rx="112" fill="url(#case)"/>
  ${mark({ bezel: false })}
</svg>`;
writeFileSync(
  `${OUT}/favicon.html`,
  page({ width: 512, height: 512, background: C.bgDeep, body: faviconSvg }),
);

// ---- Splash lockup: mark over the wordmark, transparent (app.json paints
//      the background), so it survives a theme change without a re-render ----
writeFileSync(
  `${OUT}/splash.html`,
  page({
    width: 800,
    height: 1040,
    extraCss: `
      body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 54px; }
      .word { font-family: 'PressStart2P'; font-size: 78px; letter-spacing: 6px; color: ${C.hot};
              text-shadow: 0 0 26px rgba(242,173,62,0.55); }
      .sub  { font-family: 'PressStart2P'; font-size: 23px; letter-spacing: 9px; color: ${C.orange}; }`,
    body: `
      <svg width="620" height="620" viewBox="118 118 788 788" xmlns="http://www.w3.org/2000/svg">
        <defs>${defs}</defs>
        ${mark()}
      </svg>
      <div class="word">OPTICAST</div>
      <div class="sub">OPTICAL TRANSPORT</div>`,
  }),
);

// ---- rasterise ----

/**
 * `--default-background-color=00000000` is what makes a transparent PNG. The
 * app icon must NOT use it: iOS rejects an icon carrying an alpha channel, so
 * icon.html paints its own opaque background and comes out rgb24.
 */
function shoot(html, png, width, height) {
  execFileSync(
    CHROME,
    [
      '--headless',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--default-background-color=00000000',
      `--screenshot=${join(OUT, png)}`,
      `--window-size=${width},${height}`,
      `file://${join(OUT, html)}`,
    ],
    { stdio: 'ignore' },
  );
}

shoot('icon.html', 'icon.png', 1024, 1024);
shoot('adaptive.html', 'adaptive.png', 1024, 1024);
shoot('favicon.html', 'favicon512.png', 512, 512);
shoot('splash.html', 'splash.png', 800, 1040);

const cp = (from, to) =>
  execFileSync('cp', [join(OUT, from), to], { stdio: 'ignore' });
const scale = (from, to, size) =>
  execFileSync(
    'sips',
    ['-z', String(size), String(size), join(OUT, from), '--out', to],
    { stdio: 'ignore' },
  );

cp('icon.png', join(IMAGES, 'icon.png'));
cp('adaptive.png', join(IMAGES, 'adaptive-icon.png'));
cp('splash.png', join(IMAGES, 'splash-icon.png'));
scale('favicon512.png', join(IMAGES, 'favicon.png'), 48);
scale('favicon512.png', join(DASHBOARD_PUBLIC, 'favicon.png'), 64);

console.log(`icons written to ${IMAGES} and ${DASHBOARD_PUBLIC}`);
