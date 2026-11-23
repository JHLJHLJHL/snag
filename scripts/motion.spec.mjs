import {test, expect} from '@playwright/test';

const options={preset:'best',mode:'both',container:'original',videoFormat:'auto',audioFormat:'auto'};
const settings={...options,directory:'C:\\Videos',autoStart:false};
const video={id:'one',title:'테스트 영상',url:'https://example.com/video.mp4',status:'ready',options,
  progress:{percent:0},info:{duration:120,formats:[]},created:1};

test.beforeEach(async({page})=>{
  await page.addInitScript(({settings,video})=>{
    let queue={items:[video],settings},callbacks=new Map(),next=1,listeners=new Map();
    window.__motionCalls=[];
    window.__setQueue=items=>{queue={...queue,items};listeners.get('queue-changed')?.({event:'queue-changed',payload:queue});};
    window.__emitPlaylist=payload=>listeners.get('playlist-added')?.({event:'playlist-added',payload});
    window.__getQueue=()=>queue;
    window.__clipboardError=false;
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{
      if(window.__clipboardError)throw new Error('클립보드 접근이 거부되었습니다.');
      window.__copiedText=text;
    }}});
    window.__TAURI_EVENT_PLUGIN_INTERNALS__={unregisterListener(event){listeners.delete(event);}};
    window.__TAURI_INTERNALS__={
      transformCallback(fn){const id=next++;callbacks.set(id,fn);return id;},
      unregisterCallback(id){callbacks.delete(id);},
      async invoke(name,args){
        if(name==='plugin:event|listen'){listeners.set(args.event,callbacks.get(args.handler));return next++;}
        if(name==='plugin:event|unlisten')return;
        const {action,payload}=args;window.__motionCalls.push({action,payload});
        if(action==='snapshot')return queue;
        if(action==='status')return {engineReady:true,bridgeInstalled:true,extensionPath:'C:\\snag\\extension'};
        if(action==='update'){
          const item=queue.items.find(item=>item.id===payload.id);Object.assign(item.options,payload.options);
          window.__setQueue([...queue.items]);return item;
        }
        if(action==='updateSelected'){
          for(const item of queue.items.filter(item=>payload.ids.includes(item.id))){
            item.options={...item.options,mode:payload.media==='audio'?'audio':'both',container:payload.media==='audio'?'mp3':'mp4',videoFormat:'auto',audioFormat:'auto'};
          }
          window.__setQueue([...queue.items]);return {count:payload.ids.length};
        }
        if(action==='downloadSelected'){
          for(const item of queue.items.filter(item=>payload.ids.includes(item.id)))item.status='queued';
          window.__setQueue([...queue.items]);return {count:payload.ids.length};
        }
        if(action==='retry'){
          window.__setQueue(queue.items.map(item=>item.id===payload.id?{...item,status:'analyzing',error:null,progress:{percent:0}}:item));return null;
        }
        if(action==='removeSelected'){
          window.__setQueue(queue.items.filter(item=>!payload.ids.includes(item.id)));return {count:payload.ids.length};
        }
        if(action==='deleteCompleted'){
          if(window.__deleteError)throw new Error('완료 기록을 저장하지 못했습니다.');
          const failures=window.__deleteFailure&&payload.deleteFiles?queue.items.filter(item=>payload.ids.includes(item.id)&&item.id==='two').map(item=>({id:item.id,title:item.title,error:'파일을 사용 중입니다.'})):[];
          const removed=queue.items.filter(item=>payload.ids.includes(item.id)&&!failures.some(f=>f.id===item.id));
          window.__setQueue(queue.items.filter(item=>!removed.some(row=>row.id===item.id)));
          return {removed:removed.length,deletedFiles:payload.deleteFiles?removed.length:0,failures};
        }
        if(action==='add'){
          const item={...video,id:'added',title:'새 영상',status:'analyzing'};
          window.__setQueue([...queue.items,item]);return {id:item.id,duplicate:false};
        }
        return null;
      },
    };
  },{settings,video});
});

async function status(page,state,percent=0){
  await page.evaluate(({state,percent})=>{
    const item=window.__getQueue().items[0];
    window.__setQueue([{...item,status:state,progress:{percent}}]);
  },{state,percent});
}

test('results leave the queue and appear only in their matching library',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{
    const item=window.__getQueue().items[0];
    window.__setQueue([item,{...item,id:'failed',title:'실패한 영상',status:'failed'},
      {...item,id:'cancelled',title:'취소한 영상',status:'cancelled'},
      {...item,id:'done',title:'완료한 영상',status:'completed'}]);
  });
  const list=page.locator('[data-region="download-list"]');
  await expect(list.getByText('테스트 영상',{exact:true})).toBeVisible();
  for(const title of ['실패한 영상','취소한 영상','완료한 영상'])await expect(list.getByText(title,{exact:true})).toHaveCount(0);
  await page.getByRole('checkbox',{name:'테스트 영상 선택',exact:true}).check();
  await status(page,'failed');
  await expect(list.getByText('테스트 영상',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('complementary').getByText('테스트 영상',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'실패 · 취소',exact:false}).click();
  await expect(list.getByText('테스트 영상',{exact:true})).toBeVisible();
  await list.getByRole('button',{name:'다시 시도',exact:true}).click();
  await expect(list.getByText('테스트 영상',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'다운로드 대기열',exact:false}).click();
  await expect(list.getByText('테스트 영상',{exact:true})).toBeVisible();
  await expect(page.getByText('0개 선택',{exact:true})).toBeVisible();
  await status(page,'completed',100);
  await expect(list.getByText('테스트 영상',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('complementary').getByText('테스트 영상',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'실패 · 취소',exact:false}).click();
  await expect(list.getByText('테스트 영상',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();
  await expect(list.getByText('테스트 영상',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'다운로드 대기열',exact:false}).click();
  await expect(list.getByText('테스트 영상',{exact:true})).toHaveCount(0);
});

test('queue media buttons only configure selection and panel button starts downloads',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{
    const template=window.__getQueue().items[0];
    window.__setQueue([template,{...template,id:'two',title:'두 번째 영상'},{...template,id:'active',title:'다운로드 중인 영상',status:'downloading'}]);
  });
  const all=page.getByRole('checkbox',{name:'대기열 전체 선택',exact:true});
  await expect(page.getByRole('button',{name:'영상 다운',exact:true})).toBeDisabled();
  await expect(page.getByRole('checkbox',{name:'다운로드 중인 영상 선택',exact:true})).toBeDisabled();
  await all.check();await expect(page.getByText('2개 선택',{exact:true})).toBeVisible();
  await all.uncheck();await expect(page.getByText('0개 선택',{exact:true})).toBeVisible();
  await page.getByRole('checkbox',{name:'두 번째 영상 선택',exact:true}).check();
  await expect(all).toHaveJSProperty('indeterminate',true);
  await page.getByRole('button',{name:'음성 다운',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__motionCalls.find(call=>call.action==='updateSelected')?.payload)).toEqual({ids:['two'],media:'audio'});
  expect(await page.evaluate(()=>window.__getQueue().items[1].options)).toMatchObject({mode:'audio',container:'mp3'});
  expect(await page.evaluate(()=>window.__getQueue().items[0].options.mode)).toBe('both');
  await expect(page.getByText('1개 선택',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__getQueue().items[1].status)).toBe('ready');
  expect(await page.evaluate(()=>window.__motionCalls.some(call=>call.action==='downloadSelected'))).toBe(false);
  await page.getByRole('button',{name:'영상 다운',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__getQueue().items[1].options)).toMatchObject({mode:'both',container:'mp4'});
  expect(await page.evaluate(()=>window.__getQueue().items[1].status)).toBe('ready');
  await page.getByRole('button',{name:'선택한 1개 다운로드',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__motionCalls.find(call=>call.action==='downloadSelected')?.payload)).toEqual({ids:['two']});
  expect(await page.evaluate(()=>window.__getQueue().items[1].status)).toBe('queued');
  await expect(page.getByText('0개 선택',{exact:true})).toBeVisible();
});

test('queue removal excludes only checked rows and clears selection',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{const item=window.__getQueue().items[0];window.__setQueue([item,{...item,id:'two',title:'남길 영상'}]);});
  await page.getByRole('checkbox',{name:'테스트 영상 선택',exact:true}).check();
  await page.getByRole('button',{name:'제거',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__getQueue().items.map(item=>item.id))).toEqual(['two']);
  await expect(page.getByText('0개 선택',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'제거',exact:true})).toBeDisabled();
});

test('queue and completed controls stay fixed while only the list scrolls',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{const item=window.__getQueue().items[0];window.__setQueue(Array.from({length:25},(_,n)=>({...item,id:String(n),title:`스크롤 영상 ${n}`})));});
  const list=page.locator('[data-region="download-list"]');
  const input=page.getByRole('textbox',{name:'영상 주소',exact:true});
  const queueBar=page.locator('[data-region="queue-selection"]');
  const before=await queueBar.boundingBox(),inputBefore=await input.boundingBox();
  await list.evaluate(node=>node.scrollTop=node.scrollHeight);
  expect(await list.evaluate(node=>node.scrollTop)).toBeGreaterThan(100);
  expect((await queueBar.boundingBox()).y).toBe(before.y);
  expect((await input.boundingBox()).y).toBe(inputBefore.y);
  await expect(page.getByRole('checkbox',{name:'스크롤 영상 24 선택',exact:true})).toBeInViewport();
  await page.screenshot({path:'.test-artifacts/queue-fixed-selection.png'});
  await page.evaluate(()=>window.__setQueue(window.__getQueue().items.map(item=>({...item,status:'completed'}))));
  await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();
  const completeAll=page.getByRole('checkbox',{name:'완료 파일 전체 선택',exact:true});
  const completedBefore=await completeAll.boundingBox();
  await list.evaluate(node=>node.scrollTop=0);await list.evaluate(node=>node.scrollTop=node.scrollHeight);
  expect((await completeAll.boundingBox()).y).toBe(completedBefore.y);
  await expect(page.getByRole('button',{name:'선택한 파일 보내기',exact:true})).toBeInViewport();
  await completeAll.check();await expect(page.getByText('25개 선택',{exact:true})).toBeVisible();
  await completeAll.uncheck();await expect(page.getByText('0개 선택',{exact:true})).toBeVisible();
  await page.screenshot({path:'.test-artifacts/completed-fixed-selection.png'});
});

test('signature has a compact left inset, copies email with temporary feedback and opens release externally',async({page})=>{
  await page.goto('/');
  const email=page.getByRole('button',{name:'honeymath.gbe@gmal.com',exact:true});
  await expect(email).toBeVisible();
  const inset=await email.evaluate(node=>node.getBoundingClientRect().left-node.closest('.astryx-side-nav').getBoundingClientRect().left);
  expect(inset).toBeLessThanOrEqual(12);
  await email.click();
  await expect.poll(()=>page.evaluate(()=>window.__copiedText)).toBe('honeymath.gbe@gmal.com');
  await expect(page.getByRole('status').filter({hasText:'복사했습니다.'})).toBeVisible();
  const toast=page.locator('[data-notification="copy-toast"]');
  const box=await toast.boundingBox(),viewport=page.viewportSize();
  expect(Math.abs(box.x+box.width/2-viewport.width/2)).toBeLessThan(2);
  expect(viewport.height-box.y-box.height).toBeGreaterThan(16);
  expect(viewport.height-box.y-box.height).toBeLessThan(80);
  expect(box.width).toBeLessThan(180);
  await expect(page.locator('[data-notification="banner"]')).toHaveCount(0);
  await page.screenshot({path:'.test-artifacts/copy-toast.png'});
  await expect(page.getByText('복사했습니다.',{exact:true})).toBeHidden({timeout:4000});
  const release=page.getByRole('link',{name:'https://jhljhljhl.github.io/release',exact:true});
  await release.click();
  await expect.poll(()=>page.evaluate(()=>window.__motionCalls.some(call=>call.action==='openRelease'))).toBe(true);
  expect(page.url()).not.toContain('github.io');
  await page.evaluate(()=>{window.__clipboardError=true;});
  await email.click();
  await expect(page.getByRole('alert')).toContainText('클립보드에 복사하지 못했습니다.');
});

test('accepts playlist links and shows expansion summary while preserving queue updates',async({page})=>{
  await page.goto('/');
  const address=page.getByRole('textbox',{name:'영상 주소',exact:true});
  await expect(address).toHaveAttribute('placeholder',/재생목록/);
  await address.fill('https://www.youtube.com/playlist?list=PLtest');
  await page.getByRole('button',{name:'대기열 추가',exact:true}).click();
  await expect(page.getByText('주소를 확인하고 있습니다. 재생목록은 포함된 영상을 순서대로 추가합니다.',{exact:true})).toBeVisible();
  const banner=page.locator('[data-notification="banner"]');
  expect((await banner.boundingBox()).height).toBeLessThanOrEqual(40);
  expect(await banner.evaluate(node=>getComputedStyle(node).borderInlineStartWidth)).toBe('0px');
  await page.evaluate(()=>{
    const template=window.__getQueue().items[0];
    window.__setQueue([{...template,id:'first',title:'재생목록 첫 번째'},{...template,id:'second',title:'재생목록 두 번째'}]);
    window.__emitPlaylist({title:'재생목록 테스트',added:2,duplicates:1,skipped:1});
  });
  await expect(page.getByText('재생목록 테스트: 2개 영상을 대기열에 추가했습니다 · 중복 1개 제외 · 추가 불가 1개',{exact:true})).toBeVisible();
  await expect(page.getByText('재생목록 두 번째',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'모두 다운로드',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__motionCalls.some(call=>call.action==='startAll'))).toBe(true);
});

test('shows actual stages and waits for backend completion after 100%',async({page})=>{
  await page.goto('/');
  const steps=page.getByRole('list',{name:'다운로드 단계',exact:true});
  await expect(steps).toBeVisible();
  await status(page,'downloading',100);
  await expect(page.locator('[data-motion="job-status"]').first()).toHaveAttribute('data-state','downloading');
  await status(page,'processing',100);
  await expect(page.getByText('병합·변환 중',{exact:true}).first()).toBeVisible();
  await expect(steps.locator('.astryx-step[data-progress="completed"]')).toHaveCount(2);
  await expect(page.locator('[data-motion="job-status"]').first()).toHaveAttribute('data-state','processing');
  await status(page,'completed',100);
  await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();
  await expect(page.locator('[data-motion="job-status"]').first()).toHaveAttribute('data-state','completed');
  await expect(steps.locator('.astryx-step[data-progress="completed"]')).toHaveCount(4);
  await expect.poll(()=>page.locator('[data-motion="job-status"]').first().evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await page.screenshot({path:'.test-artifacts/motion-completed.png'});
});

test('completed file rows send the chosen item to DROP6',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await expect(page.getByRole('button',{name:'보내기',exact:true})).toHaveCount(0);
  await status(page,'completed',100);
  await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();
  await page.getByRole('button',{name:'보내기',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__motionCalls.filter(call=>call.action==='send'))).toEqual([{action:'send',payload:{ids:['one']}}]);
  await expect(page.getByRole('button',{name:'파일 위치 열기',exact:true})).toBeVisible();
});

test('completed selection sends only checked files and supports select all',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    const item=window.__getQueue().items[0];
    window.__setQueue([{...item,status:'completed'}, {...item,id:'two',title:'두 번째 영상',status:'completed'}, {...item,id:'three',title:'미완료 영상',status:'ready'}]);
  });
  await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();
  const send=page.getByRole('button',{name:'선택한 파일 보내기',exact:true});
  await expect(send).toBeDisabled();
  await expect(page.getByRole('checkbox',{name:'미완료 영상 선택',exact:true})).toHaveCount(0);
  await page.getByRole('checkbox',{name:'두 번째 영상 선택',exact:true}).check();
  await expect(page.getByRole('checkbox',{name:'완료 파일 전체 선택',exact:true})).toHaveJSProperty('indeterminate',true);
  await send.click();
  await expect.poll(()=>page.evaluate(()=>window.__motionCalls.filter(call=>call.action==='send').at(-1))).toEqual({action:'send',payload:{ids:['two']}});
  await page.getByRole('checkbox',{name:'완료 파일 전체 선택',exact:true}).check();
  await send.click();
  await expect.poll(()=>page.evaluate(()=>window.__motionCalls.filter(call=>call.action==='send').at(-1))).toEqual({action:'send',payload:{ids:['one','two']}});
  await page.getByRole('checkbox',{name:'완료 파일 전체 선택',exact:true}).uncheck();
  await expect(send).toBeDisabled();
});

test('completed deletion requires confirmation, defaults to history only, and preserves selection on cancel',async({page})=>{
  await page.goto('/');await status(page,'completed',100);
  await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();
  const remove=page.getByRole('button',{name:'삭제',exact:true});await expect(remove).toBeDisabled();
  await page.getByRole('checkbox',{name:'테스트 영상 선택',exact:true}).check();await remove.click();
  const dialog=page.getByRole('dialog',{name:'삭제할까요?',exact:true});await expect(dialog).toBeVisible();
  const files=dialog.getByRole('checkbox',{name:'파일도 함께 삭제',exact:true});await expect(files).not.toBeChecked();
  await files.check();await dialog.getByRole('button',{name:'취소',exact:true}).click();await expect(dialog).toBeHidden();
  expect(await page.evaluate(()=>window.__motionCalls.filter(call=>call.action==='deleteCompleted'))).toEqual([]);
  await expect(page.getByRole('checkbox',{name:'테스트 영상 선택',exact:true})).toBeChecked();
  await remove.click();await expect(files).not.toBeChecked();
  await dialog.getByRole('button',{name:'삭제',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__motionCalls.find(call=>call.action==='deleteCompleted')?.payload)).toEqual({ids:['one'],deleteFiles:false});
  await expect(dialog).toBeHidden();expect(await page.evaluate(()=>window.__getQueue().items)).toEqual([]);
});

test('completed row delete uses the same dialog and explicitly opts into deleting files',async({page})=>{
  await page.goto('/');await status(page,'completed',100);
  await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();
  await page.getByRole('button',{name:'완료 항목 삭제',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'삭제할까요?',exact:true});await expect(dialog).toBeVisible();
  await dialog.getByRole('checkbox',{name:'파일도 함께 삭제',exact:true}).check();
  await expect(dialog.getByText('파일은 휴지통으로 이동하지 않고 삭제됩니다.',{exact:true})).toBeVisible();
  await page.screenshot({path:'.test-artifacts/completed-delete-confirm.png'});
  await dialog.getByRole('button',{name:'삭제',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__motionCalls.find(call=>call.action==='deleteCompleted')?.payload)).toEqual({ids:['one'],deleteFiles:true});
  await expect(dialog).toBeHidden();
});

test('failed file deletion retains failed rows and supports retrying history only',async({page})=>{
  await page.goto('/');
  await page.evaluate(()=>{const item=window.__getQueue().items[0];window.__setQueue([{...item,status:'completed'},{...item,id:'two',title:'잠긴 영상',status:'completed'}]);window.__deleteFailure=true;});
  await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();
  await page.getByRole('checkbox',{name:'완료 파일 전체 선택',exact:true}).check();
  await page.getByRole('button',{name:'삭제',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'삭제할까요?',exact:true});
  await dialog.getByRole('checkbox',{name:'파일도 함께 삭제',exact:true}).check();
  await dialog.getByRole('button',{name:'삭제',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('1개 삭제 실패');
  expect(await page.evaluate(()=>window.__getQueue().items.map(item=>item.id))).toEqual(['two']);
  await dialog.getByRole('checkbox',{name:'파일도 함께 삭제',exact:true}).uncheck();
  await dialog.getByRole('button',{name:'삭제',exact:true}).click();
  await expect(dialog).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.__motionCalls.filter(call=>call.action==='deleteCompleted').at(-1)?.payload)).toEqual({ids:['two'],deleteFiles:false});
  expect(await page.evaluate(()=>window.__getQueue().items)).toEqual([]);
});

test('deletion command errors leave the confirmation and history intact',async({page})=>{
  await page.goto('/');await status(page,'completed',100);await page.evaluate(()=>window.__deleteError=true);
  await page.getByRole('button',{name:'완료한 다운로드',exact:false}).click();await page.getByRole('button',{name:'완료 항목 삭제',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'삭제할까요?',exact:true});await dialog.getByRole('button',{name:'삭제',exact:true}).click();
  await expect(dialog.getByRole('alert')).toContainText('완료 기록을 저장하지 못했습니다.');
  expect(await page.evaluate(()=>window.__getQueue().items.length)).toBe(1);
  await dialog.getByRole('button',{name:'취소',exact:true}).click();await expect(dialog).toBeHidden();
});

test('media segments support keyboard, reset formats and preserve MP3 compatibility',async({page})=>{
  await page.goto('/');
  const group=page.getByRole('radiogroup',{name:'저장할 미디어',exact:true});
  await expect(group).toBeVisible();
  await expect(group.getByRole('radio')).toHaveCount(2);
  await group.getByRole('radio',{name:'영상',exact:true}).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio',{name:'음성',exact:true})).toBeChecked();
  await page.evaluate(()=>{
    const item=window.__getQueue().items[0];
    window.__setQueue([{...item,options:{...item.options,mode:'audio',container:'mp3',videoFormat:'137',audioFormat:'140'}}]);
  });
  await group.getByRole('radio',{name:'영상',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__getQueue().items[0].options)).toMatchObject({mode:'both',container:'original',videoFormat:'auto',audioFormat:'auto'});
  await status(page,'processing',100);
  await expect(group.getByRole('radio',{name:'음성',exact:true})).toBeDisabled();
  await group.getByRole('radio',{name:'음성',exact:true}).click({force:true});
  expect(await page.evaluate(()=>window.__getQueue().items[0].options.mode)).toBe('both');
});

test('audio-only defaults to MP3 and exposes persistent output quality',async({page})=>{
  await page.goto('/',{waitUntil:'domcontentloaded'});
  const group=page.getByRole('radiogroup',{name:'저장할 미디어',exact:true});
  await group.getByRole('radio',{name:'음성',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__getQueue().items[0].options.container)).toBe('mp3');
  const quality=page.getByRole('combobox',{name:'음질',exact:true});
  await expect(quality).toContainText('최고 음질');
  await quality.click();
  await page.getByRole('option',{name:'192 kbps',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>window.__getQueue().items[0].options.audioQuality)).toBe('192');
  await group.getByRole('radio',{name:'영상',exact:true}).click();
  await expect(quality).toHaveCount(0);
  await group.getByRole('radio',{name:'음성',exact:true}).click();
  await expect(quality).toContainText('192 kbps');
  await status(page,'downloading',10);
  await expect(quality).toBeDisabled();
});

test('link drag gives acceptance and enqueue feedback; file-only drag is ignored',async({page})=>{
  await page.goto('/');
  const target=page.locator('[data-motion="drop-target"]');
  const transfer=await page.evaluateHandle(()=>{const d=new DataTransfer();d.setData('text/uri-list','https://example.com/new.mp4');return d;});
  await target.dispatchEvent('dragover',{dataTransfer:transfer});
  await expect(page.getByText('놓으면 대기열에 추가됩니다',{exact:true})).toBeVisible();
  await target.dispatchEvent('drop',{dataTransfer:transfer});
  await expect(page.getByText('대기열에 추가했어요',{exact:true})).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>window.__getQueue().items.length)).toBe(2);
  await expect.poll(()=>page.locator('[data-motion="drop-overlay"]').evaluate(el=>el.getAnimations().filter(a=>a.playState==='running').length)).toBe(0);
  await page.screenshot({path:'.test-artifacts/motion-drop.png'});
  await target.dispatchEvent('dragleave',{relatedTarget:null});
  await page.reload();
  const file=await page.evaluateHandle(()=>{const d=new DataTransfer();d.items.add(new File(['x'],'video.mp4'));return d;});
  await target.dispatchEvent('dragover',{dataTransfer:file});
  await expect(page.getByText('놓으면 대기열에 추가됩니다',{exact:true})).toHaveCount(0);
});

test('copy confirms actual clipboard success and exposes rejection',async({page})=>{
  await page.goto('/');
  await page.getByRole('button',{name:'크롬 연결',exact:true}).click();
  const register=await page.getByRole('button',{name:'연결 다시 등록',exact:true}).boundingBox();
  const registered=await page.getByText('등록됨',{exact:true}).boundingBox();
  expect(Math.abs(register.y+register.height/2-registered.y-registered.height/2)).toBeLessThan(1);
  await page.getByRole('button',{name:'폴더 경로 복사',exact:true}).click();
  await expect(page.getByRole('button',{name:'복사됨',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__copiedText)).toBe('C:\\snag\\extension');
  await expect(page.getByRole('button',{name:'폴더 경로 복사',exact:true})).toBeVisible({timeout:4000});
  await page.evaluate(()=>window.__clipboardError=true);
  await page.getByRole('button',{name:'폴더 경로 복사',exact:true}).click();
  await expect(page.getByRole('alert')).toContainText('클립보드');
  await expect(page.getByRole('button',{name:'복사됨',exact:true})).toHaveCount(0);
});

test('small window morphs from idle to progress and a fresh completion without overflow',async({page})=>{
  await page.setViewportSize({width:310,height:210});
  await page.goto('/?window=drop');
  const island=page.locator('[data-motion="island"]');
  await expect(page.getByText('영상을 여기에 놓으세요',{exact:true})).toBeVisible();
  await status(page,'downloading',42);
  await expect(island).toHaveAttribute('data-state','downloading');
  await expect(island).toContainText('42%');
  await status(page,'processing',100);
  await expect(island).toHaveAttribute('data-state','processing');
  await status(page,'completed',100);
  await expect(island).toHaveAttribute('data-state','completed');
  await expect.poll(()=>island.evaluate(el=>el.getAnimations({subtree:true}).filter(a=>a.playState==='running').length)).toBe(0);
  await page.screenshot({path:'.test-artifacts/motion-island.png'});
  expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(island).toHaveAttribute('data-state','idle',{timeout:5000});
  expect(await island.evaluate(el=>{
    const animation=el.getAnimations().find(a=>a.effect.getKeyframes().some(k=>k.width));
    const frames=animation?.effect.getKeyframes();
    return Boolean(frames&&frames[0].width!==frames.at(-1).width);
  })).toBe(true);
});

test('a retry failing in analysis does not reuse the previous 100% processing phase',async({page})=>{
  await page.goto('/');
  const steps=page.getByRole('list',{name:'다운로드 단계',exact:true});
  await expect(steps).toBeVisible();
  await status(page,'processing',100);
  await status(page,'failed',100);
  await page.getByRole('button',{name:'실패 · 취소',exact:false}).click();
  await page.getByRole('button',{name:'다시 시도',exact:true}).click();
  await expect(steps).toHaveCount(0);
  await status(page,'failed',100);
  await expect(steps.locator('.astryx-step[data-progress="completed"]')).toHaveCount(0);
  await expect(steps.locator('.astryx-step').first()).toHaveAttribute('data-status','error');
});

test('reduced motion keeps feedback and small desktop controls fit',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.setViewportSize({width:900,height:620});
  await page.goto('/');
  await status(page,'processing',100);
  const steps=page.getByRole('list',{name:'다운로드 단계',exact:true});
  await expect(steps).toBeVisible();
  await status(page,'failed',50);
  await page.getByRole('button',{name:'실패 · 취소',exact:false}).click();
  await expect(page.locator('[data-motion="job-status"]').first()).toHaveAttribute('data-state','failed');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running'&&a.effect?.getKeyframes().some(k=>k.transform&&k.transform!=='none')).length)).toBe(0);
  await page.screenshot({path:'.test-artifacts/motion-reduced.png'});
});
