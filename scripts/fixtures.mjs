import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {execFileSync} from 'node:child_process';

export async function fixtures(root=path.resolve('.test-artifacts/fixtures')) {
  fs.mkdirSync(root,{recursive:true});const ffmpeg=path.resolve('engine/ffmpeg.exe');
  for(const [name,width,height]of[['sample',320,180],['small',160,90]]){
    const file=path.join(root,`${name}.mp4`);
    if(!fs.existsSync(file))execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`testsrc2=size=${width}x${height}:rate=24`,'-f','lavfi','-i','sine=frequency=880:sample_rate=44100','-t','3','-c:v','libx264','-preset','ultrafast','-c:a','aac','-movflags','+faststart',file],{windowsHide:true});
    if(!fs.existsSync(path.join(root,`${name}.m3u8`)))execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',file,'-c','copy','-hls_time','1','-hls_list_size','0','-hls_segment_filename',path.join(root,`${name}-%03d.ts`),path.join(root,`${name}.m3u8`)],{windowsHide:true});
  }
  const webm=path.join(root,'sample.webm');
  const cover=path.join(root,'cover.png');
  if(!fs.existsSync(cover))execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',path.join(root,'sample.mp4'),'-frames:v','1',cover],{windowsHide:true});
  fs.writeFileSync(path.join(root,'cover.html'),'<!doctype html><html><title>Album art fixture</title><meta property="og:image" content="cover.png"><body><video controls src="sample.mp4" poster="cover.png"></video></body></html>');
  if(!fs.existsSync(webm))execFileSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-i',path.join(root,'sample.mp4'),'-c:v','libvpx-vp9','-deadline','realtime','-cpu-used','8','-c:a','libopus',webm],{windowsHide:true});
  fs.writeFileSync(path.join(root,'master.m3u8'),'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=320x180\nsample.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=150000,RESOLUTION=160x90\nsmall.m3u8\n');
  fs.writeFileSync(path.join(root,'index.html'),'<!doctype html><html lang="ko"><title>공개 영상 테스트</title><body><h1>snag local fixture</h1><video controls autoplay muted src="sample.mp4" width="640"></video><a href="sample.mp4">영상 링크</a></body></html>');
  fs.writeFileSync(path.join(root,'playlist.html'),'<!doctype html><html><title>Playlist fixture</title><body><video controls src="sample.mp4"></video><video controls src="small.mp4"></video></body></html>');
  const server=http.createServer((req,res)=>{
    const parsed=new URL(req.url,'http://local');const name=decodeURIComponent(parsed.pathname).replace(/^\//,'')||'index.html';
    const file=path.resolve(root,name);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
    const data=fs.readFileSync(file),ext=path.extname(file),type={'.mp4':'video/mp4','.webm':'video/webm','.m3u8':'application/vnd.apple.mpegurl','.ts':'video/mp2t','.html':'text/html','.png':'image/png'}[ext]||'application/octet-stream';
    let start=0,end=data.length-1;const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if(range){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end;}
    if(start>end){res.writeHead(416).end();return;}
    res.writeHead(range?206:200,{'Content-Type':type,'Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${data.length}`}:{})});
    if(req.method==='HEAD')res.end();else res.end(data.subarray(start,end+1));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return {root,url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(resolve=>server.close(resolve))};
}
