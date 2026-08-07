import cors from 'cors';
import express, {
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import multer from 'multer';

import { DATA_DIR, HOST, MAX_UPLOAD_BYTES, PORT } from './lib/config.js';
import { getFfmpegPath, getFfprobePath } from './lib/ffmpeg.js';
import { StreamStore } from './lib/store.js';
import { createStreamRoutes } from './routes/streams.js';

async function main(): Promise<void> {
  const store = new StreamStore(DATA_DIR);
  await store.init();

  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.use('/api', createStreamRoutes(store));

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
      if (error instanceof multer.MulterError) {
        const message =
          error.code === 'LIMIT_FILE_SIZE'
            ? `File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`
            : error.message;
        res.status(400).json({ error: message });
        return;
      }
      console.error('[api] unhandled error:', error);
      res.status(500).json({
        error: 'Internal server error',
        details: error instanceof Error ? error.message : undefined,
      });
    }
  );

  const [ffmpeg, ffprobe] = await Promise.all([getFfmpegPath(), getFfprobePath()]);

  app.listen(PORT, HOST, () => {
    console.log(`[ ready ] http://${HOST}:${PORT}`);
    console.log(`[ data  ] ${DATA_DIR}`);
    console.log(`[ ffmpeg] ${ffmpeg ?? 'NOT FOUND — encoding will fail'}`);
    console.log(`[ffprobe] ${ffprobe ?? 'not found — media probing disabled'}`);
  });
}

main().catch((error: unknown) => {
  console.error('[api] failed to start:', error);
  process.exitCode = 1;
});
