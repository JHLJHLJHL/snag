import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// All file operations are confined to newly created test fixtures.
const root=path.resolve('.test-artifacts'),data=path.join(root,`completed-cleanup-${Date.now()}-${process.pid}`);
const media=path.join(data,'files');fs.mkdirSync(media,{recursive:true});
const files=[1,2,3].map(n=>path.join(media,`정리 테스트 ${n}.mp4`));
for(const file of files)fs.writeFileSync(file,'cleanup fixture');
const options={preset:'best',mode:'both',container:'mp4',videoFormat:'auto',audioFormat:'auto',audioQuality:'best'};
const items=files.map((file,n)=>({id:`cleanup-${n}`,url:`https://example.com/cleanup-${n}`,title:`정리 테스트 ${n+1}`,status:'completed',createdAt:n,options,
  progress:{percent:100,downloaded:0,total:null,speed:null,eta:null},info:{id:String(n),extractor:'Generic',title:`정리 테스트 ${n+1}`,duration:1,thumbnail:null,formats:[]},error:null,filePath:file,startWhenReady:false}));
fs.writeFileSync(path.join(data,'queue.json'),JSON.stringify({version:2,items,settings:{...options,directory:media,autoStart:false}}));
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const executable=path.resolve(process.env.STREAMDROP_BINARY||'release/snag-0.1.0-windows-x64/SNAG(beta).exe');
const env={...process.env,STREAMDROP_DATA_DIR:data,WEBVIEW2_USER_DATA_FOLDER:path.join(data,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`};
const start=()=>spawn(executable,[],{env,stdio:'ignore',windowsHide:true});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,label,timeout=30000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(await fn())return;await delay(100);}
  throw new Error(`Timed out: ${label}`);
}
let app=start(),browser,page,lock;
async function attach(){
  await waitFor(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},'WebView2 startup',45000);
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);page=browser.contexts()[0].pages()[0];
  await page.getByRole('heading',{name:'다운로드 대기열',exact:true}).waitFor();
}
const call=(action,payload={})=>page.evaluate(({action,payload})=>window.__TAURI_INTERNALS__.invoke('command',{action,payload}),{action,payload});
const dialog=()=>page.getByRole('dialog',{name:'삭제할까요?',exact:true});
try {
  await attach();await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();
  await page.getByRole('checkbox',{name:'정리 테스트 1 선택',exact:true}).check();
  await page.getByRole('button',{name:'삭제',exact:true}).click();
  assert.equal(await dialog().getByRole('checkbox',{name:'파일도 함께 삭제',exact:true}).isChecked(),false);
  await dialog().getByRole('checkbox',{name:'파일도 함께 삭제',exact:true}).check();
  await dialog().getByRole('button',{name:'취소',exact:true}).click();
  assert.equal((await call('snapshot')).items.length,3);assert.ok(files.every(file=>fs.existsSync(file)));
  await page.getByRole('button',{name:'삭제',exact:true}).click();
  assert.equal(await dialog().getByRole('checkbox',{name:'파일도 함께 삭제',exact:true}).isChecked(),false);
  await dialog().getByRole('button',{name:'삭제',exact:true}).click();
  await waitFor(async()=>(await call('snapshot')).items.length===2,'history-only deletion');
  assert.ok(fs.existsSync(files[0]),'unchecked file deletion preserves the actual file');

  await page.getByRole('button',{name:'완료 항목 삭제',exact:true}).first().click();
  await dialog().getByRole('checkbox',{name:'파일도 함께 삭제',exact:true}).check();
  await page.screenshot({path:path.join(root,'desktop-completed-delete-confirm.png')});
  await dialog().getByRole('button',{name:'삭제',exact:true}).click();
  await waitFor(async()=>(await call('snapshot')).items.length===1,'record and file deletion');
  assert.ok(!fs.existsSync(files[1]));assert.ok(fs.existsSync(files[0]));assert.ok(fs.existsSync(files[2]));

  // Hold only the test fixture open to exercise Windows sharing-violation handling.
  lock=spawn('powershell.exe',['-NoProfile','-Command',"$cleanupLock=[System.IO.File]::Open($env:SNAG_CLEANUP_LOCK_FILE,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::None); Write-Output 'LOCKED'; [Console]::ReadLine() | Out-Null; $cleanupLock.Dispose()"],
    {env:{...process.env,SNAG_CLEANUP_LOCK_FILE:files[2]},stdio:['pipe','pipe','pipe'],windowsHide:true});
  let lockOutput='';lock.stdout.on('data',chunk=>lockOutput+=chunk);lock.stderr.on('data',chunk=>lockOutput+=chunk);
  await waitFor(()=>lockOutput.includes('LOCKED'),'exclusive fixture lock');
  await page.getByRole('button',{name:'완료 항목 삭제',exact:true}).click();
  await dialog().getByRole('checkbox',{name:'파일도 함께 삭제',exact:true}).check();
  await dialog().getByRole('button',{name:'삭제',exact:true}).click();
  await dialog().getByRole('alert').filter({hasText:'삭제 실패'}).waitFor();
  assert.equal((await call('snapshot')).items.length,1,'failed file deletion retains its record');
  lock.stdin.end('\n');await waitFor(()=>lock.exitCode!==null,'release fixture lock');
  await dialog().getByRole('button',{name:'삭제',exact:true}).click();
  await waitFor(async()=>(await call('snapshot')).items.length===0,'retry after releasing fixture');
  assert.ok(!fs.existsSync(files[2]));assert.ok(fs.existsSync(files[0]));
  await call('quit').catch(()=>{});await waitFor(()=>app.exitCode!==null,'graceful exit');await browser.close().catch(()=>{});browser=null;
  app=start();await attach();assert.equal((await call('snapshot')).items.length,0);assert.ok(fs.existsSync(files[0]));
  await call('quit').catch(()=>{});await waitFor(()=>app.exitCode!==null,'restart exit');
  console.log('PASS: native cancel/default reset, history-only cleanup, file deletion, locked-file failure/retry and persisted cleanup');
  fs.writeFileSync(path.join(root,'cleanup-result.json'),JSON.stringify({passed:true,data,retainedFile:files[0]},null,2));
}catch(error){if(page)await page.screenshot({path:path.join(root,'cleanup-failure.png')}).catch(()=>{});throw error;}
finally{await browser?.close().catch(()=>{});if(app.exitCode===null)app.kill();if(lock&&lock.exitCode===null)lock.kill();}
