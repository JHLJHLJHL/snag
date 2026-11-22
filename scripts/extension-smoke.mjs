import {chromium} from '@playwright/test';
import {spawn,execFileSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fixtures} from './fixtures.mjs';

const root=path.resolve('.test-artifacts',`extension-${Date.now()}`);fs.mkdirSync(root,{recursive:true});
const extension=path.join(root,'extension'),data=path.join(root,'data');fs.mkdirSync(data,{recursive:true});fs.cpSync(path.resolve('extension'),extension,{recursive:true});
const background=path.join(extension,'background.js');fs.writeFileSync(background,fs.readFileSync(background,'utf8').replace("com.streamdrop.desktop","com.streamdrop.smoketest"));
const executable=path.resolve(process.env.STREAMDROP_BINARY||'src-tauri/target/debug/snag.exe');
const identity=JSON.parse(fs.readFileSync(path.join(extension,'identity.json')));
const host=path.join(root,'native-host.json');fs.writeFileSync(host,JSON.stringify({name:'com.streamdrop.smoketest',description:'Temporary snag test bridge',path:executable,type:'stdio',allowed_origins:[`chrome-extension://${identity.id}/`]}));
const keys=['Google\\Chrome for Testing','Chromium','Google\\Chrome'].map(browser=>`HKCU\\Software\\${browser}\\NativeMessagingHosts\\com.streamdrop.smoketest`);
const installed=[];let context;const fixture=await fixtures();
const app=spawn(executable,[],{env:{...process.env,STREAMDROP_DATA_DIR:data,STREAMDROP_ENGINE_DIR:path.resolve('engine'),WEBVIEW2_USER_DATA_FOLDER:path.join(root,'webview')},stdio:'ignore',windowsHide:true});
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=30000){const start=Date.now();while(Date.now()-start<timeout){const r=await fn();if(r)return r;await delay(200);}throw new Error(`Timeout: ${label}`);}
try {
  await until(()=>fs.existsSync(path.join(data,'bridge.json')),'app bridge');
  for(const key of keys){
    let exists=false;try{execFileSync('reg.exe',['QUERY',key],{stdio:'pipe',windowsHide:true});exists=true;}catch{}
    if(exists)throw new Error(`Refusing to change an existing test registry key: ${key}`);
    execFileSync('reg.exe',['ADD',key,'/ve','/t','REG_SZ','/d',host,'/f'],{stdio:'pipe',windowsHide:true});installed.push(key);
  }
  context=await chromium.launchPersistentContext(path.join(root,'chrome-profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],env:{...process.env,STREAMDROP_DATA_DIR:data},viewport:{width:1100,height:720}});
  const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
  assert.ok(worker.url().includes(identity.id));
  const status=await worker.evaluate(()=>chrome.runtime.sendNativeMessage('com.streamdrop.smoketest',{action:'status'}));assert.equal(status.ok,true,JSON.stringify(status));
  const page=await context.newPage();await page.goto(fixture.url);await page.locator('streamdrop-capture').waitFor({state:'visible'});
  const captured=await until(async()=>worker.evaluate(async()=>{const stored=await chrome.storage.session.get(null);return Object.values(stored).flat().find(item=>item.url?.endsWith('/sample.mp4'));}),'media detection');
  assert.equal(captured.url,`${fixture.url}/sample.mp4`);
  const box=await page.locator('streamdrop-capture').boundingBox();assert.ok(box);await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  const queued=await until(()=>{try{const s=JSON.parse(fs.readFileSync(path.join(data,'queue.json')));return s.items.length===1&&s.items[0].status==='ready'&&s;}catch{return false;}},'content-button to native queue');
  assert.equal(queued.items[0].url,`${fixture.url}/sample.mp4`);
  const duplicate=await worker.evaluate(url=>chrome.runtime.sendNativeMessage('com.streamdrop.smoketest',{action:'enqueue',data:{url,title:'공개 영상 테스트'}}),`${fixture.url}/sample.mp4`);assert.equal(duplicate.data.duplicate,true);
  await page.screenshot({path:path.resolve('.test-artifacts/chrome-extension.png')});
  await page.bringToFront();
  const popup=await context.newPage();await popup.setViewportSize({width:380,height:600});await popup.goto(`chrome-extension://${identity.id}/popup.html`);
  await popup.getByText('앱 연결됨',{exact:true}).waitFor();await popup.screenshot({path:path.resolve('.test-artifacts/chrome-popup.png')});
  console.log('PASS: real Chrome extension, public media capture, content button, native messaging, deduplication, popup');
} finally {
  if(context)await context.close();app.kill();
  for(const key of installed)execFileSync('reg.exe',['DELETE',key,'/f'],{stdio:'pipe',windowsHide:true});
  await fixture.close();
}
