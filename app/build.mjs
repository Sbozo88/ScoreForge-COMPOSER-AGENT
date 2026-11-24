import {mkdir,cp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {page,agents,toolsData} from './pages.mjs';
import {wavBytes} from './public/music.js';

const appDir = import.meta.dirname;
const distDir = path.resolve(appDir, 'dist');
const publicDir = path.resolve(appDir, 'public');
const functionsSiteDir = path.resolve(appDir, 'functions/site');

await rm(distDir, {recursive: true, force: true});
await mkdir(distDir, {recursive: true});
await cp(publicDir, distDir, {recursive: true});

for (const route of ['', 'agents', 'tools', 'academy', 'plans', 'workspace', 'account', 'faq', 'contact', 'score-converter']) {
  const dir = path.join(distDir, route);
  await mkdir(dir, {recursive: true});
  await writeFile(path.join(dir, 'index.html'), page(route));
}

await writeFile(path.join(distDir, 'data.js'), `export const agents=${JSON.stringify(agents)};export const toolsData=${JSON.stringify(toolsData)};`);
await writeFile(path.join(distDir, 'examples/pulse-demo.wav'), new Uint8Array(wavBytes([Float32Array.from({length:44100},(_,i)=>Math.sin(i*2*Math.PI*440/44100)*0.2)], 44100)));

console.log('Built Score Forge Composer Agent: 10 static routes.');
await rm(functionsSiteDir, {recursive: true, force: true});
await cp(distDir, functionsSiteDir, {recursive: true});
