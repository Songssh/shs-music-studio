// Development checkout only. Validate all data destinations before importing the server.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = path.resolve(root, '../auth-environment/runtime');
const require = createRequire(path.join(root, 'server/package.json'));
const env = require('dotenv').parse(fs.readFileSync(path.join(root, '.env')));
const expected = {
  DATA_DIR: path.join(runtime, 'library'), ACESTEPCPP_EXE: path.join(runtime, 'engine/ace-server.exe'),
  ACESTEPCPP_MODELS: path.join(runtime, 'models'), ACESTEPCPP_ADAPTERS: path.join(runtime, 'adapters'),
};
if (process.env.HOT_STEP_ROOT || process.env.HOT_STEP_DATA_ROOT) throw Error('Use a development shell without HOT_STEP_ROOT / HOT_STEP_DATA_ROOT.');
for (const [key, value] of Object.entries(expected)) {
  if (!env[key] || path.resolve(env[key]).toLowerCase() !== value.toLowerCase()) throw Error(`Unsafe development ${key}; expected ${value}`);
}
for (const [key, value] of Object.entries({ SERVER_PORT:'4301', SERVER_HOST:'127.0.0.1', ACESTEPCPP_PORT:'18085', ACESTEPCPP_HOST:'127.0.0.1', HOT_STEP_AUTH_URL:'http://127.0.0.1:4301' })) {
  if (env[key] !== value) throw Error(`Unexpected development ${key}`);
}
Object.assign(process.env, env);
const { locateData } = await import('../../server/src/dataroot/locate.ts');
const data = locateData();
if (data.pendingMove || data.pointerError || data.root || path.resolve(data.children.library).toLowerCase() !== expected.DATA_DIR.toLowerCase()) {
  throw Error('Development data pointer changed; review it before starting this isolated launcher.');
}
// Do not start a second engine or leave a Node process alive after EADDRINUSE.
for (const port of [4301, 18085]) await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', () => reject(Error(`Development port ${port} is already in use.`)));
  probe.listen(port, '127.0.0.1', () => probe.close(resolve));
});
const stopFile = path.join(runtime, 'workspace-stop.request');
if (fs.existsSync(stopFile)) fs.unlinkSync(stopFile);
process.chdir(path.join(root, 'server'));
await import('../../server/src/index.ts');
// Local launcher control only; reuse the server's normal graceful shutdown.
const timer = setInterval(() => {
  if (!fs.existsSync(stopFile)) return;
  fs.unlinkSync(stopFile); clearInterval(timer); process.emit('SIGINT');
}, 500);
timer.unref();
