export const theme = {
  bg: '#0f1115',
  panel: '#171a21',
  panel2: '#1e222b',
  border: '#2a2f3a',
  text: '#e6e8ee',
  muted: '#9aa1ae',
  accent: '#5b8cff',
  ok: '#3ecf8e',
  warn: '#e8b339',
  danger: '#f2637e',
  radius: 12,
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
