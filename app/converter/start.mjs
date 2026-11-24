import {randomBytes} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const cwd=fileURLToPath(new URL('./',import.meta.url));
const docker=spawnSync('docker',['compose','version'],{encoding:'utf8'});
if(docker.error||docker.status!==0){console.error('PDF conversion requires Docker Desktop with Docker Compose. Install and start it, then run npm run converter:start again.');process.exit(1)}
const envFile=new URL('.env',import.meta.url);
try {await writeFile(envFile,`CONVERTER_SECRET=${randomBytes(32).toString('hex')}\n`,{flag:'wx',mode:0o600})}catch(error){if(error.code!=='EEXIST')throw error}
const env=await readFile(envFile,'utf8');
if(!/^CONVERTER_SECRET=\S{32,}$/m.test(env)){console.error('converter/.env must contain CONVERTER_SECRET with at least 32 characters.');process.exit(1)}
const result=spawnSync('docker',['compose','up','--build','--detach','--wait','--wait-timeout','180'],{cwd,stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
console.log('PDF conversion is ready: http://localhost:4173/score-converter/');
