/*
 * Amber CRT, TVA issue.
 *
 * Same phosphor as the dashboard, but the chassis around it is 1970s
 * institutional rather than a bare terminal: espresso-brown case plastic,
 * ochre silk-screening, burnt-orange keys, and parchment for the few things
 * that have to shout. Depth is the chunky 3D bevel a 1-bit machine drew with
 * a light edge up-left and a dark edge down-right — it survives the move to a
 * dark case because the light source never moved.
 *
 * Nothing here is soft: hard edges, flat fills, and glow only where a
 * phosphor would actually bloom.
 */
export const theme = {
  /** Case plastic. */
  case: '#1d1408',
  /** Bevel highlight — the edge facing the light, up and to the left. */
  caseLight: '#5a4019',
  /** Bevel shadow — the edge turned away, down and to the right. */
  caseDark: '#070402',
  /** Silk-screened outline: window rules, title-bar stripes. */
  caseEdge: '#7d5720',
  /** Window bodies and list rows — one step up from the case. */
  panel: '#271b0b',
  /** A plate raised onto the glass, where the case itself would vanish. */
  plate: '#3a2810',
  /** Recessed surface: inputs, meter tracks, wells. */
  well: '#0d0904',

  /** Primary amber phosphor. */
  ink: '#f2ad3e',
  /** Dimmed amber, for secondary lines. */
  inkSoft: '#bd873c',
  /** Parchment — case-file cream, the highest-contrast ink available. */
  cream: '#efdfb7',

  /** CRT glass behind the camera and file previews. */
  screen: '#080602',
  /** Text drawn on the glass. */
  phosphor: '#ffc85f',
  /** The working indicator, bright enough to read against live video. */
  signal: '#f0a72c',

  /** Burnt orange — the colour an action key is moulded in. */
  accent: '#dd7320',
  ok: '#9bb443',
  warn: '#e2a92f',
  danger: '#d24a28',
  /** Power lamp. */
  led: '#ffb42e',
} as const;

/**
 * Loaded by `useFonts` in App.tsx under exactly these keys.
 *
 * React Native cannot synthesise weights for a custom family — `fontWeight`
 * is ignored once `fontFamily` names a bundled file — so weight is picked by
 * naming the file, and every bold thing in the app points at `bodyBold`.
 */
export const fonts = {
  display: 'PressStart2P',
  body: 'IBMPlexMono',
  bodySemi: 'IBMPlexMono-SemiBold',
  bodyBold: 'IBMPlexMono-Bold',
} as const;

/** Phosphor bloom. What makes the thin body face read as bold on glass. */
export const glow = {
  textShadowColor: 'rgba(242,173,62,0.5)',
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 7,
} as const;

/** Raised: lit from the top-left, like a key sitting proud of the case. */
export const raised = {
  borderWidth: 2,
  borderTopColor: theme.caseLight,
  borderLeftColor: theme.caseLight,
  borderBottomColor: theme.caseDark,
  borderRightColor: theme.caseDark,
} as const;

/** Sunken: the same light source, so the bevel flips — a hole in the case. */
export const sunken = {
  borderWidth: 2,
  borderTopColor: theme.caseDark,
  borderLeftColor: theme.caseDark,
  borderBottomColor: theme.caseLight,
  borderRightColor: theme.caseLight,
} as const;

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.round(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return minutes > 0 ? `${minutes}m ${String(secs).padStart(2, '0')}s` : `${secs}s`;
}
