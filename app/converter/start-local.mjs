import {randomBytes} from 'node:crypto';
import {existsSync} from 'node:fs';
import {readFile,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createPreview} from './preview.mjs';

const converterDir = fileURLToPath(new URL('./', import.meta.url));
const venvUvicorn = path.join(converterDir, '.venv', 'bin', 'uvicorn');
const audiverisBin = process.env.AUDIVERIS_BIN || path.join(converterDir, '.local', 'audiveris', 'bin', 'Audiveris');
const musicxmlXsd = process.env.MUSICXML_XSD || path.join(converterDir, '.local', 'musicxml', 'schema', 'musicxml.xsd');
const tessdataDir = process.env.TESSDATA_PREFIX || path.join(converterDir, '.local', 'tessdata');
const scoreData = process.env.SCORE_DATA || path.join(converterDir, 'data');
const brewJavaHome = '/opt/homebrew/opt/openjdk@25/libexec/openjdk.jdk/Contents/Home';
const brewJavaAlt = '/opt/homebrew/opt/openjdk@25';
const envJavaHome = process.env.JAVA_HOME && existsSync(path.join(process.env.JAVA_HOME, 'bin', 'java')) ? process.env.JAVA_HOME : '';
const javaHome = existsSync(path.join(brewJavaHome, 'bin', 'java')) ? brewJavaHome : existsSync(path.join(brewJavaAlt, 'bin', 'java')) ? brewJavaAlt : envJavaHome;

for (const [label, target] of [
  ['Python uvicorn (.venv)', venvUvicorn],
  ['Audiveris binary', audiverisBin],
  ['MusicXML 4.0 XSD', musicxmlXsd],
  ['Tesseract tessdata', tessdataDir]
]) {
  if (!existsSync(target)) {
    console.error(`Missing ${label} at ${target}`);
    process.exit(1);
  }
}

const envPath = path.join(converterDir, '.env');
try {
  await writeFile(envPath, `CONVERTER_SECRET=${randomBytes(32).toString('hex')}\n`, {flag: 'wx', mode: 0o600});
} catch (err) {
  if (err.code !== 'EEXIST') throw err;
}

const envText = await readFile(envPath, 'utf8');
const secret = envText.match(/^CONVERTER_SECRET=(\S{32,})/m)?.[1];
if (!secret) {
  console.error('converter/.env must contain CONVERTER_SECRET with at least 32 characters.');
  process.exit(1);
}

const workerPort = Number(process.env.WORKER_PORT || 8080);
const previewPort = Number(process.env.PORT || 4173);
const workerUrl = `http://127.0.0.1:${workerPort}`;

const workerEnv = {
  ...process.env,
  CONVERTER_SECRET: secret,
  AUDIVERIS_BIN: audiverisBin,
  MUSICXML_XSD: musicxmlXsd,
  TESSDATA_PREFIX: tessdataDir,
  SCORE_DATA: scoreData,
  JAVA_TOOL_OPTIONS: process.env.JAVA_TOOL_OPTIONS || '-Xmx6g -Djava.awt.headless=true',
  PYTHONUNBUFFERED: '1',
  ...(javaHome ? {JAVA_HOME: javaHome, PATH: `${path.join(javaHome, 'bin')}:/opt/homebrew/bin:${process.env.PATH || ''}`} : {})
};

const worker = spawn(venvUvicorn, ['server:app', '--host', '127.0.0.1', '--port', String(workerPort), '--workers', '1', '--limit-concurrency', '16'], {
  cwd: converterDir,
  env: workerEnv,
  stdio: 'inherit'
});

let shuttingDown = false;
const cleanup = () => {
  if (shuttingDown) return;
  shuttingDown = true;
  if (!worker.killed) worker.kill('SIGTERM');
};
process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });
worker.on('exit', (code) => {
  if (!shuttingDown) {
    console.error(`Converter worker exited unexpectedly with code ${code}.`);
    process.exit(code || 1);
  }
});

for (let i = 0; i < 60; i++) {
  try {
    const res = await fetch(`${workerUrl}/health`, {headers: {Authorization: `Bearer ${secret}`}});
    if (res.ok) {
      const data = await res.json();
      if (data.ready) break;
    }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const server = createPreview({worker: workerUrl, secret});
server.listen(previewPort, process.env.HOST || '127.0.0.1', () => {
  console.log(`Score Converter preview (native local worker): http://localhost:${previewPort}/score-converter/`);
});
