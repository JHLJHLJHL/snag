import React,{useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AppShell} from '@astryxdesign/core/AppShell';
import {Layout,LayoutContent,LayoutHeader,LayoutFooter,LayoutPanel} from '@astryxdesign/core/Layout';
import {SideNav,SideNavSection,SideNavItem} from '@astryxdesign/core/SideNav';
import {VStack,HStack,Stack} from '@astryxdesign/core/Stack';
import {Text} from '@astryxdesign/core/Text';
import {Link} from '@astryxdesign/core/Link';
import {Heading} from '@astryxdesign/core/Heading';
import {Button} from '@astryxdesign/core/Button';
import {CheckboxInput} from '@astryxdesign/core/CheckboxInput';
import {Dialog,DialogHeader} from '@astryxdesign/core/Dialog';
import {TextInput} from '@astryxdesign/core/TextInput';
import {Selector} from '@astryxdesign/core/Selector';
import {Icon} from '@astryxdesign/core/Icon';
import {Badge} from '@astryxdesign/core/Badge';
import {List,ListItem} from '@astryxdesign/core/List';
import {Divider} from '@astryxdesign/core/Divider';
import {ArrowDownTrayIcon,ArrowUpTrayIcon,ArrowUpIcon,ArrowDownIcon,PlayIcon,PauseIcon,XMarkIcon,ArrowPathIcon,CheckCircleIcon,QueueListIcon,FolderIcon,Cog6ToothIcon,PuzzlePieceIcon,LinkIcon,WindowIcon,FilmIcon,MusicalNoteIcon,ArrowTopRightOnSquareIcon,TrashIcon} from '@heroicons/react/24/outline';
import {command,subscribe,subscribePlaylist,draggedInput,bytes,duration} from './api';
import {MotionStyles,MediaSegments,JobStatus,DownloadProgress,CopyButton,DropFeedback,DropIsland,acceptsLink,jobLabels as labels} from './motion';

const presets=[{value:'best',label:'원본 최고 화질'},{value:'1080',label:'최대 1080p'},{value:'720',label:'최대 720p'},{value:'480',label:'최대 480p'}];
const containers=[{value:'mp4',label:'MP4로 저장'},{value:'original',label:'원본 유지'},{value:'mp3',label:'MP3로 저장'}];
const audioQualities=[{value:'best',label:'최고 음질'},{value:'320',label:'320 kbps'},{value:'256',label:'256 kbps'},{value:'192',label:'192 kbps'},{value:'128',label:'128 kbps'},{value:'96',label:'96 kbps'}];
const busy=item=>['analyzing','queued','downloading','processing'].includes(item?.status);
const inQueue=item=>!['completed','failed','cancelled'].includes(item.status);
const queueSelectable=item=>inQueue(item)&&!['downloading','processing'].includes(item.status);

function Brand(){return <HStack gap={3} vAlign="center"><Stack width="var(--spacing-10)" height="var(--spacing-10)"><img src="/snag-character.png" alt="" style={{width:'100%',height:'100%',objectFit:'contain'}}/></Stack><VStack gap={0}><Text type="brand" weight="bold">SNAG</Text></VStack></HStack>;}
function formatLabel(f){return f.video?`${f.height?`${f.height}p`:'원본'}${f.fps?` · ${Math.round(f.fps)}fps`:''} · ${f.ext.toUpperCase()}${f.audio?' · 음성 포함':''}`:`${f.language?`${f.language.toUpperCase()} · `:''}${f.abr?`${Math.round(f.abr)} kbps · `:''}${f.ext.toUpperCase()}${f.note?` · ${f.note}`:''}`;}

function Quality({options,onChange,formats=[],disabled=false}){
  const selectedVideo=formats.find(f=>f.id===options.videoFormat);
  return <VStack gap={3}>
    <MediaSegments options={options} onChange={onChange} disabled={disabled}/>
    {options.mode!=='audio'&&<Selector label="기본 화질" value={options.preset} options={presets} onChange={preset=>onChange({preset,videoFormat:'auto'})} isDisabled={disabled} width="100%"/>}
    {formats.length>0&&options.mode!=='audio'&&<Selector label="영상 포맷" value={options.videoFormat} options={[{value:'auto',label:'기본 화질에 맞춰 자동 선택'},...formats.filter(f=>f.video).sort((a,b)=>(b.height||0)-(a.height||0)).map(f=>({value:f.id,label:formatLabel(f),description:[f.vcodec,bytes(f.size)].filter(Boolean).join(' · ')}))]} onChange={videoFormat=>onChange({videoFormat,audioFormat:'auto'})} hasSearch={formats.filter(f=>f.video).length>10} isDisabled={disabled} width="100%"/>}
    {formats.length>0&&options.mode!=='video'&&<Selector label="원본 음성 트랙" value={options.audioFormat} options={[{value:'auto',label:'원본 최고 음질 자동 선택'},...formats.filter(f=>f.audio&&!f.video).sort((a,b)=>(b.abr||0)-(a.abr||0)).map(f=>({value:f.id,label:formatLabel(f)}))]} onChange={audioFormat=>onChange({audioFormat})} isDisabled={disabled||(options.mode==='both'&&Boolean(selectedVideo?.audio))} disabledMessage={options.mode==='both'&&selectedVideo?.audio?'선택한 영상 포맷에 음성이 포함되어 있습니다.':undefined} width="100%"/>}
    <Selector label="파일 형식" value={options.container} options={containers} onChange={container=>onChange({container,...(container==='mp3'?{mode:'audio',videoFormat:'auto'}:{})})} isDisabled={disabled} width="100%"/>
    {options.mode==='audio'&&options.container==='mp3'&&<Selector label="음질" value={options.audioQuality||'best'} options={audioQualities} onChange={audioQuality=>onChange({audioQuality})} isDisabled={disabled} width="100%"/>}

  </VStack>;
}

function Empty({onConnect}){return <VStack gap={6} hAlign="center" vAlign="center" minHeight="28rem" padding={8}>
  <Stack style={{padding:'var(--spacing-5)',background:'var(--color-background-muted)',borderRadius:'var(--radius-container)'}}><Icon icon={ArrowUpTrayIcon} size="lg"/></Stack>
  <VStack gap={3} hAlign="center"><Heading level={2} type="section-title">마음에 드는 영상을 여기로</Heading><Text color="secondary" justify="center">크롬의 영상 링크나 썸네일을 끌어다 놓으세요<br/>주소를 붙여넣거나 확장 프로그램으로 추가할 수도 있어요</Text></VStack>
  <Button label="크롬 연결 방법" variant="secondary" icon={<Icon icon={PuzzlePieceIcon}/>} onClick={onConnect}/>
</VStack>;}

function Connection({status,run,refresh,onError}){return <VStack gap={6} maxWidth="40rem">
  <VStack gap={2}><Heading level={1}>크롬 연결</Heading><Text color="secondary">지금 쓰는 크롬에서 영상을 찾아 대기열로 보냅니다.</Text></VStack>
  <Divider/>
  <VStack gap={3}><Heading level={2}>1. 로컬 연결 등록</Heading><Text color="secondary">확장 프로그램과 이 앱이 통신하도록 현재 사용자 계정에 연결을 등록합니다.</Text><HStack gap={3} vAlign="center"><Button label={status.bridgeInstalled?'연결 다시 등록':'크롬 연결 등록'} variant="primary" onClick={async()=>{await run('installBridge');refresh();}}/><Text type="supporting">{status.bridgeInstalled?'등록됨':'처음 한 번 필요'}</Text></HStack></VStack>
  <VStack gap={3}><Heading level={2}>2. 확장 프로그램 불러오기</Heading><Text color="secondary">크롬 주소창에 chrome://extensions 를 입력하고 개발자 모드를 켜세요. ‘압축해제된 확장 프로그램을 로드합니다’를 눌러 아래 폴더를 선택하세요.</Text><Text type="code" wordBreak="break-all">{status.extensionPath||'앱 실행 후 표시됩니다.'}</Text><HStack gap={2}><Button label="확장 폴더 열기" icon={<Icon icon={FolderIcon}/>} onClick={()=>run('openExtension')}/><CopyButton text={status.extensionPath} onError={onError}/></HStack></VStack>
  <VStack gap={3}><Heading level={2}>3. 영상을 재생하고 추가</Heading><Text color="secondary">크롬 툴바의 snag에서 감지한 영상을 고르거나, 영상 우클릭 메뉴를 사용하세요. 영상 페이지에 나타나는 ‘영상 잡기’ 버튼을 앱으로 드래그해도 됩니다.</Text></VStack>
  <Divider/><Text type="supporting">브라우저 로그인 정보와 쿠키를 가져오지 않습니다. DRM으로 보호된 영상과 실시간 방송 저장은 지원하지 않습니다. 앱을 이동했다면 연결을 다시 등록해 주세요.</Text>
</VStack>;}

export default function App(){
  const [state,setState]=useState({items:[],settings:{preset:'best',mode:'both',container:'mp4',videoFormat:'auto',audioFormat:'auto',directory:'',autoStart:false}});
  const [status,setStatus]=useState({}),[view,setView]=useState('queue'),[selected,setSelected]=useState(null),[url,setUrl]=useState(''),[message,setMessage]=useState(null),[over,setOver]=useState(false),[adding,setAdding]=useState(false);
  const [addResult,setAddResult]=useState(null);
  const [checkedIds,setCheckedIds]=useState([]),[sending,setSending]=useState(false);
  const [queueCheckedIds,setQueueCheckedIds]=useState([]),[batchAction,setBatchAction]=useState(null);
  const [deleteIds,setDeleteIds]=useState(null),[deleteFiles,setDeleteFiles]=useState(false),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState(null);
  const [copied,setCopied]=useState(false);
  const timer=useRef(null);
  const copyTimer=useRef(null);
  const dropWindow=new URLSearchParams(location.search).get('window')==='drop';
  const flash=useCallback((text,error=false,timeout=error?10000:5000)=>{setMessage({text,error});clearTimeout(timer.current);timer.current=setTimeout(()=>setMessage(null),timeout);},[]);
  const copyEmail=useCallback(async()=>{
    try{await navigator.clipboard.writeText('honeymath.gbe@gmal.com');setCopied(true);clearTimeout(copyTimer.current);copyTimer.current=setTimeout(()=>setCopied(false),2000);}
    catch(error){flash(`클립보드에 복사하지 못했습니다. ${error.message||error}`,true);}
  },[flash]);
  useEffect(()=>()=>clearTimeout(copyTimer.current),[]);
  const run=useCallback(async(action,payload={})=>{try{return await command(action,payload);}catch(error){flash(String(error),true);return null;}},[flash]);
  const refresh=useCallback(()=>run('status').then(value=>{if(value)setStatus(value);}),[run]);
  const send=useCallback(async ids=>{
    setSending(true);
    try{await command('send',{ids});flash('DROP6에 파일을 추가했습니다. 전송 창을 열어 둔 채 코드를 공유해 주세요.');}
    catch(error){flash(String(error),true);}
    finally{setSending(false);}
  },[flash]);
  const requestDelete=useCallback(ids=>{setDeleteFiles(false);setDeleteError(null);setDeleteIds([...ids]);},[]);
  const confirmDelete=useCallback(async()=>{
    if(!deleteIds?.length||deleting)return;
    setDeleting(true);setDeleteError(null);
    try{
      const result=await command('deleteCompleted',{ids:deleteIds,deleteFiles});
      const failed=new Set(result.failures.map(failure=>failure.id));
      setCheckedIds(ids=>ids.filter(id=>!deleteIds.includes(id)||failed.has(id)));
      if(result.failures.length){
        setDeleteIds(result.failures.map(failure=>failure.id));
        setDeleteError(`${result.removed}개 항목 삭제 · ${result.failures.length}개 삭제 실패. ${result.failures[0].title}: ${result.failures[0].error}`);
      }else{
        setDeleteIds(null);
        flash(deleteFiles?`완료 기록 ${result.removed}개와 파일 ${result.deletedFiles}개를 삭제했습니다.`:`완료 기록 ${result.removed}개를 삭제했습니다. 파일은 유지했습니다.`);
      }
    }catch(error){setDeleteError(String(error));}
    finally{setDeleting(false);}
  },[deleteIds,deleteFiles,deleting,flash]);
  const applySelection=useCallback(async(ids,media)=>{
    setBatchAction(media||'remove');
    try{
      const result=await command(media?'updateSelected':'removeSelected',media?{ids,media}:{ids});
      if(!media)setQueueCheckedIds([]);
      flash(media?`${result.count}개 항목을 ${media==='audio'?'음성(MP3)':'영상(MP4)'}으로 설정했습니다.`:`${result.count}개 항목을 목록에서 제거했습니다.`);
    }catch(error){flash(String(error),true);}
    finally{setBatchAction(null);}
  },[flash]);
  const downloadSelection=useCallback(async ids=>{
    setBatchAction('start');
    try{const result=await command('downloadSelected',{ids});setQueueCheckedIds([]);flash(`${result.count}개 항목의 다운로드를 시작합니다.`);}
    catch(error){flash(String(error),true);}
    finally{setBatchAction(null);}
  },[flash]);
  useEffect(()=>{setQueueCheckedIds(ids=>{
    const next=ids.filter(id=>state.items.some(row=>row.id===id&&queueSelectable(row)));
    return next.length===ids.length?ids:next;
  });},[state.items]);
  useEffect(()=>{
    if(!addResult)return;
    const reset=setTimeout(()=>setAddResult(null),2200);
    return()=>clearTimeout(reset);
  },[addResult]);
  useEffect(()=>{
    const leave=()=>setOver(false);
    window.addEventListener('blur',leave);window.addEventListener('dragend',leave);
    return()=>{window.removeEventListener('blur',leave);window.removeEventListener('dragend',leave);};
  },[]);
  useEffect(()=>{
    let disposed=false,unlisten;
    subscribePlaylist(result=>{
      if(disposed)return;
      const skipped=result.skipped?` · 추가 불가 ${result.skipped}개`:'';
      const duplicates=result.duplicates?` · 중복 ${result.duplicates}개 제외`:'';
      flash(`${result.title}: ${result.added}개 영상을 대기열에 추가했습니다${duplicates}${skipped}`);
    }).then(fn=>{if(disposed)fn();else unlisten=fn;}).catch(error=>flash(String(error),true));
    return()=>{disposed=true;unlisten?.();};
  },[flash]);
  useEffect(()=>{
    let disposed=false,unlisten;
    subscribe(value=>{if(!disposed)setState(value);}).then(fn=>{if(disposed)fn();else unlisten=fn;}).catch(error=>flash(String(error),true));
    command('snapshot').then(value=>{if(!disposed)setState(value);}).catch(error=>flash(`앱 연결 오류: ${error}`,true));refresh();
    const keyboard=e=>{if((e.ctrlKey||e.metaKey)&&e.key==='l'){e.preventDefault();document.querySelector('input[aria-label="영상 주소"]')?.focus();}};
    window.addEventListener('keydown',keyboard);
    return()=>{disposed=true;unlisten?.();clearTimeout(timer.current);window.removeEventListener('keydown',keyboard);};
  },[refresh,flash]);
  const add=useCallback(async raw=>{
    setAdding(true);setAddResult(null);try{const result=await command('add',raw);setSelected(result.id);if(!dropWindow)setView('queue');flash(result.duplicate?'이미 대기열에 추가된 주소입니다.':'주소를 확인하고 있습니다. 재생목록은 포함된 영상을 순서대로 추가합니다.');setAddResult({state:result.duplicate?'duplicate':'success'});setUrl('');}catch(error){flash(String(error),true);setAddResult({state:'failed'});}finally{setAdding(false);}
  },[dropWindow,flash]);
  const onDrop=async e=>{e.preventDefault();setOver(false);if(!acceptsLink(e.dataTransfer)){flash('영상 파일 대신 크롬의 영상 링크를 끌어다 놓아 주세요.',true);return;}try{await add(draggedInput(e.dataTransfer));}catch(error){flash(error.message,true);setAddResult({state:'failed'});}};
  const filtered=useMemo(()=>state.items.filter(item=>view==='completed'?item.status==='completed':view==='failed'?['failed','cancelled'].includes(item.status):inQueue(item)),[state.items,view]);
  const item=filtered.find(i=>i.id===selected)||filtered[0];
  const sendIds=state.items.filter(row=>row.status==='completed'&&checkedIds.includes(row.id)).map(row=>row.id);
  const selectableQueue=filtered.filter(queueSelectable);
  const queueIds=selectableQueue.filter(row=>queueCheckedIds.includes(row.id)).map(row=>row.id);
  const pending=state.items.filter(inQueue).length,completed=state.items.filter(i=>i.status==='completed').length,failed=state.items.filter(i=>['failed','cancelled'].includes(i.status)).length;
  const active=state.items.find(i=>['downloading','processing'].includes(i.status));
  const dropProps={'data-motion':'drop-target',onDragOver:e=>{e.preventDefault();const accepts=acceptsLink(e.dataTransfer);e.dataTransfer.dropEffect=accepts?'copy':'none';setOver(accepts);},onDragLeave:e=>{if(!e.relatedTarget||!(e.relatedTarget instanceof Node)||!e.currentTarget.contains(e.relatedTarget))setOver(false);},onDrop};
  if(dropWindow)return <><MotionStyles/><DropIsland items={state.items} over={over} adding={adding} result={addResult} message={message} dropProps={dropProps} onOpen={()=>run('showMain')}/></>;
  return <Stack {...dropProps} height="100dvh" style={{fontFamily:'var(--font-family-body)',outline:over?'calc(2 * var(--border-width)) dashed var(--color-accent)':'none',outlineOffset:'calc(-1 * var(--spacing-2))'}}>
    <MotionStyles/>
    <DropFeedback over={over} adding={adding} result={addResult}/>
    <Dialog isOpen={deleteIds!==null} onOpenChange={open=>{if(!open&&!deleting)setDeleteIds(null);}} width="26rem" padding={5} purpose={deleting?'required':'form'}>
      <Layout height="auto" header={<DialogHeader title="삭제할까요?" onOpenChange={deleting?undefined:()=>setDeleteIds(null)}/>}
        content={<LayoutContent><VStack gap={3}><Text>선택한 완료 항목 {deleteIds?.length||0}개를 목록에서 삭제합니다.</Text><CheckboxInput label="파일도 함께 삭제" description="체크하지 않으면 완료 기록만 삭제합니다." value={deleteFiles} onChange={setDeleteFiles} isDisabled={deleting}/>{deleteFiles&&<Text type="supporting">파일은 휴지통으로 이동하지 않고 삭제됩니다.</Text>}{deleteError&&<Text role="alert" maxLines={4} wordBreak="break-word">{deleteError}</Text>}</VStack></LayoutContent>}
        footer={<LayoutFooter><HStack gap={2} hAlign="end"><Button label="취소" onClick={()=>setDeleteIds(null)} isDisabled={deleting}/><Button label="삭제" variant="destructive" onClick={confirmDelete} isLoading={deleting}/></HStack></LayoutFooter>}/>
    </Dialog>
    {copied&&<Stack as="section" role="status" aria-live="polite" data-notification="copy-toast" paddingBlock={3} paddingInline={4} style={{position:'fixed',left:'50%',bottom:'var(--spacing-12)',transform:'translateX(-50%)',zIndex:100,pointerEvents:'none',maxWidth:'calc(100vw - 2 * var(--spacing-4))',background:'var(--color-background-surface)',borderRadius:'var(--radius-inner)',boxShadow:'var(--shadow-med)'}}><Text>복사했습니다.</Text></Stack>}
    {message&&<Stack as="section" role={message.error?'alert':'status'} data-notification="banner" paddingBlock={2} paddingInline={3} style={{position:'fixed',top:'var(--spacing-4)',left:'50%',transform:'translateX(-50%)',zIndex:100,width:'max-content',maxWidth:'calc(100vw - 2 * var(--spacing-4))',background:'var(--color-background-muted)',borderRadius:'var(--radius-inner)',boxShadow:'var(--shadow-med)'}}><HStack gap={2} hAlign="between" vAlign="center"><Text wordBreak="break-word" style={{minWidth:0}}>{message.text}</Text><Button label="알림 닫기" isIconOnly variant="ghost" size="sm" icon={<Icon icon={XMarkIcon}/>} style={{height:'var(--spacing-5)',minHeight:'var(--spacing-5)',width:'var(--spacing-5)',padding:0}} onClick={()=>setMessage(null)}/></HStack></Stack>}
    <AppShell variant="section" sideNav={<SideNav header={<VStack padding={4} paddingBlock={3}><Brand/></VStack>} footer={<VStack paddingBlock={4} paddingInline={0} gap={1} style={{whiteSpace:'nowrap'}}><Text type="signature" color="secondary">2026 LJH</Text><Button label="honeymath.gbe@gmal.com" variant="ghost" size="sm" width="fit-content" onClick={copyEmail} style={{padding:0,height:'auto',minHeight:0,justifyContent:'flex-start'}}><Text type="signature" color="secondary">honeymath.gbe@gmal.com</Text></Button><Link type="signature" color="secondary" href="https://jhljhljhl.github.io/release" onClick={event=>{event.preventDefault();run('openRelease');}}>https://jhljhljhl.github.io/release</Link></VStack>}>
      <SideNavSection title="라이브러리"><SideNavItem label="다운로드 대기열" icon={QueueListIcon} isSelected={view==='queue'} onClick={()=>setView('queue')} endContent={<Badge label={pending}/>}/><SideNavItem label="완료한 다운로드" icon={CheckCircleIcon} isSelected={view==='completed'} onClick={()=>setView('completed')} endContent={<Badge label={completed}/>}/><SideNavItem label="실패 · 취소" icon={ArrowPathIcon} isSelected={view==='failed'} onClick={()=>setView('failed')} endContent={failed>0?<Badge label={failed}/>:undefined}/></SideNavSection>
      <SideNavSection title="앱"><SideNavItem label="크롬 연결" icon={PuzzlePieceIcon} isSelected={view==='connection'} onClick={()=>{setView('connection');refresh();}}/><SideNavItem label="저장 폴더 열기" icon={FolderIcon} onClick={()=>run('openDirectory')}/><SideNavItem label="작은 드롭 창" icon={WindowIcon} onClick={()=>run('dropWindow')}/></SideNavSection>
    </SideNav>}>
      <Layout height="fill" header={<LayoutHeader padding={6}><HStack gap={4} hAlign="between" vAlign="center" wrap="wrap"><VStack gap={1}><Heading level={1} type={['queue','completed'].includes(view)?'section-title':undefined}>{view==='connection'?'크롬에서, 바로 여기로':view==='settings'?'내 방식대로 저장':view==='completed'?'완료한 다운로드':view==='failed'?'다시 확인할 영상':'다운로드 대기열'}</Heading></VStack><HStack gap={2}><Button label="모두 일시 정지" variant="ghost" icon={<Icon icon={PauseIcon}/>} onClick={()=>run('pauseAll')} isDisabled={!state.items.some(busy)}/><Button label="모두 다운로드" variant="primary" icon={<Icon icon={PlayIcon}/>} onClick={()=>run('startAll')} isDisabled={!state.items.some(i=>['ready','paused','analyzing'].includes(i.status))||status.engineReady===false}/></HStack></HStack></LayoutHeader>}
        content={<LayoutContent padding={6} isScrollable={['connection','settings'].includes(view)}><VStack gap={5} height={['connection','settings'].includes(view)?'auto':'100%'} style={{minHeight:0}}>
          {status.engineReady===false&&<VStack gap={2}><Text weight="semibold">다운로드 엔진을 준비해 주세요.</Text><Text type="supporting">프로젝트 폴더에서 npm run setup:engine을 실행한 뒤 앱을 다시 실행하세요.</Text></VStack>}
          {view==='connection'?<Connection status={status} run={run} refresh={refresh} onError={text=>flash(text,true)}/>:view==='settings'?<VStack gap={6} maxWidth="35rem"><Heading level={2}>새 영상의 기본값</Heading><Text color="secondary">개별 영상의 품질은 오른쪽 패널에서 따로 변경할 수 있습니다.</Text><Quality options={state.settings} onChange={patch=>run('settings',patch)}/><Divider/><Selector label="대기열에 추가한 뒤" options={[{value:'false',label:'품질을 선택한 뒤 직접 시작'},{value:'true',label:'기본 설정으로 자동 다운로드'}]} value={String(state.settings.autoStart)} onChange={value=>run('settings',{autoStart:value==='true'})} width="100%"/><VStack gap={3}><Text weight="semibold">저장 폴더</Text><Text type="supporting" wordBreak="break-all">{state.settings.directory}</Text><Button label="저장 폴더 변경" icon={<Icon icon={FolderIcon}/>} onClick={()=>run('pickDirectory')}><Text type="section-title">저장 폴더 변경</Text></Button></VStack><Divider/><Text type="supporting">한 번에 영상 한 개를 다운로드합니다. 대기열은 자동 저장되며, 앱을 다시 실행하면 중단된 작업을 이어서 시작할 수 있습니다.</Text>{status.versions&&<Text type="supporting">yt-dlp {status.versions.ytDlp}</Text>}</VStack>:<>
            <HStack as="form" gap={3} onSubmit={e=>{e.preventDefault();if(url.trim())add(url.trim());}}><TextInput label="영상 주소" isLabelHidden placeholder="영상·재생목록 주소를 붙여넣거나 끌어다 놓으세요" value={url} onChange={setUrl} startIcon={LinkIcon} width="100%" autoComplete="off" inputMode="url"/><Button width="8rem" type="submit" label="대기열 추가" icon={<Icon icon={ArrowDownTrayIcon}/>} isLoading={adding} isDisabled={!url.trim()}/></HStack>
            {filtered.length>0&&<HStack hAlign="end"><Text type="supporting">한 번에 1개씩 다운로드</Text></HStack>}
            {view==='queue'&&filtered.length>0&&<HStack data-region="queue-selection" gap={3} vAlign="center" wrap="wrap"><HStack gap={3} vAlign="center"><CheckboxInput label="대기열 전체 선택" value={queueIds.length>0&&queueIds.length===selectableQueue.length?true:queueIds.length?'indeterminate':false} onChange={checked=>setQueueCheckedIds(checked?selectableQueue.map(row=>row.id):[])} isDisabled={!!batchAction||!selectableQueue.length}/><Text type="label" color="secondary">{queueIds.length}개 선택</Text></HStack><HStack gap={2} vAlign="center"><Button label="영상 다운" size="sm" icon={<Icon icon={FilmIcon}/>} isLoading={batchAction==='video'} isDisabled={!queueIds.length||!!batchAction} onClick={()=>applySelection(queueIds,'video')}/><Button label="음성 다운" size="sm" icon={<Icon icon={MusicalNoteIcon}/>} isLoading={batchAction==='audio'} isDisabled={!queueIds.length||!!batchAction} onClick={()=>applySelection(queueIds,'audio')}/><Button label="제거" size="sm" variant="ghost" icon={<Icon icon={XMarkIcon}/>} isLoading={batchAction==='remove'} isDisabled={!queueIds.length||!!batchAction} onClick={()=>applySelection(queueIds)}/></HStack></HStack>}
            {view==='completed'&&filtered.length>0&&<HStack gap={3} vAlign="center" hAlign="between" wrap="wrap"><HStack gap={3} vAlign="center"><CheckboxInput label="완료 파일 전체 선택" value={sendIds.length===filtered.length?true:sendIds.length?'indeterminate':false} onChange={checked=>setCheckedIds(checked?filtered.map(row=>row.id):[])} isDisabled={sending||deleting}/><Text type="label" color="secondary">{sendIds.length}개 선택</Text></HStack><HStack gap={2} vAlign="center"><Button label="선택한 파일 보내기" icon={<Icon icon={ArrowTopRightOnSquareIcon}/>} isLoading={sending} isDisabled={!sendIds.length||sending||deleting} onClick={()=>send(sendIds)}/><Button label="삭제" variant="ghost" icon={<Icon icon={TrashIcon}/>} isDisabled={!sendIds.length||sending||deleting} onClick={()=>requestDelete(sendIds)}/></HStack></HStack>}
            <Stack data-region="download-list" style={{flex:'1 1 0%',minHeight:0,overflowY:'auto',overscrollBehavior:'contain'}}>{filtered.length===0?<Empty onConnect={()=>setView('connection')}/>:<List hasDividers density="spacious">{filtered.map(row=><ListItem key={row.id} itemKey={row.id} isSelected={row.id===item?.id} onClick={()=>setSelected(row.id)}
              startContent={<HStack gap={3} vAlign="center">{['completed','queue'].includes(view)&&<CheckboxInput label={`${row.title} 선택`} isLabelHidden value={view==='completed'?checkedIds.includes(row.id):queueIds.includes(row.id)} isDisabled={view==='completed'?sending||deleting:!!batchAction||!queueSelectable(row)} onChange={checked=>{const update=ids=>checked?[...ids.filter(id=>id!==row.id),row.id]:ids.filter(id=>id!==row.id);if(view==='completed')setCheckedIds(update);else setQueueCheckedIds(update);}}/>}<Stack width="6rem" height="3.75rem" style={{background:'var(--color-background-muted)',borderRadius:'var(--radius-inner)',overflow:'hidden',alignItems:'center',justifyContent:'center',display:'flex'}}>{row.info?.thumbnail?<img src={row.info.thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" style={{width:'100%',height:'100%',objectFit:'cover'}} onError={e=>e.currentTarget.style.display='none'}/>:<Icon icon={row.options.mode==='audio'?MusicalNoteIcon:FilmIcon} size="lg"/>}</Stack></HStack>}
              label={<VStack gap={2}><Text weight="semibold" maxLines={1}>{row.title}</Text><HStack gap={2} wrap="wrap"><Text type="supporting">{new URL(row.pageUrl||row.url).hostname}</Text><Text type="supporting">· {duration(row.info?.duration)}</Text><Text type="supporting">· {row.options.mode==='audio'?'음성':row.options.preset==='best'?'최고 화질':`${row.options.preset}p 이하`}</Text></HStack></VStack>}
              description={(['downloading','processing'].includes(row.status)||row.error)?<VStack gap={2}>{['downloading','processing'].includes(row.status)&&<><Text type="supporting" hasTabularNumbers>{Math.round(row.progress.percent)}%{row.progress.speed?` · ${bytes(row.progress.speed)}/s`:''}{row.progress.eta?` · ${duration(row.progress.eta)} 남음`:''}</Text><DownloadProgress item={row}/></>}{row.error&&<Text type="supporting" maxLines={2}>{row.error}</Text>}</VStack>:undefined}
              endContent={<HStack gap={2} vAlign="center"><JobStatus status={row.status}/><HStack gap={1}>{row.status==='completed'?<><Button label="보내기" isIconOnly size="sm" variant="ghost" icon={<Icon icon={ArrowTopRightOnSquareIcon}/>} isDisabled={sending} onClick={()=>send([row.id])}/><Button label="파일 위치 열기" isIconOnly variant="ghost" icon={<Icon icon={FolderIcon}/>} onClick={()=>run('reveal',{id:row.id})}/></>:busy(row)?<Button label="작업 일시 정지" isIconOnly variant="ghost" icon={<Icon icon={PauseIcon}/>} onClick={()=>run('pause',{id:row.id})}/>:<Button label={['failed','cancelled'].includes(row.status)?'다시 시도':'다운로드 시작'} isIconOnly variant="ghost" icon={<Icon icon={['failed','cancelled'].includes(row.status)?ArrowPathIcon:PlayIcon}/>} onClick={()=>run(['failed','cancelled'].includes(row.status)?'retry':'start',{id:row.id})}/>}<Button label={row.status==='completed'?'완료 항목 삭제':'대기열에서 제거'} isIconOnly variant="ghost" icon={<Icon icon={XMarkIcon}/>} isDisabled={row.status==='completed'&&(sending||deleting)} onClick={()=>row.status==='completed'?requestDelete([row.id]):run('remove',{id:row.id})}/></HStack></HStack>}
            />)}</List>}</Stack>
          </>}
        </VStack></LayoutContent>}
        end={!['connection','settings'].includes(view)&&<LayoutPanel width="var(--snag-settings-width)" padding={6} hasDivider label="영상 품질 설정" role="complementary"><VStack gap={4}><HStack gap={2}><Icon icon={Cog6ToothIcon}/><Heading level={2} type="section-title">다운로드 설정</Heading></HStack>{item?<><VStack gap={2}><Text weight="semibold" maxLines={2}>{item.title}</Text></VStack><Quality options={item.options} formats={item.info?.formats||[]} disabled={['analyzing','queued','downloading','processing','completed'].includes(item.status)} onChange={options=>run('update',{id:item.id,options})}/><Divider/><HStack gap={2} vAlign="center"><Button label="순서 위로" isIconOnly icon={<Icon icon={ArrowUpIcon} style={{width:'var(--snag-icon-size-reorder)',height:'var(--snag-icon-size-reorder)'}}/>} onClick={()=>run('reorder',{id:item.id,direction:-1})}/><Button label="순서 아래로" isIconOnly icon={<Icon icon={ArrowDownIcon} style={{width:'var(--snag-icon-size-reorder)',height:'var(--snag-icon-size-reorder)'}}/>} onClick={()=>run('reorder',{id:item.id,direction:1})}/><Text type="supporting">대기열 순서</Text></HStack>{view==='queue'&&queueIds.length>0?<Button label={`선택한 ${queueIds.length}개 다운로드`} variant="primary" icon={<Icon icon={ArrowDownTrayIcon}/>} isLoading={batchAction==='start'} isDisabled={!!batchAction||status.engineReady===false} onClick={()=>downloadSelection(queueIds)}/>:item.status==='completed'?<Button label="저장한 파일 보기" icon={<Icon icon={FolderIcon}/>} onClick={()=>run('reveal',{id:item.id})}/>:<Button label={busy(item)?'작업 취소':'이 영상 다운로드'} variant={busy(item)?'secondary':'primary'} icon={<Icon icon={busy(item)?XMarkIcon:ArrowDownTrayIcon}/>} onClick={()=>run(busy(item)?'cancel':['failed','cancelled'].includes(item.status)?'retry':'start',{id:item.id})}/>}</>:<><Quality options={state.settings} onChange={patch=>run('settings',patch)}/></>}</VStack></LayoutPanel>}
        footer={<LayoutFooter padding={4}><HStack hAlign="between" vAlign="center" gap={4}><HStack gap={2} vAlign="center" style={{minWidth:0}}><Icon icon={FolderIcon} size="sm"/><Text type="supporting" maxLines={1}>{state.settings.directory}</Text><Button label="저장 폴더 변경" size="sm" variant="ghost" onClick={()=>run('pickDirectory')}><Text type="section-title">저장 폴더 변경</Text></Button></HStack><Text type="supporting">{active?labels[active.status]:'준비됨'} · 완료 {completed}개</Text></HStack></LayoutFooter>}/>
    </AppShell>
  </Stack>;
}
