// shutdown.ts — Graceful shutdown endpoint
//
// POST /api/shutdown — calls the main shutdown handler which kills
// ace-server child process, closes DB, and exits Node.js

import { Router } from 'express';
import { shutdown } from '../index.js';

const router = Router();

// POST /api/shutdown — terminate everything
router.post('/', (_req, res) => {
  console.log('[Server] Shutdown requested via API');
  res.json({ success: true, message: 'Shutting down...' });

  // Give the response time to flush, then trigger full shutdown
  setTimeout(() => {
    shutdown();
  }, 300);
});

export default router;
