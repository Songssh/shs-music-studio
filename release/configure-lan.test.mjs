// Real Windows PowerShell/TLS regression tests; never touch an installed app.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import https from 'node:https';
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkReleaseLayout } from './check-layout.mjs';

const source = path.dirname(fileURLToPath(import.meta.url));
const windowsTest = (name, fn) => test(name, { skip: process.platform !== 'win32' }, fn);
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
const privateIP = Object.values(os.networkInterfaces()).flat().find(a => a.family === 'IPv4' && !a.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address))?.address;
const address = privateIP || '192.168.0.6';
const listen = (server, port = 0) => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(port, '0.0.0.0', () => resolve(server.address().port));
});
const close = server => new Promise(resolve => server.close(resolve));
async function freePort() { const server = net.createServer(); const port = await listen(server); await close(server); return port; }
function ps(file, args = [], cwd = source) {
  return spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args], {
    cwd, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  });
}
function successful(result) { assert.equal(result.status, 0, `${result.error || ''}\n${result.stdout}\n${result.stderr}`); }
async function fixture(t, overrides = {}) {
  const parent = path.resolve(source, '.layout-temp');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'lan-'));
  t.after(() => {
    // Only delete this newly created fixture under the known test workspace.
    assert.equal(path.dirname(path.resolve(root)), parent);
    assert.ok(path.basename(root).startsWith('lan-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const app = path.join(root, 'app with spaces 한글');
  const data = path.join(root, 'data 한글');
  const tlsDir = path.join(data, 'settings/tls');
  fs.mkdirSync(app); fs.mkdirSync(tlsDir, { recursive: true });
  fs.mkdirSync(path.join(data, 'library/auth-private'), { recursive: true });
  fs.writeFileSync(path.join(data, 'library/auth-private/fixture-only'), 'account data must survive');
  for (const name of ['Configure-LAN.bat', 'Configure-LAN.ps1', 'create-certificate.ps1']) fs.copyFileSync(path.join(source, name), path.join(app, name));
  const port = await freePort(); let enginePort = await freePort();
  while (enginePort === port) enginePort = await freePort();
  const config = { dataDir: path.relative(app, data), host: '127.0.0.1', url: `https://localhost:${port}`, port, enginePort,
    tls: 'self-signed', extra: { preserve: ['nested', 42] }, ...overrides };
  const configFile = path.join(app, 'portable.json');
  const original = JSON.stringify(config, null, 2) + '\n';
  fs.writeFileSync(configFile, original);
  fs.writeFileSync(path.join(tlsDir, 'server.pfx'), 'old private fixture');
  fs.writeFileSync(path.join(tlsDir, 'server.crt'), 'old public fixture');
  const run = (ip = address) => ps(path.join(app, 'Configure-LAN.ps1'), ['-Address', ip], root);
  const unchanged = () => {
    assert.equal(fs.readFileSync(configFile, 'utf8'), original);
    assert.equal(fs.readFileSync(path.join(tlsDir, 'server.pfx'), 'utf8'), 'old private fixture');
    assert.equal(fs.readFileSync(path.join(tlsDir, 'server.crt'), 'utf8'), 'old public fixture');
    assert.equal(fs.readFileSync(path.join(data, 'library/auth-private/fixture-only'), 'utf8'), 'account data must survive');
  };
  return { root, app, data, tlsDir, config, configFile, original, run, unchanged };
}

windowsTest('converts an existing installation, preserves data/settings, backs up TLS, and serves trusted HTTPS', async t => {
  const f = await fixture(t);
  const result = f.run(); successful(result);
  const updated = JSON.parse(fs.readFileSync(f.configFile));
  assert.deepEqual(updated, { ...f.config, url: `https://${address}:${f.config.port}`, host: '0.0.0.0' });
  assert.equal(fs.readFileSync(path.join(f.data, 'library/auth-private/fixture-only'), 'utf8'), 'account data must survive');
  const backups = fs.readdirSync(f.tlsDir).filter(n => n.startsWith('lan-backup-'));
  assert.equal(backups.length, 1);
  const backup = path.join(f.tlsDir, backups[0]);
  assert.equal(fs.readFileSync(path.join(backup, 'portable.json'), 'utf8'), f.original);
  assert.equal(fs.readFileSync(path.join(backup, 'server.pfx'), 'utf8'), 'old private fixture');
  const ca = fs.readFileSync(path.join(f.tlsDir, 'server.crt'));
  const certificate = new X509Certificate(ca);
  assert.equal(certificate.checkIP(address), address);
  assert.equal(certificate.checkHost('localhost'), undefined);
  const server = https.createServer({ pfx: fs.readFileSync(path.join(f.tlsDir, 'server.pfx')), passphrase: '' }, (_req, res) => res.end('LAN HTTPS works'));
  await listen(server, updated.port);
  try {
    const body = await new Promise((resolve, reject) => {
      const request = https.get({ hostname: privateIP || '127.0.0.1', port: updated.port, ca,
        checkServerIdentity: (_name, cert) => tls.checkServerIdentity(address, cert) }, res => {
        let body = ''; res.on('data', chunk => body += chunk); res.on('end', () => resolve(body));
      });
      request.once('error', reject); request.setTimeout(5000, () => request.destroy(Error('TLS timeout')));
    });
    assert.equal(body, 'LAN HTTPS works');
  } finally { await close(server); }
  assert.match(result.stdout, /-Profile Private -RemoteAddress LocalSubnet/);
  assert.match(result.stdout, /-Program '/);
  // Reconfiguration must back up again and change the certificate identity.
  successful(f.run('192.168.0.6'));
  assert.equal(fs.readdirSync(f.tlsDir).filter(n => n.startsWith('lan-backup-')).length, 2);
  assert.equal(new X509Certificate(fs.readFileSync(path.join(f.tlsDir, 'server.crt'))).checkIP('192.168.0.6'), '192.168.0.6');
});

windowsTest('rejects loopback, wildcard, public, and URL-shaped input without modifying files', async t => {
  const f = await fixture(t);
  for (const invalid of ['127.0.0.1', '0.0.0.0', '8.8.8.8', 'https://192.168.0.6:3443', '192.168.0.999']) {
    assert.notEqual(f.run(invalid).status, 0, invalid); f.unchanged();
  }
  assert.equal(fs.readdirSync(f.tlsDir).length, 2);
});

windowsTest('the batch launcher works from another directory with absolute data paths', async t => {
  const f = await fixture(t);
  fs.writeFileSync(f.configFile, JSON.stringify({ ...f.config, dataDir: f.data }));
  const command = `""${path.join(f.app, 'Configure-LAN.bat')}" -Address ${address}"`;
  const result = spawnSync(process.env.ComSpec || path.join(process.env.SystemRoot, 'System32/cmd.exe'), ['/d', '/s', '/c', command], {
    cwd: f.root, input: '\r\n', encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 30_000,
  });
  successful(result);
  const updated = JSON.parse(fs.readFileSync(f.configFile));
  assert.equal(updated.dataDir, f.data);
  assert.equal(updated.url, `https://${address}:${f.config.port}`);
  assert.equal(updated.host, '0.0.0.0');
});

windowsTest('refuses existing PEM and proxy setups without changing their configuration', async t => {
  for (const mode of ['pem', 'proxy']) {
    const f = await fixture(t, { tls: mode });
    const result = f.run(); assert.notEqual(result.status, 0);
    assert.match(result.stderr, /self-signed TLS mode only/); f.unchanged();
  }
});

windowsTest('refuses a running server or engine and releases its temporary listeners', async t => {
  for (const field of ['port', 'enginePort']) {
    const f = await fixture(t);
    const server = net.createServer(); await listen(server, f.config[field]);
    try {
      const result = f.run(); assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Stop SHS Music Studio/); f.unchanged();
    } finally { await close(server); }
    const probe = net.createServer(); await listen(probe, f.config.port); await close(probe);
  }
});

windowsTest('certificate-generation failure leaves old files intact', async t => {
  const f = await fixture(t);
  fs.writeFileSync(path.join(f.app, 'create-certificate.ps1'), "param($Directory, $DnsName)\nthrow 'Simulated certificate failure'\n");
  const result = f.run(); assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Simulated certificate failure/); f.unchanged();
});

windowsTest('rolls TLS back when Windows prevents atomic configuration replacement', async t => {
  const f = await fixture(t);
  // Hold a read lock after real certificate generation. Reads/backups are allowed,
  // but Windows must deny File.Replace; this exercises the actual rollback path.
  fs.appendFileSync(path.join(f.app, 'create-certificate.ps1'), "\n$global:fixtureLock = [IO.File]::Open((Join-Path $PSScriptRoot 'portable.json'), [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)\n");
  const result = f.run(); assert.notEqual(result.status, 0); f.unchanged();
  assert.doesNotMatch(result.stderr, /Automatic rollback failed/);
  assert.equal(fs.readdirSync(f.app).filter(n => n.endsWith('.tmp')).length, 0);
});

test('release assemblers include the LAN helper and preserve the existing layout', () => {
  assert.deepEqual(checkReleaseLayout(path.dirname(source)), []);
});
