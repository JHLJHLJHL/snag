import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const env={...process.env};
const originalPath=process.env.Path||process.env.PATH||'';
for(const key of Object.keys(env)) if(key.toLowerCase()==='path') delete env[key];
const cargoBin=path.join(os.homedir(),'.cargo','bin');env.PATH=cargoBin+path.delimiter+originalPath;
const portable=env.STREAMDROP_MSVC||path.join(os.tmpdir(),'streamdrop-tools','msvc');
if(process.platform==='win32'&&fs.existsSync(portable)) {
  const tools=path.join(portable,'VC','Tools','MSVC');const version=fs.readdirSync(tools).sort().at(-1);
  const sdk=path.join(portable,'Windows Kits','10');const sdkVersion=fs.readdirSync(path.join(sdk,'Lib')).sort().at(-1);
  env.PATH=[path.join(tools,version,'bin','Hostx64','x64'),path.join(sdk,'bin',sdkVersion,'x64'),env.PATH].join(path.delimiter);
  env.LIB=[path.join(tools,version,'lib','x64'),path.join(sdk,'Lib',sdkVersion,'um','x64'),path.join(sdk,'Lib',sdkVersion,'ucrt','x64')].join(';');
  env.INCLUDE=[path.join(tools,version,'include'),...['ucrt','shared','um','winrt'].map(p=>path.join(sdk,'Include',sdkVersion,p))].join(';');
}
// Retain certificate validation while allowing offline Windows revocation servers.
env.CARGO_HTTP_CHECK_REVOKE??='false';
const args=process.argv.slice(2);
let binary='cargo';
if(args[0]==='tauri') {binary=process.execPath;args.splice(0,1,path.resolve('node_modules/@tauri-apps/cli/tauri.js'));}
else args.splice(1,0,'--manifest-path','src-tauri/Cargo.toml');
const child=spawn(binary,args,{env,stdio:'inherit',windowsHide:true});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
