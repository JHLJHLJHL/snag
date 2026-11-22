const message=document.querySelector('#message'),connection=document.querySelector('#connection');
const send=message=>chrome.runtime.sendMessage(message);
function displayName(url){const value=new URL(url).pathname.split('/').pop()||new URL(url).hostname;try{return decodeURIComponent(value);}catch{return value;}}
async function add(data,button){button.disabled=true;try{const r=await send({action:'enqueue',data});if(!r.ok)throw new Error(r.error);message.dataset.error='false';message.textContent=r.data.duplicate?'이미 대기열에 추가된 영상입니다.':'대기열에 추가했습니다. 앱에서 품질을 선택해 주세요.';}catch(e){message.dataset.error='true';message.textContent=e.message;}finally{button.disabled=false;}}
(async()=>{
 let [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 if(!/^https?:\/\//i.test(tab?.url||''))tab=(await chrome.tabs.query({currentWindow:true})).filter(t=>/^https?:\/\//i.test(t.url||'')).sort((a,b)=>(b.lastAccessed||0)-(a.lastAccessed||0))[0];
 if(!tab)throw new Error('http 또는 https 영상 페이지를 먼저 열어 주세요.');
 const list=await send({action:'list',tabId:tab.id});
 document.querySelector('#page').onclick=()=>add({url:tab.url,title:tab.title},document.querySelector('#page'));
 for(const item of list.items||[]){const row=document.createElement('article');row.className='media';const p=document.createElement('p');p.title=item.url;const kind=document.createElement('strong');kind.className='kind';kind.textContent=item.kind||'VIDEO';p.append(kind,document.createTextNode(displayName(item.url)));const b=document.createElement('button');b.textContent='추가';b.onclick=()=>add(item,b);row.append(p,b);document.querySelector('#media').append(row);}
 message.textContent=list.items?.length?`${list.items.length}개의 미디어를 찾았습니다.`:'감지한 미디어가 없습니다. 영상을 재생해 주세요.';
 const status=await send({action:'status'});connection.textContent=status.ok?'앱 연결됨':'앱 연결 필요';
 if(!status.ok){message.dataset.error='true';message.textContent='앱의 크롬 연결 화면에서 브리지를 설치하고 앱을 실행해 주세요.';}
})().catch(e=>{message.textContent=e.message;message.dataset.error='true';});
