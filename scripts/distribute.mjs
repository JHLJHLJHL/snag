import fs from 'node:fs';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {Zip,ZipDeflate} from 'fflate';

// Repackage the already built release. Do not rebuild or read a user's app data.
const version=JSON.parse(fs.readFileSync('package.json')).version;
const name=`SNAG-${version}-beta-windows-x64`;
const original=path.resolve('release',`snag-${version}-windows-x64`);
const destination=path.resolve('release/distribution');
const folder=path.join(destination,name),cache=path.resolve('.test-artifacts/distribution-vendor');
fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(cache,{recursive:true});
const entries=[];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function write(relative,bytes){
  assert.ok(!relative.split('/').includes('..'));
  const file=path.join(folder,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,bytes);
  entries.push({path:relative,size:Buffer.byteLength(bytes),sha256:hash(bytes)});
}
const copy=(relative,source)=>write(relative,fs.readFileSync(source));
function fetchFile(name,url){
  const target=path.join(cache,name);
  if(!fs.existsSync(target)){
    const temporary=target+'.download';
    execFileSync('curl.exe',['--fail','--location','--ssl-revoke-best-effort','--silent','--show-error','--max-time','180','--output',temporary,url],{windowsHide:true});
    assert.ok(fs.statSync(temporary).size>0,`${name} is empty`);fs.renameSync(temporary,target);
  }
  assert.ok(fs.statSync(target).size>0,`${name} is empty`);return target;
}
function noticeFiles(directory){return fs.readdirSync(directory).filter(name=>/^(licen[cs]e|copying|notice|copyright|unlicense)([._-]|$)/i.test(name)&&fs.statSync(path.join(directory,name)).isFile());}
const resources={
  'ASTRYX-LICENSE.txt':'https://raw.githubusercontent.com/meta/astryx/main/LICENSE',
  'STYLEX-LICENSE.txt':'https://raw.githubusercontent.com/facebook/stylex/main/LICENSE',
  'ALLOC-STDLIB-LICENSE.txt':'https://raw.githubusercontent.com/dropbox/rust-alloc-no-stdlib/0a81fd6928ea3b33c8cd484aa4575d50ffb98012/LICENSE',
  'WEBVIEW2-COM-LICENSE.txt':'https://raw.githubusercontent.com/wravery/webview2-rs/edc2caf886175ccaebe86078c9cfe1ae2a187328/LICENSE',
  'WEBVIEW2-MACROS-LICENSE.txt':'https://raw.githubusercontent.com/wravery/webview2-rs/dffa41a8a46d3f5565eefbff2de57d38d399f158/LICENSE',
  'MPL-2.0.txt':'https://www.mozilla.org/media/MPL/2.0/index.txt',
  'V8-LICENSE.txt':'https://raw.githubusercontent.com/v8/v8/15.0.245.2/LICENSE',
  'TYPESCRIPT-LICENSE.txt':'https://raw.githubusercontent.com/microsoft/TypeScript/v6.0.3/LICENSE.txt',
};
for(const [file,url]of Object.entries(resources))fetchFile(file,url);

const executable=path.join(original,'SNAG(beta).exe');
assert.deepEqual(fs.readFileSync(executable),fs.readFileSync('src-tauri/target/release/snag.exe'),'Package the current release first');
copy('SNAG(beta).exe',executable);
const engineFiles=['yt-dlp.exe','ffmpeg.exe','ffprobe.exe','deno.exe','versions.json','YTDLP-LICENSE.txt','YTDLP-THIRD-PARTY.txt','DENO-LICENSE.txt','FFMPEG-LICENSE.txt'];
for(const file of engineFiles)copy(`engine/${file}`,path.join(original,'engine',file));
const extensionFiles=['manifest.json','identity.json','background.js','content.js','popup.html','popup.css','popup.js','icon.png'];
for(const file of extensionFiles)copy(`extension/${file}`,path.join(original,'extension',file));
write('처음_읽어주세요.txt','\ufeff'+fs.readFileSync('docs/distribution/START_HERE.ko.txt','utf8'));
copy('RELEASE_NOTES.md','docs/distribution/RELEASE_NOTES.ko.md');copy('THIRD_PARTY.md','THIRD_PARTY.md');

const versions=JSON.parse(fs.readFileSync(path.join(original,'engine/versions.json'),'utf8'));
assert.ok(versions.ffmpeg.startsWith('ffmpeg version 9.0.2-full_build-www.gyan.dev'),'Update the pinned FFmpeg source before distributing a different engine');
const ffmpegSource=fetchFile('ffmpeg-9.0.2.tar.xz','https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz');
assert.equal(execFileSync('tar.exe',['-xOf',ffmpegSource,'ffmpeg-9.0.2/RELEASE'],{encoding:'utf8',windowsHide:true}).trim(),'9.0.2');
copy('source/ffmpeg-9.0.2.tar.xz',ffmpegSource);
write('licenses/FFMPEG-GPL-3.0.txt',execFileSync('tar.exe',['-xOf',ffmpegSource,'ffmpeg-9.0.2/COPYING.GPLv3'],{windowsHide:true}));
const build=spawnSync(path.join(original,'engine/ffmpeg.exe'),['-buildconf'],{encoding:'utf8',windowsHide:true});
assert.equal(build.status,0);write('licenses/FFMPEG-BUILD.txt',build.stdout+build.stderr);
const vendorReadme=path.join(cache,'FFMPEG-DISTRIBUTOR-README.txt');
if(fs.existsSync(vendorReadme))copy('licenses/FFMPEG-DISTRIBUTOR-README.txt',vendorReadme);
else write('licenses/FFMPEG-DISTRIBUTOR-README.txt','FFmpeg 9.0.2 full build by Gyan Doshi\nLicense: GPL v3 or later\nBinary release: https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2\nCore source revision: https://github.com/FFmpeg/FFmpeg/commit/946fcce07b\nSee FFMPEG-BUILD.txt for the configuration and external libraries.\n');
copy('licenses/DENO-V8-LICENSE.txt',path.join(cache,'V8-LICENSE.txt'));copy('licenses/DENO-TYPESCRIPT-LICENSE.txt',path.join(cache,'TYPESCRIPT-LICENSE.txt'));

const npm=JSON.parse(fs.readFileSync('package-lock.json','utf8'));let npmNotices='SNAG JavaScript dependency notices\n';
const npmFallback={'@astryxdesign/core':'ASTRYX-LICENSE.txt','@stylexjs/stylex':'STYLEX-LICENSE.txt'};
for(const [directory,entry]of Object.entries(npm.packages).filter(([directory,entry])=>directory&&!entry.dev)){
  const pkg=JSON.parse(fs.readFileSync(path.join(directory,'package.json'),'utf8'));const files=noticeFiles(directory);
  npmNotices+=`\n\n=== ${pkg.name} ${pkg.version} ===\nLicense: ${typeof pkg.license==='string'?pkg.license:JSON.stringify(pkg.license)}\n`;
  assert.ok(files.length||npmFallback[pkg.name],`Missing npm notice: ${pkg.name}`);
  for(const file of files)npmNotices+=`\n--- ${file} ---\n${fs.readFileSync(path.join(directory,file),'utf8')}\n`;
  if(!files.length)npmNotices+=fs.readFileSync(path.join(cache,npmFallback[pkg.name]),'utf8')+'\n';
}
write('licenses/JAVASCRIPT-NOTICES.txt',npmNotices);
const metadataRun=spawnSync(process.execPath,['scripts/rust.mjs','metadata','--format-version','1','--locked','--offline','--filter-platform','x86_64-pc-windows-msvc'],{encoding:'utf8',maxBuffer:32*1024*1024,windowsHide:true});
assert.equal(metadataRun.status,0,metadataRun.stderr);const metadata=JSON.parse(metadataRun.stdout);
const rustFallback={'alloc-stdlib':'ALLOC-STDLIB-LICENSE.txt','selectors':'MPL-2.0.txt','webview2-com':'WEBVIEW2-COM-LICENSE.txt','webview2-com-sys':'WEBVIEW2-COM-LICENSE.txt','webview2-com-macros':'WEBVIEW2-MACROS-LICENSE.txt'};
const rustSources=[];let rustNotices='SNAG Rust dependency notices\nIncludes resolved Windows dependencies and build dependencies.\n';
for(const pkg of metadata.packages.filter(pkg=>pkg.name!=='snag').sort((a,b)=>a.name.localeCompare(b.name))){
  const directory=path.dirname(pkg.manifest_path),files=noticeFiles(directory);
  rustNotices+=`\n\n=== ${pkg.name} ${pkg.version} ===\nLicense: ${pkg.license||'See package source'}\nSource: ${pkg.repository||`https://crates.io/crates/${pkg.name}/${pkg.version}`}\n`;
  assert.ok(files.length||rustFallback[pkg.name],`Missing Rust notice: ${pkg.name}`);
  for(const file of files)rustNotices+=`\n--- ${file} ---\n${fs.readFileSync(path.join(directory,file),'utf8')}\n`;
  if(!files.length)rustNotices+=fs.readFileSync(path.join(cache,rustFallback[pkg.name]),'utf8')+'\n';
  if((pkg.license||'').includes('MPL-2.0')){
    const crate=`${pkg.name}-${pkg.version}.crate`;
    const source=path.join(path.resolve(directory,'../../..'),'cache',path.basename(path.dirname(directory)),crate);
    assert.ok(fs.existsSync(source),`Missing source crate: ${crate}`);copy(`source/rust/${crate}`,source);
    rustSources.push(`- ${pkg.name} ${pkg.version}: source/rust/${crate} · https://crates.io/crates/${pkg.name}/${pkg.version}`);
  }
}
write('licenses/RUST-NOTICES.txt',rustNotices);
write('SOURCE_LINKS.md',`# Included engine and component sources\n\n- FFmpeg 9.0.2 core: source/ffmpeg-9.0.2.tar.xz\n- FFmpeg source revision identified by the binary distributor: https://github.com/FFmpeg/FFmpeg/commit/946fcce07b\n- Binary distributor and external-library details: https://github.com/GyanD/codexffmpeg/releases/tag/9.0.2 and licenses/FFMPEG-DISTRIBUTOR-README.txt\n- FFmpeg build configuration: licenses/FFMPEG-BUILD.txt\n- FFmpeg licensing information: https://ffmpeg.org/legal.html\n- yt-dlp ${versions.ytDlp}: https://github.com/yt-dlp/yt-dlp/releases/tag/${versions.ytDlp}\n- Deno 2.9.8: https://github.com/denoland/deno/releases/tag/v2.9.8\n\n## MPL-2.0 component source archives\n\n${rustSources.join('\n')}\n\nFFmpeg's core source archive is provided separately from the external libraries listed in the distributor's build configuration. Retain the engine notices and source references when redistributing the package.\n`);

const bootstrapper=fetchFile('MicrosoftEdgeWebview2Setup.exe','https://go.microsoft.com/fwlink/p/?LinkId=2124703');
const signatureEnv={...process.env,SNAG_DISTRIBUTION_BOOTSTRAPPER:bootstrapper};delete signatureEnv.PSModulePath;
const signature=execFileSync('powershell.exe',['-NoProfile','-Command',"$distributionSignature=Get-AuthenticodeSignature -LiteralPath $env:SNAG_DISTRIBUTION_BOOTSTRAPPER; if ($distributionSignature.Status -ne 'Valid' -or $distributionSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'WebView2 bootstrapper signature verification failed' }; 'Verified Microsoft signature'"],{env:signatureEnv,encoding:'utf8',windowsHide:true});
assert.ok(signature.includes('Verified Microsoft signature'));copy('install/MicrosoftEdgeWebview2Setup.exe',bootstrapper);
const commit=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim();
write('release.json',JSON.stringify({product:'SNAG',version,channel:'beta',platform:'windows',architecture:'x64',releaseDate:'2026-11-22',applicationSourceCommit:commit,executable:'SNAG(beta).exe',engines:versions,files:entries},null,2)+'\n');

const archive=path.join(destination,`${name}.zip`),stream=fs.createWriteStream(archive);
const finished=new Promise((resolve,reject)=>{stream.on('finish',resolve);stream.on('error',reject);});
const zip=new Zip((error,bytes,final)=>{if(error)stream.destroy(error);else{stream.write(bytes);if(final)stream.end();}});
for(const entry of entries){const file=new ZipDeflate(`${name}/${entry.path}`,{level:3});zip.add(file);file.push(fs.readFileSync(path.join(folder,entry.path)),true);}
zip.end();await finished;
const archiveHash=hash(fs.readFileSync(archive));
fs.writeFileSync(path.join(destination,'SHA256SUMS.txt'),`${archiveHash}  ${path.basename(archive)}\n`);
fs.copyFileSync('docs/distribution/RELEASE_NOTES.ko.md',path.join(destination,'RELEASE_NOTES.md'));
fs.writeFileSync(path.join(destination,'배포_안내.txt'),'\ufeff'+`배포 파일: ${path.basename(archive)}\n\nZIP 전체를 전달하세요. 받는 사람은 압축을 전부 풀고 SNAG(beta).exe를 실행합니다.\n실행 안내, 엔진, 확장 프로그램, WebView2 설치 파일, 라이선스와 소스 자료가 ZIP에 포함되어 있습니다.\n\nSHA256: ${archiveHash}\n\nZIP을 다시 수정하면 체크섬을 새로 만들어야 합니다.\n공개 게시 전에는 THIRD_PARTY.md와 SOURCE_LINKS.md의 공급자 조건을 확인하고 관련 자료를 함께 보관하세요.\nFFmpeg 코어 소스와 외부 라이브러리 소스는 구분되어 있습니다.\n현재 앱의 실행 파일은 코드 서명 인증서로 서명되지 않은 베타 빌드입니다.\n`);
console.log(`Distribution ZIP: ${archive}\nSize: ${(fs.statSync(archive).size/1024/1024).toFixed(1)} MB\nFiles: ${entries.length}\nSHA256: ${archiveHash}`);
