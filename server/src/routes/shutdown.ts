// shutdown.ts — Graceful shutdown endpoint
//
// POST /api/shutdown — kills ALL processes on our ports (Node, Vite, ace-server)
// Uses port-based taskkill on Windows, like HOT-Step 9000.

import { Router } from 'express';
import { execSync } from 'child_process';

const router = Router();

/** Kill all processes listening on a given port (Windows) */
function killPort(port: number): void {
  try {
    // Find PIDs listening on this port
    const output = execSync(
      `netstat -ano | findstr ":${port}" | findstr "LISTENING"`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const pids = new Set<string>();
    for (const line of output.split('\n')) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        pids.add(pid);
      }
    }

    for (const pid of pids) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' });
        console.log(`[Shutdown] Killed PID ${pid} (port ${port})`);
      } catch {
        // Process may already be dead
      }
    }
  } catch {
    // No process found on this port — that's fine
  }
}

// POST /api/shutdown — terminate everything
router.post('/', (_req, res) => {
  console.log('[Server] Shutdown requested via API');
  res.json({ success: true, message: 'Shutting down...' });

  // Give the response time to flush, then kill everything by port
  setTimeout(() => {
    console.log('[Server] Killing all processes...');

    if (process.platform === 'win32') {
      // Kill ace-server (8085), Vite dev server (3000), then ourselves (3001)
      killPort(8085);
      killPort(3000);
      killPort(3001);  // This kills us — should be last
    } else {
      // On Linux/Mac, just exit and let the process manager handle it
      process.exit(0);
    }
  }, 300);
});

export default router;
