(()=>{
  const http=url=>typeof url==='string'&&/^https?:\/\//i.test(url);
  function scan(){return [...document.querySelectorAll('video,audio')].flatMap(v=>[v.currentSrc,v.src,...[...v.querySelectorAll('source')].map(s=>s.src)]).filter(http).map(url=>({url}));}
  chrome.runtime.onMessage.addListener((message,_,respond)=>{if(message.action==='scan')respond({items:scan()});});
  const root=document.createElement('streamdrop-capture');
  const shadow=root.attachShadow({mode:'closed'});
  const style=document.createElement('style');style.textContent=':host{all:initial;--snag-font-size:13px;position:fixed;z-index:2147483647;right:20px;bottom:20px;display:none}button{font:600 var(--snag-font-size) system-ui;background:#1f604b;color:white;border:1px solid #ffffff55;border-radius:8px;padding:9px 13px;box-shadow:0 3px 18px #0003;cursor:grab}button:focus-visible{outline:3px solid #8cddb8;outline-offset:3px}';
  const button=document.createElement('button');button.textContent='영상 잡아서 snag로';button.draggable=true;button.title='드래그하여 앱에 놓거나 클릭하여 대기열에 추가';
  shadow.append(style,button);document.documentElement.append(root);
  let current=null;
  const data=()=>({url:http(current?.currentSrc)?current.currentSrc:http(current?.src)?current.src:location.href,pageUrl:location.href,title:document.title});
  button.addEventListener('dragstart',event=>{const input=data();event.dataTransfer.setData('text/plain','streamdrop:'+JSON.stringify(input));event.dataTransfer.setData('text/uri-list',input.url);event.dataTransfer.effectAllowed='copy';});
  button.addEventListener('click',async()=>{button.textContent='추가 중…';try{const r=await chrome.runtime.sendMessage({action:'enqueue',data:data()});button.textContent=r.ok?(r.data?.duplicate?'이미 추가된 영상':'대기열에 추가됨'):'연결 확인이 필요합니다';}catch{button.textContent='snag 앱을 실행해 주세요';}setTimeout(()=>button.textContent='영상 잡아서 snag로',2500);});
  let last='';
  function update(){
    const videos=[...document.querySelectorAll('video,audio')];current=videos.find(v=>!v.paused)||videos[0]||null;root.style.display=current?'block':'none';
    const items=scan(),signature=JSON.stringify(items);if(signature!==last){last=signature;chrome.runtime.sendMessage({action:'found',items}).catch(()=>{});}
  }
  document.addEventListener('play',update,true);document.addEventListener('loadedmetadata',update,true);
  const observer=new MutationObserver(()=>{clearTimeout(update.timer);update.timer=setTimeout(update,500);});observer.observe(document.documentElement,{childList:true,subtree:true});update();
})();
