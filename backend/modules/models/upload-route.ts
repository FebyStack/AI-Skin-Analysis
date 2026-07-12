import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Router } from 'express';
import type { AppDeps } from '../../shared/deps';
import { ModelsRepository } from './repository';
import { ModelsService } from './service';

export function createModelUploadRouter(deps: AppDeps): Router {
  const router = Router();
  if (!deps.pool) {
    router.use((_req, res) => res.status(503).json({ success: false, error: 'Model registry unavailable (no DB)' }));
    return router;
  }

  const uploadDir = path.resolve(process.cwd(), 'backend/public/models');
  fs.mkdirSync(uploadDir, { recursive: true });

  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const modelId = req.params.modelId || req.body.modelId || 'unclassified';
      const modelDir = path.join(uploadDir, modelId);
      fs.mkdirSync(modelDir, { recursive: true });
      cb(null, modelDir);
    },
    filename: (req, file, cb) => {
      const v = req.body.version || Date.now().toString();
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${v}-${safe}`);
    },
  });

  const upload = multer({ storage });
  const repo = new ModelsRepository(deps.pool);
  const service = new ModelsService(repo);

  // POST /api/models/:modelId/upload
  router.post('/:modelId/upload', upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      const { modelId } = req.params;
      const { version, isStable, setCurrent } = req.body ?? {};
      if (!file) return res.status(400).json({ success: false, error: 'file required' });

      const relPath = `/models/${modelId}/${path.basename(file.path)}`;
      const absolute = file.path;
      const buffer = fs.readFileSync(absolute);
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
      const versionId = crypto.randomUUID();

      const added = await repo.addVersion({
        id: versionId,
        model_id: modelId,
        version: version || file.filename || String(Date.now()),
        file_path: relPath,
        file_size: file.size,
        checksum,
        is_stable: Boolean(isStable),
        is_current: Boolean(setCurrent),
      });

      if (setCurrent) {
        await repo.promoteVersion(modelId, versionId);
      }

      res.status(201).json({ success: true, data: added });
    } catch (err) {
      console.error('Model upload failed:', err);
      res.status(500).json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
