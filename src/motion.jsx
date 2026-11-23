import React,{useEffect,useLayoutEffect,useRef,useState} from 'react';
import {HStack,VStack,Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Button} from '@astryxdesign/core/Button';
import {Icon} from '@astryxdesign/core/Icon';
import {Spinner} from '@astryxdesign/core/Spinner';
import {ProgressBar} from '@astryxdesign/core/ProgressBar';
import {Stepper,Step} from '@astryxdesign/core/Stepper';
import {SegmentedControl,SegmentedControlItem} from '@astryxdesign/core/SegmentedControl';
import {ArrowDownTrayIcon,ClipboardDocumentIcon,LinkIcon,PauseIcon,XMarkIcon,ExclamationCircleIcon} from '@heroicons/react/24/outline';

// Motion references: https://designbookmark.com/motion . Use actual application
// events rather than the demos' timers. Spring values follow their soft/settle roles.
export const jobLabels={analyzing:'분석 중',ready:'준비됨',queued:'다운로드 대기',downloading:'다운로드 중',processing:'병합·변환 중',paused:'일시 정지',completed:'완료',failed:'실패',cancelled:'취소됨'};
const working=status=>['analyzing','downloading','processing'].includes(status);

function useReducedMotion(){
  const [reduced,setReduced]=useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(()=>{
    const media=matchMedia('(prefers-reduced-motion: reduce)');
    const update=()=>setReduced(media.matches);
    update();media.addEventListener('change',update);
    return()=>media.removeEventListener('change',update);
  },[]);
  return reduced;
}

// Sample a damped unit spring once per transition. There is no idle animation loop.
function springPoints(stiffness,damping){
  let x=0,v=0;
  const points=[0];
  for(let frame=0;frame<36;frame++){
    for(let sub=0;sub<2;sub++){
      v+=(stiffness*(1-x)-damping*v)/120;
      x+=v/120;
    }
    points.push(x);
  }
  points.push(1);
  return points;
}
const settle=springPoints(280,22),soft=springPoints(260,24);

function useSpring(ref,trigger,{morph=false,enter=false}={}){
  const reduced=useReducedMotion(),previous=useRef(null);
  useLayoutEffect(()=>{
    const node=ref.current;
    if(!node)return;
    const measure=()=>{
      const css=getComputedStyle(node);
      return {width:css.width,height:css.height,borderRadius:css.borderRadius};
    };
    const before=previous.current,after=measure();
    previous.current=after;
    if(reduced||!node.animate||(!before&&!enter))return;
    const frames=morph&&before?soft.map(p=>Object.fromEntries(
      Object.keys(after).map(key=>[key,`calc(${before[key]} + (${after[key]} - ${before[key]}) * ${p})`])
    )):settle.map(p=>({transform:`scale(${.82+.18*p})`,opacity:Math.min(1,.5+.5*p)}));
    const animation=node.animate(frames,{duration:480,easing:'linear'});
    return()=>{
      // React has already updated the DOM at cleanup. Only a running effect still
      // supplies the old visual geometry; a finished one must retain its target.
      if(animation.playState==='running')previous.current=measure();
      animation.cancel();
    };
  },[ref,trigger,morph,enter,reduced]);
}

export function MotionStyles(){return <style>{`
  [data-motion="drop-target"] { position:relative; }
  [data-motion="drop-overlay"] {
    position:absolute; inset:var(--spacing-2); z-index:5; pointer-events:none;
    border:calc(2 * var(--border-width)) dashed var(--color-accent);
    border-radius:var(--radius-container);
    background:color-mix(in srgb,var(--color-background-surface) 96%,transparent);
  }
  [data-motion="drop-overlay"]:not([data-state="dragging"]) {
    inset:auto; inset-inline-end:var(--spacing-6);
    inset-block-end:calc(var(--spacing-10) + var(--spacing-6));
    max-width:calc(100% - var(--spacing-10));
    border:var(--border-width) solid var(--color-border);
    background:var(--color-background-surface);
  }
  [data-motion="drop-icon"] {
    color:var(--color-accent); background:var(--color-accent-muted);
    border-radius:var(--radius-container);
  }
  [data-motion="job-status"] {
    display:inline-flex; max-width:100%; color:var(--color-text-secondary);
    border-radius:var(--radius-full); background:var(--color-background-muted);
  }
  [data-motion="job-status"][data-state="downloading"],
  [data-motion="job-status"][data-state="processing"] {
    color:var(--color-accent); background:var(--color-accent-muted);
  }
  [data-motion="job-status"][data-state="completed"] {
    color:var(--color-on-success-muted); background:var(--color-success-muted);
  }
  [data-motion="job-status"][data-state="failed"] { color:var(--color-text-primary); }
  [data-motion="check"] path {
    stroke-dasharray:1; stroke-dashoffset:0;
    animation:sd-check var(--duration-medium) var(--ease-entrance) both;
  }
  [data-motion="island"] {
    overflow:hidden; flex-shrink:0; min-width:0;
    background:var(--color-background-muted); border-radius:var(--radius-full);
  }
  [data-motion="island"][data-expanded="true"] { border-radius:var(--radius-container); }
  [data-motion="island"][data-state="dragging"],
  [data-motion="island"][data-state="added"] { background:var(--color-accent-muted); }
  [data-motion="island"][data-state="completed"] { background:var(--color-success-muted); }
  [data-motion="ring"] {
    width:calc(var(--spacing-6) + var(--spacing-2));
    height:calc(var(--spacing-6) + var(--spacing-2)); flex-shrink:0;
    color:var(--color-accent); transform:rotate(-90deg);
  }
  [data-motion="ring"] circle:last-child { transition:stroke-dashoffset var(--duration-medium) linear; }
  @keyframes sd-check { from { stroke-dashoffset:1; } to { stroke-dashoffset:0; } }
  @media (prefers-reduced-motion:reduce) {
    [data-motion="check"] path { animation:none; }
    [data-motion="ring"] circle:last-child { transition:none; }
  }
`}</style>;}

function Check({compact=false}){return <svg data-motion="check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{width:compact?'var(--snag-icon-size-status)':'var(--spacing-4)',height:compact?'var(--snag-icon-size-status)':'var(--spacing-4)',flexShrink:0}}><path pathLength="1" d="m5 12 4 4L19 6"/></svg>;}

function StatusIcon({status,compact=false}){
  const ref=useRef(null);
  useSpring(ref,status);
  return <Stack ref={ref} hAlign="center" vAlign="center" aria-hidden="true" style={{flexShrink:0}}>
    {status==='completed'||status==='added'?<Check compact={compact}/>:working(status)||status==='adding'?<Spinner size="md"/>:<Icon size="sm" icon={status==='failed'?ExclamationCircleIcon:status==='paused'?PauseIcon:status==='cancelled'?XMarkIcon:status==='dragging'?LinkIcon:ArrowDownTrayIcon}/>}
  </Stack>;
}

export function JobStatus({status}){
  const compact=status==='completed';
  const ref=useRef(null);
  useSpring(ref,status,{morph:true});
  return <HStack ref={ref} data-motion="job-status" data-state={status} gap={compact?1:2} paddingInline={compact?1.5:2} paddingBlock={compact?0.5:1} width="fit-content" vAlign="center">
    <StatusIcon status={status} compact={compact}/><Text type="waiting-status" color="inherit" style={{lineHeight:'1.2'}}>{jobLabels[status]||status}</Text>
  </HStack>;
}

export function MediaSegments({options,onChange,disabled}){return <VStack gap={2}>
  <SegmentedControl label="저장할 미디어" size="sm" layout="fill" value={options.mode==='audio'?'audio':'both'} isDisabled={disabled} disabledMessage="작업을 진행하는 동안에는 저장할 미디어를 변경할 수 없습니다." onChange={mode=>onChange({mode,container:mode==='audio'?'mp3':options.container==='mp3'?'original':options.container,videoFormat:'auto',audioFormat:'auto'})}>
    <SegmentedControlItem value="both" label="영상"/>
    <SegmentedControlItem value="audio" label="음성"/>
  </SegmentedControl>
</VStack>;}

export function downloadStage(item){
  if(item.status==='completed')return 4;
  if(item.status==='processing')return 2;
  if(item.status==='analyzing')return 0;
  if(['ready','queued','downloading'].includes(item.status))return 1;
  if(item.progress?.percent>=100)return 2;
  return item.info?1:0;
}

export function DownloadSteps({item,history}){
  const interrupted=['failed','cancelled','paused'].includes(item.status);
  const current=interrupted?(history.get(item.id)??downloadStage(item)):downloadStage(item);
  return <VStack data-motion="steps" gap={2}>
    <Stack width="calc(100% + 2 * var(--spacing-5))" style={{alignSelf:'center'}}>
    <Stepper label="다운로드 단계" activeStep={current} indicatorPosition="on-track" density="compact" horizontalOptions={{minimumStepWidth:60,collapsedVariant:'withLabel'}}>
      {['분석','다운로드','병합·변환','완료'].map((label,index)=><Step key={label} step={index} label={label} status={interrupted&&index===current?(item.status==='failed'?'error':'warning'):undefined}/>) }
    </Stepper>
    </Stack>
    {item.status==='processing'&&<Text type="supporting">다운로드를 마쳤어요. 파일을 병합·변환하고 있습니다.</Text>}
    {interrupted&&<Text type="supporting">{jobLabels[item.status]} · {item.status==='paused'?'다시 시작하면 이어서 진행합니다.':item.status==='failed'?'오류를 확인하고 다시 시도해 주세요.':'다시 시도하면 작업을 시작합니다.'}</Text>}
  </VStack>;
}

export function DownloadProgress({item}){return <ProgressBar label={`${item.title} 다운로드 진행률`} isLabelHidden value={Math.max(0,Math.min(100,Number(item.progress?.percent)||0))} isIndeterminate={item.status==='processing'}/>;}

export function CopyButton({text,onError}){
  const [copied,setCopied]=useState(false),[copying,setCopying]=useState(false);
  const timer=useRef(null),mounted=useRef(false),ref=useRef(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;clearTimeout(timer.current);};},[]);
  useEffect(()=>{setCopied(false);clearTimeout(timer.current);},[text]);
  useSpring(ref,copied,{morph:true});
  async function copy(){
    if(copying||!text)return;
    setCopying(true);
    try{
      await navigator.clipboard.writeText(text);
      if(!mounted.current)return;
      setCopied(true);clearTimeout(timer.current);
      timer.current=setTimeout(()=>setCopied(false),1800);
    }catch(error){if(mounted.current){setCopied(false);onError(`클립보드에 복사하지 못했습니다. ${error.message||error}`);}}
    finally{if(mounted.current)setCopying(false);}
  }
  return <HStack ref={ref} width="fit-content" data-motion="copy" style={{overflow:'hidden'}}>
    <Button label={copied?'복사됨':'폴더 경로 복사'} variant="ghost" isDisabled={!text} isLoading={copying} onClick={copy} icon={copied?<Check/>:<Icon icon={ClipboardDocumentIcon}/>}/>
    <Text role="status" style={{position:'absolute',clipPath:'inset(50%)',width:'var(--border-width)',height:'var(--border-width)',overflow:'hidden'}}>{copied?'폴더 경로를 복사했습니다.':''}</Text>
  </HStack>;
}

export function acceptsLink(data){return Array.from(data.types||[]).some(type=>['text/plain','text/uri-list','text/html'].includes(type));}

export function DropFeedback({over,adding,result}){
  const ref=useRef(null),state=over?'dragging':adding?'adding':result?.state;
  useSpring(ref,state,{enter:true});
  if(!state)return null;
  const title=state==='dragging'?'놓으면 대기열에 추가됩니다':state==='adding'?'대기열에 추가하는 중':state==='failed'?'추가하지 못했어요':state==='duplicate'?'이미 추가한 영상이에요':'대기열에 추가했어요';
  return <Stack ref={ref} data-motion="drop-overlay" data-state={state} direction={over?'vertical':'horizontal'} hAlign="center" vAlign="center" gap={4} padding={over?6:4} role="status">
    <Stack data-motion="drop-icon" padding={over?5:3} hAlign="center" vAlign="center"><StatusIcon status={state==='success'?'added':state}/></Stack>
    <VStack gap={2} hAlign={over?'center':'start'}><Text weight="semibold">{title}</Text>
    <Text type="supporting">{state==='dragging'?'영상 링크를 놓으면 자동으로 분석합니다.':state==='failed'?'주소를 확인한 뒤 다시 시도해 주세요.':'분석이 끝나면 원하는 화질을 선택하세요.'}</Text></VStack>
  </Stack>;
}

function ProgressRing({percent}){return <svg data-motion="ring" viewBox="0 0 40 40" aria-hidden="true" fill="none" strokeWidth="3">
  <circle cx="20" cy="20" r="16" stroke="var(--color-background-surface)"/>
  <circle cx="20" cy="20" r="16" pathLength="100" stroke="currentColor" strokeLinecap="round" strokeDasharray="100" strokeDashoffset={100-Math.max(0,Math.min(100,Number(percent)||0))}/>
</svg>;}

export function DropIsland({items,over,adding,result,message,dropProps,onOpen}){
  const previous=useRef(new Map()),[notice,setNotice]=useState(null),ref=useRef(null);
  useEffect(()=>{
    const changed=items.find(item=>previous.current.has(item.id)&&previous.current.get(item.id)!==item.status&&['completed','failed','paused','cancelled'].includes(item.status));
    previous.current=new Map(items.map(item=>[item.id,item.status]));
    if(changed)setNotice({id:changed.id,status:changed.status,title:changed.title});
  },[items]);
  useEffect(()=>{
    if(!notice)return;
    const timer=setTimeout(()=>setNotice(null),2600);
    return()=>clearTimeout(timer);
  },[notice]);
  const active=items.find(item=>['downloading','processing'].includes(item.status))||items.find(item=>['analyzing','queued'].includes(item.status));
  const outcome=notice&&items.some(item=>item.id===notice.id&&item.status===notice.status)?notice:null;
  const pending=items.filter(item=>item.status!=='completed').length,completed=items.length-pending;
  const state=over?'dragging':adding?'adding':result?(result.state==='success'?'added':result.state):message?.error?'failed':outcome?.status||active?.status||'idle';
  const expanded=state!=='idle',percent=Math.round(Number(active?.progress?.percent)||0);
  const title=state==='dragging'?'놓으면 대기열에 추가됩니다':state==='adding'?'대기열에 추가하는 중':state==='added'?'대기열에 추가했어요':state==='duplicate'?'이미 추가한 영상이에요':state==='idle'?'영상을 여기에 놓으세요':jobLabels[state]||'준비됨';
  useSpring(ref,state,{morph:true});
  return <VStack {...dropProps} padding={4} gap={3} height="100dvh" hAlign="center" vAlign="center" style={{fontFamily:'var(--font-family-body)',background:'var(--color-background-surface)'}}>
    <Text type="supporting" weight="semibold">snag</Text>
    <HStack ref={ref} data-motion="island" data-state={state} data-expanded={expanded} width={expanded?'100%':'calc(100% - var(--spacing-4))'} padding={3} gap={3} vAlign="center">
      {state==='downloading'?<ProgressRing percent={percent}/>:<StatusIcon status={state==='idle'?'ready':state}/>}
      <VStack gap={1} style={{flex:1,minWidth:0}}>
        <Text type="supporting" weight="semibold" color="primary" maxLines={1} role="status">{title}</Text>
        <Text type="supporting" maxLines={message?.error?2:1}>{message?.error?message.text:state==='downloading'?`${percent}% · ${active.title}`:outcome&&state===outcome.status?outcome.title:active&&state===active.status?active.title:`대기 ${pending}개 · 완료 ${completed}개`}</Text>
        {active&&['downloading','processing'].includes(state)&&<DownloadProgress item={active}/>}
      </VStack>
    </HStack>
    <Button label="대기열 열기" size="sm" variant="ghost" onClick={onOpen}/>
  </VStack>;
}
