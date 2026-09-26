import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(import.meta.dirname, '..');
const sonataDirectory = resolve(root, 'sonata');
process.loadEnvFile(resolve(root, '.env'));

const host = process.env.SONATA_HOST || '127.0.0.1';
const port = Number(process.env.SONATA_PORT || 2333);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('SONATA_PORT must be a valid TCP port.');
}

function portOpen() {
  return new Promise((resolveResult) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveResult(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1000, () => finish(false));
  });
}

function runNode(args, cwd) {
  return spawn(process.execPath, args, { cwd, stdio: 'inherit' });
}

async function patchSonata() {
  const patch = runNode(['./fix-package-imports.mjs'], sonataDirectory);
  const exitCode = await new Promise((resolveResult, reject) => {
    patch.once('error', reject);
    patch.once('exit', (code) => resolveResult(code));
  });
  if (exitCode !== 0) throw new Error('Sonata compatibility patch failed.');
}

let sonata;
let bot;
let stopping = false;

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  bot?.kill();
  sonata?.kill();
  process.exitCode = code;
}

process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());

if (!(await portOpen())) {
  await patchSonata();
  sonata = runNode([
    '--env-file=../.env',
    'node_modules/@sonata-sdk/server/bin/sonata.js',
    './config.js'
  ], sonataDirectory);
  sonata.once('error', (error) => {
    console.error('Sonata could not start:', error.message);
    shutdown(1);
  });
  const deadline = Date.now() + 15000;
  while (!(await portOpen())) {
    if (sonata.exitCode !== null || Date.now() >= deadline) {
      shutdown(1);
      throw new Error('Sonata did not become ready on its configured port.');
    }
    await delay(250);
  }
} else {
  console.log(`Sonata already listening on ${host}:${port}`);
}

bot = runNode(['--import', 'tsx', '--watch-path=src', 'src/index.ts'], root);
bot.once('error', (error) => {
  console.error('StudyHub could not start:', error.message);
  shutdown(1);
});
bot.once('exit', (code) => shutdown(code ?? 1));
sonata?.once('exit', (code) => {
  if (!stopping) {
    console.error(`Sonata stopped unexpectedly (exit code ${code ?? 'unknown'}).`);
    shutdown(1);
  }
});
