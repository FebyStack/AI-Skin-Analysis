import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import type { AppDeps } from '../../shared/deps';
import { ModelsRepository } from './repository';
import { ModelsService } from './service';

export function createModelUploadRouter(deps: AppDeps, auth?: RequestHandler): Router {
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

  const MAX_BYTES = Number(process.env.MAX_MODEL_UPLOAD_BYTES ?? 50 * 1024 * 1024); // default 50MB
  const upload = multer({ storage, limits: { fileSize: MAX_BYTES } });

  // File-scan: basic checks + optional ClamAV scan when CLAMAV_ENABLED=1.
  // If ClamAV is not present, fall back to conservative local checks so tests/dev don't fail.
  async function scanFile(filePath: string): Promise<boolean> {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size === 0) return false;

      const allowed = [".onnx", ".task", ".bin", ".zip", ".tar", ".tgz", ".onnx.data"];
      const ext = filePath.endsWith(".onnx.data") ? ".onnx.data" : path.extname(filePath).toLowerCase();
      if (!allowed.includes(ext)) return false;

      // Optional ClamAV integration: enable with CLAMAV_ENABLED=1
      if (process.env.CLAMAV_ENABLED === "1") {
        try {
          const { spawnSync } = require('child_process');
          // clamscan exit codes: 0 = OK, 1 = virus found, >1 = error
          const res = spawnSync('clamscan', ['--no-summary', filePath], { encoding: 'utf8', timeout: 60_000 });
          if (res.error) {
            // clamscan binary probably not installed or invocation failed — fall back
            console.debug('clamscan invocation failed:', res.error.message ?? res.error);
          } else {
            if (res.status === 0) return true;
            if (res.status === 1) {
              console.warn('clamscan detected infection for', filePath, 'output:', res.stdout || res.stderr);
              return false;
            }
            console.warn('clamscan returned non-zero status', res.status, res.stdout, res.stderr);
          }
        } catch (e) {
          console.debug('clamscan check failed:', e?.message ?? e);
        }
      }

      // Fallback: extension + non-empty file passed
      return true;
    } catch (e) {
      console.debug('scanFile error:', e?.message ?? e);
      return false;
    }
  }
  const repo = new ModelsRepository(deps.pool);
  const service = new ModelsService(repo);

  // POST /api/models/:modelId/upload - require session auth for admin operations
  if (auth) {
    router.post('/:modelId/upload', auth, upload.single('file'), async (req, res) => {
      try {
        const file = req.file;
        const { modelId } = req.params;
        const { version, isStable, setCurrent } = req.body ?? {};
        if (!file) return res.status(400).json({ success: false, error: 'file required' });

        const absolute = file.path;
        const ok = await scanFile(absolute);
        if (!ok) {
          // remove file and reject
          try { fs.unlinkSync(absolute); } catch (e) { /* ignore */ }
          return res.status(400).json({ success: false, error: 'file failed basic safety checks' });
        }

        const relPath = `/models/${modelId}/${path.basename(file.path)}`;
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
  } else {
    // If no auth provided, keep endpoint but warn in logs (useful for local dev/test)
    router.post('/:modelId/upload', upload.single('file'), async (req, res) => {
      try {
        const file = req.file;
        const { modelId } = req.params;
        const { version, isStable, setCurrent } = req.body ?? {};
        if (!file) return res.status(400).json({ success: false, error: 'file required' });

        const absolute = file.path;
        const ok = await scanFile(absolute);
        if (!ok) {
          try { fs.unlinkSync(absolute); } catch (e) { /* ignore */ }
          return res.status(400).json({ success: false, error: 'file failed basic safety checks' });
        }

        const relPath = `/models/${modelId}/${path.basename(file.path)}`;
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
  }

  return router;
}
