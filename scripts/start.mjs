import {spawn,spawnSync} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
const release=path.resolve('src-tauri/target/release/snag.exe'),debug=path.resolve('src-tauri/target/debug/snag.exe');
if(!fs.existsSync(release)&&!fs.existsSync(debug)) {
  const result=spawnSync(process.execPath,['scripts/rust.mjs','tauri','build','--debug','--no-bundle'],{stdio:'inherit',windowsHide:true});if(result.status)process.exit(result.status);
}
const app=spawn(fs.existsSync(release)?release:debug,[],{detached:true,stdio:'ignore',windowsHide:true});app.unref();
console.log('snag를 실행했습니다.');
