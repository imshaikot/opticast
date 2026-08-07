import type {
  CapabilitiesResponse,
  CreateStreamResponse,
  ListStreamsResponse,
  StreamConfig,
  StreamRecord,
} from '@opticast/protocol';

/** Relative, so Vite proxies it in dev and `<video src>` stays same-origin. */
const BASE = '/api';

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `Request failed with ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // Non-JSON error body; the status line is all we have.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function fetchCapabilities(): Promise<CapabilitiesResponse> {
  return fetch(`${BASE}/capabilities`).then(unwrap<CapabilitiesResponse>);
}

export function fetchStreams(): Promise<StreamRecord[]> {
  return fetch(`${BASE}/streams`)
    .then(unwrap<ListStreamsResponse>)
    .then((body) => body.streams);
}

export interface CreateStreamInput {
  file: File;
  pin: string;
  config: StreamConfig;
}

export function createStream(input: CreateStreamInput): Promise<StreamRecord> {
  const form = new FormData();
  form.append('file', input.file);
  if (input.pin) form.append('pin', input.pin);
  for (const [key, value] of Object.entries(input.config)) {
    form.append(key, String(value));
  }
  return fetch(`${BASE}/streams`, { method: 'POST', body: form })
    .then(unwrap<CreateStreamResponse>)
    .then((body) => body.stream);
}

export async function deleteStream(id: string): Promise<void> {
  const response = await fetch(`${BASE}/streams/${id}`, { method: 'DELETE' });
  if (!response.ok && response.status !== 204) {
    await unwrap(response);
  }
}

export function videoUrl(id: string): string {
  return `${BASE}/streams/${id}/video`;
}
