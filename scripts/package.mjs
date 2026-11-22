import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {Zip,ZipDeflate} from 'fflate';

const result=spawnSync(process.execPath,['scripts/rust.mjs','tauri','build','--no-bundle'],{stdio:'inherit',windowsHide:true});
if(result.status)process.exit(result.status);
const version=JSON.parse(fs.readFileSync('package.json')).version;
const folder=path.resolve('release',`snag-${version}-windows-x64`);fs.mkdirSync(folder,{recursive:true});
const executable=path.join(folder,'SNAG(beta).exe');
fs.copyFileSync('src-tauri/target/release/snag.exe',executable);
const legacy=path.join(folder,'snag.exe');
if(fs.existsSync(legacy))fs.unlinkSync(legacy);
if(process.platform==='win32'){
  const refresh=spawnSync('powershell.exe',['-NoProfile','-File',path.resolve('scripts/refresh-icons.ps1'),path.resolve('src-tauri/target/release/snag.exe'),executable],{stdio:'inherit',windowsHide:true});
  if(refresh.error)throw refresh.error;
  if(refresh.status)process.exit(refresh.status);
}
for(const name of ['engine','extension'])fs.cpSync(name,path.join(folder,name),{recursive:true});
for(const name of ['README.md','THIRD_PARTY.md'])fs.copyFileSync(name,path.join(folder,name));
const destination=path.resolve('release',`snag-${version}-windows-x64.zip`);
const output=fs.createWriteStream(destination);
const done=new Promise((resolve,reject)=>{output.on('finish',resolve);output.on('error',reject);});
const zip=new Zip((error,data,final)=>{if(error)output.destroy(error);else{output.write(data);if(final)output.end();}});
function add(dir,prefix){for(const item of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,item.name),name=`${prefix}/${item.name}`;if(item.isDirectory())add(file,name);else{const entry=new ZipDeflate(name,{level:3});zip.add(entry);entry.push(fs.readFileSync(file),true);}}}
add(folder,path.basename(folder));zip.end();await done;
console.log(`EXE: ${executable}\nPortable app: ${folder}\nZIP: ${destination} (${(fs.statSync(destination).size/1024/1024).toFixed(1)} MB)`);
