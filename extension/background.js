const HOST='com.streamdrop.desktop';
const candidates=new Map();
const isMedia=url=>/\.(?:m3u8|mpd|mp4|webm|mov|m4v|m4a|mp3)(?:[?#]|$)/i.test(url);
const isHttp=url=>typeof url==='string'&&/^https?:\/\//i.test(url);
function remember(tabId,item){
  if(tabId<0||!isHttp(item.url)) return;
  const entries=candidates.get(tabId)||new Map();
  if(!entries.has(item.url)&&entries.size>=80) entries.delete(entries.keys().next().value);
  entries.set(item.url,{...item,id:item.url});candidates.set(tabId,entries);
  chrome.storage.session.set({[`media-${tabId}`]:[...entries.values()]}).catch(()=>{});
  chrome.action.setBadgeText({tabId,text:String(entries.size)}).catch(()=>{});
  chrome.action.setBadgeBackgroundColor({tabId,color:'#25765b'}).catch(()=>{});
}
chrome.webRequest.onHeadersReceived.addListener(details=>{
  const type=details.responseHeaders?.find(h=>h.name.toLowerCase()==='content-type')?.value||'';
  if(/\.(?:ts|m4s|cmfv|cmfa)(?:[?#]|$)/i.test(details.url)||/video\/mp2t/i.test(type))return;
  if(isMedia(details.url)||/video\/|audio\/|mpegurl|dash\+xml/i.test(type)) remember(details.tabId,{url:details.url,kind:type.includes('mpegurl')||/\.m3u8/i.test(details.url)?'HLS':type.includes('dash')||/\.mpd/i.test(details.url)?'DASH':'MEDIA',pageUrl:isHttp(details.initiator)?details.initiator:undefined});
},{urls:['http://*/*','https://*/*']},['responseHeaders']);
chrome.tabs.onUpdated.addListener((id,change)=>{if(change.status==='loading'){candidates.delete(id);chrome.storage.session.remove(`media-${id}`).catch(()=>{});chrome.action.setBadgeText({tabId:id,text:''}).catch(()=>{});}});
chrome.tabs.onRemoved.addListener(id=>{candidates.delete(id);chrome.storage.session.remove(`media-${id}`).catch(()=>{});});
chrome.runtime.onInstalled.addListener(()=>{
  chrome.contextMenus.removeAll(()=>chrome.contextMenus.create({id:'streamdrop-add',title:'snag 대기열에 추가',contexts:['video','audio','link','page']}));
});
async function relay(action,data){
  const response=await chrome.runtime.sendNativeMessage(HOST,{action,data});
  if(!response?.ok) throw new Error(response?.error||'snag 앱과 연결하지 못했습니다.');
  return response.data;
}
chrome.contextMenus.onClicked.addListener(async(info,tab)=>{
  if(info.menuItemId!=='streamdrop-add')return;
  try{await relay('enqueue',{url:info.srcUrl&&isHttp(info.srcUrl)?info.srcUrl:info.linkUrl||info.pageUrl,pageUrl:info.pageUrl,title:tab?.title});await chrome.action.setBadgeText({tabId:tab.id,text:'+'});}
  catch(error){await chrome.storage.local.set({lastError:error.message});await chrome.action.setBadgeText({tabId:tab.id,text:'!'});}
});
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  (async()=>{
    if(message.action==='found'){
      if(sender.tab)for(const item of (message.items||[]).slice(0,80))remember(sender.tab.id,{url:item.url,title:sender.tab.title,pageUrl:sender.url||sender.tab.url,kind:'VIDEO'});
      return {ok:true};
    }
    if(message.action==='list'){
      const tab=await chrome.tabs.get(message.tabId);
      if(!candidates.has(message.tabId)){const saved=await chrome.storage.session.get(`media-${message.tabId}`);candidates.set(message.tabId,new Map((saved[`media-${message.tabId}`]||[]).map(e=>[e.url,e])));}
      let entries=[...(candidates.get(message.tabId)?.values()||[])];
      // Re-scan DOM after service-worker suspension; request history may have expired.
      try{const found=await chrome.tabs.sendMessage(message.tabId,{action:'scan'});for(const item of found?.items||[])remember(message.tabId,{...item,pageUrl:tab.url,title:tab.title});entries=[...(candidates.get(message.tabId)?.values()||[])];}catch{}
      return {ok:true,items:entries.map(e=>({...e,pageUrl:e.pageUrl||tab.url,title:tab.title})),page:{url:tab.url,title:tab.title}};
    }
    if(message.action==='status')return {ok:true,data:await relay('status')};
    if(message.action==='enqueue'){
      if(sender.tab) return {ok:true,data:await relay('enqueue',{...message.data,pageUrl:sender.tab.url})};
      return {ok:true,data:await relay('enqueue',message.data)};
    }
    throw new Error('지원하지 않는 요청입니다.');
  })().then(respond,error=>respond({ok:false,error:error.message}));return true;
});
