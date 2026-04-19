// config.ts — Environment-based configuration for HOT-Step CPP server
import { config as dotenvConfig } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Project root is two levels up from server/src/
const PROJECT_ROOT = path.resolve(__dirname, '../..');

// Load .env from project root (optional — smart defaults work without it)
dotenvConfig({ path: path.join(PROJECT_ROOT, '.env') });

// Smart defaults: resolve paths relative to project root so users can
// build the engine and drop models in place without editing any config.
const DEFAULT_EXE = path.join(PROJECT_ROOT, 'engine', 'build', 'Release', 'ace-server.exe');
const DEFAULT_MODELS = path.join(PROJECT_ROOT, 'models');
const DEFAULT_ADAPTERS = path.join(PROJECT_ROOT, 'adapters');

export const config = {
  // ace-server configuration
  aceServer: {
    exe: process.env.ACESTEPCPP_EXE || DEFAULT_EXE,
    models: process.env.ACESTEPCPP_MODELS || DEFAULT_MODELS,
    adapters: process.env.ACESTEPCPP_ADAPTERS || DEFAULT_ADAPTERS,
    port: parseInt(process.env.ACESTEPCPP_PORT || '8085', 10),
    host: process.env.ACESTEPCPP_HOST || '127.0.0.1',
    get url() {
      return `http://${this.host}:${this.port}`;
    },
  },

  // Node.js server
  server: {
    port: parseInt(process.env.SERVER_PORT || '3001', 10),
    host: process.env.SERVER_HOST || '0.0.0.0',
  },

  // Data paths
  data: {
    dir: path.resolve(__dirname, '..', process.env.DATA_DIR || './data'),
    get dbPath() {
      return path.join(this.dir, 'hotstep.db');
    },
    get audioDir() {
      return path.join(this.dir, 'audio');
    },
  },
};
