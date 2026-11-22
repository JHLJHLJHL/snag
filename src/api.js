import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';

export const command=(action,payload={})=>invoke('command',{action,payload});
export const subscribe=callback=>listen('queue-changed',event=>callback(event.payload));
export const subscribePlaylist=callback=>listen('playlist-added',event=>callback(event.payload));
export function draggedInput(data){
  const text=data.getData('text/plain');
  if(text?.startsWith('streamdrop:')) return text;
  const uri=data.getData('text/uri-list');
  const link=(uri||'').split(/\r?\n/).find(l=>l&&!l.startsWith('#'));
  if(link)return link;
  if(text?.trim())return text.trim();
  const html=data.getData('text/html');
  if(html){const doc=new DOMParser().parseFromString(html,'text/html');const a=doc.querySelector('a[href]');if(a)return a.href;}
  throw new Error('영상 링크 또는 확장 프로그램의 영상 잡기 버튼을 끌어다 놓아 주세요.');
}
export function bytes(value){if(!Number.isFinite(value)||value<=0)return '용량 미확인';const units=['B','KB','MB','GB'];const n=Math.min(3,Math.floor(Math.log(value)/Math.log(1024)));return `${(value/1024**n).toFixed(n>1?1:0)} ${units[n]}`;}
export function duration(value){if(!Number.isFinite(value))return '길이 미확인';const v=Math.round(value);return v>=3600?`${Math.floor(v/3600)}:${String(Math.floor(v/60)%60).padStart(2,'0')}:${String(v%60).padStart(2,'0')}`:`${Math.floor(v/60)}:${String(v%60).padStart(2,'0')}`;}
