import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

// Uses synthetic files and a separate app profile; never sends the user's downloads.
const root=path.resolve('.test-artifacts'),data=path.join(root,`drop6-${Date.now()}`);
fs.mkdirSync(data,{recursive:true});
const options={preset:'best',mode:'both',container:'mp4',videoFormat:'auto',audioFormat:'auto',audioQuality:'best'};
const payloads=[['한국어 영상 1.mp4',Buffer.alloc(524288,7)],['음성 2.mp3',Buffer.alloc(131072,9)]];
const items=payloads.map(([name,bytes],index)=>{
  const filePath=path.join(data,name);fs.writeFileSync(filePath,bytes);
  return {id:`file-${index}`,url:'https://example.com/video.mp4',title:name,status:'completed',createdAt:Date.now(),options,progress:{percent:100},info:null,error:null,filePath};
});
fs.writeFileSync(path.join(data,'queue.json'),JSON.stringify({version:2,items,settings:{...options,directory:data,autoStart:false}}));
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));
const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const binary=path.resolve(process.env.STREAMDROP_BINARY||'release/snag-0.1.0-windows-x64/SNAG(beta).exe');
const app=spawn(binary,[],{env:{...process.env,STREAMDROP_DATA_DIR:data,WEBVIEW2_USER_DATA_FOLDER:path.join(data,'webview'),WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`},stdio:'ignore',windowsHide:true});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,label){for(let i=0;i<225;i++){const value=await fn();if(value)return value;await sleep(200);}throw new Error(`Timed out: ${label}`);}
let browser,page,sender,receiverBrowser;
try{
  await waitFor(async()=>{try{return(await fetch(`http://127.0.0.1:${port}/json/version`)).ok;}catch{return false;}},'app debug connection');
  browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page=await waitFor(()=>browser.contexts().flatMap(context=>context.pages()).find(candidate=>!candidate.url().includes('window=drop')),'main window');
  await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();
  await page.getByRole('checkbox',{name:'완료 파일 전체 선택',exact:true}).check();
  await page.screenshot({path:path.join(root,'drop6-selection.png')});
  await page.getByRole('button',{name:'선택한 파일 보내기',exact:true}).click();
  sender=await waitFor(()=>browser.contexts().flatMap(context=>context.pages()).find(candidate=>candidate.url().startsWith('https://drop6.duckdns.org/')),'DROP6 window');
  await sender.getByTestId('transfer-code').waitFor({timeout:45000});
  await sender.getByText('DROP6 파일 2개.zip',{exact:true}).waitFor();
  await sender.screenshot({path:path.join(root,'drop6-files-added.png')});
  const code=(await sender.getByTestId('transfer-code').innerText()).replace(/\D/g,'');
  assert.match(code,/^\d{6}$/);
  const privileged=await sender.evaluate(async()=>{
    try{await window.__TAURI_INTERNALS__.invoke('command',{action:'snapshot',payload:{}});return true;}catch{return false;}
  });
  assert.equal(privileged,false,'remote site cannot invoke native app commands');
  console.log('PASS: checked files automatically added to actual DROP6; ZIP and six-digit code created; remote native access denied');

  if(process.env.SNAG_DROP6_RECEIVE==='1'){
    receiverBrowser=await chromium.launch({headless:true});
    const receiver=await receiverBrowser.newPage({acceptDownloads:true});
    await receiver.addInitScript(()=>{
      Object.defineProperty(window,'showSaveFilePicker',{value:undefined});
      Object.defineProperty(window,'showDirectoryPicker',{value:undefined});
    });
    await receiver.goto(`https://drop6.duckdns.org/receive#code=${code}`);
    await receiver.getByRole('button',{name:'zip 하나로 받기',exact:true}).waitFor({timeout:45000});
    const downloaded=receiver.waitForEvent('download',{timeout:45000});
    await receiver.getByRole('button',{name:'zip 하나로 받기',exact:true}).click();
    const download=await downloaded;
    const {unzipSync}=await import('fflate');
    const entries=unzipSync(fs.readFileSync(await download.path()));
    assert.deepEqual(Object.keys(entries).sort(),payloads.map(([name])=>name).sort());
    for(const [name,bytes] of payloads)assert.deepEqual(Buffer.from(entries[name]),bytes);
    console.log('PASS: actual DROP6 receiver downloaded ZIP with both files byte-for-byte');
  }
  await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('command',{action:'quit',payload:{}}));
  await waitFor(()=>app.exitCode!==null,'app exit');
}catch(error){
  if(sender)await sender.screenshot({path:path.join(root,'drop6-failure.png')}).catch(()=>{});
  throw error;
}finally{
  if(receiverBrowser)await receiverBrowser.close().catch(()=>{});
  if(browser)await browser.close().catch(()=>{});
  if(app.exitCode===null)app.kill();
}
