import { randomUUID } from 'node:crypto';

import {
  DEFAULT_STREAM_CONFIG,
  EC_LEVELS,
  estimateStream,
  maxPayloadBytes,
  type CapabilitiesResponse,
  type StreamRecord,
} from '@opticast/protocol';
import { Router, type Request, type Response } from 'express';
import multer from 'multer';

import {
  MAX_UPLOAD_BYTES,
  ValidationError,
  parsePin,
  parseStreamConfig,
} from '../lib/config.js';
import { runEncodeJob } from '../lib/encoder.js';
import { getFfmpegPath } from '../lib/ffmpeg.js';
import type { StreamStore } from '../lib/store.js';

/** In memory, not spooled: the encoder needs the whole file at once anyway. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
});

/** One job at a time: rendering is CPU-bound in both the QR and ffmpeg halves. */
class JobQueue {
  private chain: Promise<void> = Promise.resolve();
  private depth = 0;

  get pending(): number {
    return this.depth;
  }

  enqueue(task: () => Promise<void>): void {
    this.depth++;
    this.chain = this.chain
      .then(task)
      .catch((error: unknown) => {
        // runEncodeJob records failures on the record itself; anything here is
        // a queue-plumbing bug and must not kill the chain.
        console.error('[queue] job threw unexpectedly:', error);
      })
      .finally(() => {
        this.depth--;
      });
  }
}

export function createStreamRoutes(store: StreamStore): Router {
  const router = Router();
  const queue = new JobQueue();

  router.get('/capabilities', async (_req: Request, res: Response) => {
    const payload: CapabilitiesResponse = {
      maxUploadBytes: MAX_UPLOAD_BYTES,
      defaults: DEFAULT_STREAM_CONFIG,
      maxPayloadBytes: Object.fromEntries(
        EC_LEVELS.map((ec) => [ec, maxPayloadBytes(ec)])
      ),
      ffmpegAvailable: (await getFfmpegPath()) !== null,
    };
    res.json(payload);
  });

  router.get('/streams', (_req: Request, res: Response) => {
    res.json({ streams: store.list() });
  });

  router.get('/streams/:id', (req, res) => {
    const record = store.get(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }
    res.json({ stream: record });
  });

  router.get('/streams/:id/metadata', (req, res) => {
    const record = store.get(req.params.id);
    if (!record?.metadata) {
      res.status(404).json({ error: 'Metadata is not available yet' });
      return;
    }
    res.json(record.metadata);
  });

  router.get('/streams/:id/video', (req, res) => {
    const record = store.get(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }
    if (record.status !== 'ready') {
      res.status(409).json({ error: `Stream is ${record.status}, not ready` });
      return;
    }
    // `sendFile` handles Range requests, which is what makes the video seekable.
    res.sendFile(store.videoPath(record.id), {
      // The default data directory is `.data`, and `send` refuses dot-prefixed
      // segments unless told otherwise.
      dotfiles: 'allow',
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `inline; filename="${encodeURIComponent(record.id)}.mp4"`,
      },
    });
  });

  router.post(
    '/streams',
    upload.single('file'),
    async (req: Request, res: Response) => {
      try {
        const file = req.file;
        if (!file) {
          res.status(400).json({ error: 'A file is required' });
          return;
        }
        if (file.size === 0) {
          res.status(400).json({ error: 'The uploaded file is empty' });
          return;
        }

        const config = parseStreamConfig(req.body ?? {});
        const pin = parsePin((req.body ?? {})['pin']);

        const now = new Date().toISOString();
        const estimate = estimateStream(file.size, config, pin !== null);

        const record: StreamRecord = {
          id: randomUUID(),
          status: 'queued',
          config,
          encrypted: pin !== null,
          createdAt: now,
          updatedAt: now,
          originalName: file.originalname || 'upload.bin',
          originalSize: file.size,
          mime: file.mimetype || 'application/octet-stream',
          progress: {
            stage: 'queued',
            ratio: 0,
            framesRendered: 0,
            framesTotal: estimate.totalVideoFrames,
          },
        };

        await store.put(record);

        queue.enqueue(() =>
          runEncodeJob(
            {
              record,
              data: file.buffer,
              pin,
              config,
              declaredMime: record.mime,
            },
            store
          )
        );

        res.status(202).json({ stream: record });
      } catch (error) {
        if (error instanceof ValidationError) {
          res.status(400).json({ error: error.message });
          return;
        }
        throw error;
      }
    }
  );

  router.delete('/streams/:id', async (req, res) => {
    const record = store.get(req.params.id);
    if (!record) {
      res.status(404).json({ error: 'Stream not found' });
      return;
    }
    if (record.status === 'encoding') {
      res.status(409).json({ error: 'Cannot delete a stream while it is encoding' });
      return;
    }
    await store.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
