import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {unzipSync} from 'fflate';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const dir=path.join(root,'engine');fs.mkdirSync(dir,{recursive:true});
function get(url) {
  return execFileSync('curl.exe',['--fail','--location','--ssl-revoke-best-effort','--silent','--show-error',url],{maxBuffer:300*1024*1024,windowsHide:true});
}
function save(file,bytes){fs.writeFileSync(path.join(dir,file),bytes);console.log(`Prepared ${file} (${(bytes.length/1024/1024).toFixed(1)} MB)`);}
if(process.platform!=='win32') throw new Error('This engine setup currently targets Windows x64.');
const release=JSON.parse(get('https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'));
const base=`https://github.com/yt-dlp/yt-dlp/releases/download/${release.tag_name}`;
if(!fs.existsSync(path.join(dir,'yt-dlp.exe'))) {
  const bytes=get(`${base}/yt-dlp.exe`);
  const checksums=get(`${base}/SHA2-256SUMS`).toString();
  const expected=checksums.split(/\r?\n/).find(l=>/\s\*?yt-dlp\.exe$/.test(l))?.split(/\s+/)[0];
  if(!expected||createHash('sha256').update(bytes).digest('hex')!==expected) throw new Error('yt-dlp SHA256 verification failed');
  save('yt-dlp.exe',bytes);
}
let ffmpegPath;
try {ffmpegPath=execFileSync('where.exe',['ffmpeg.exe'],{encoding:'utf8',windowsHide:true}).trim().split(/\r?\n/)[0];}catch{}
if(!fs.existsSync(path.join(dir,'ffmpeg.exe'))) {
  if(ffmpegPath&&fs.existsSync(path.join(path.dirname(ffmpegPath),'ffprobe.exe'))) {
    for(const name of ['ffmpeg.exe','ffprobe.exe']) fs.copyFileSync(path.join(path.dirname(ffmpegPath),name),path.join(dir,name));
    console.log('Prepared FFmpeg and FFprobe from the installed toolchain');
  } else {
    console.log('Downloading the yt-dlp recommended FFmpeg build…');
    const archive=unzipSync(get('https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip'),{filter:file=>/\/(ffmpeg|ffprobe)\.exe$/.test(file.name)});
    for(const [name,bytes] of Object.entries(archive)) save(path.basename(name),bytes);
  }
}
if(!fs.existsSync(path.join(dir,'deno.exe'))) {
  const archive=unzipSync(get('https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip'));
  save('deno.exe',archive['deno.exe']);
}
fs.writeFileSync(path.join(dir,'versions.json'),JSON.stringify({ytDlp:execFileSync(path.join(dir,'yt-dlp.exe'),['--version'],{encoding:'utf8',windowsHide:true}).trim(),ffmpeg:execFileSync(path.join(dir,'ffmpeg.exe'),['-version'],{encoding:'utf8',windowsHide:true}).split('\n')[0],deno:execFileSync(path.join(dir,'deno.exe'),['--version'],{encoding:'utf8',windowsHide:true}).split('\n')[0]},null,2));
for(const [name,url]of[
  ['YTDLP-LICENSE.txt',`https://raw.githubusercontent.com/yt-dlp/yt-dlp/${release.tag_name}/LICENSE`],
  ['YTDLP-THIRD-PARTY.txt',`https://raw.githubusercontent.com/yt-dlp/yt-dlp/${release.tag_name}/THIRD_PARTY_LICENSES.txt`],
  ['DENO-LICENSE.txt','https://raw.githubusercontent.com/denoland/deno/main/LICENSE.md']
]) if(!fs.existsSync(path.join(dir,name)))save(name,get(url));
fs.writeFileSync(path.join(dir,'FFMPEG-LICENSE.txt'),execFileSync(path.join(dir,'ffmpeg.exe'),['-L'],{encoding:'utf8',windowsHide:true}));
console.log('Download engine is ready.');
