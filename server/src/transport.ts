import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import type { Express } from 'express';

/** HTTPS cookies require TLS or an explicitly configured loopback reverse proxy. */
export function serverTransport(env: NodeJS.ProcessEnv, host: string) {
  const pfx = env.HOT_STEP_TLS_PFX, cert = env.HOT_STEP_TLS_CERT, key = env.HOT_STEP_TLS_KEY;
  if (pfx && (cert || key)) throw new Error('Choose TLS PFX or PEM, not both');
  if (!!cert !== !!key) throw new Error('TLS requires both certificate and key');
  if (pfx || cert) {
    const options = pfx ? { pfx: fs.readFileSync(pfx), passphrase: env.HOT_STEP_TLS_PASSPHRASE || '' }
      : { cert: fs.readFileSync(cert!), key: fs.readFileSync(key!) };
    return (app: Express) => https.createServer({ ...options, minVersion: 'TLSv1.2' }, app);
  }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(host);
  if (!local || (env.HOT_STEP_REVERSE_PROXY !== '1' && env.HOT_STEP_AUTH_HTTP_LOOPBACK !== '1')) {
    throw new Error('Configure HTTPS certificates or an explicit loopback reverse proxy before starting the server');
  }
  return (app: Express) => http.createServer(app);
}
