import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import assert from 'node:assert/strict';

const project=path.resolve('.'),version=JSON.parse(fs.readFileSync('package.json')).version;
const name=`SNAG-${version}-beta-windows-x64`,directory=path.resolve('release/distribution');
const archive=path.join(directory,`${name}.zip`);
async function sha(file){const value=createHash('sha256');for await(const chunk of fs.createReadStream(file))value.update(chunk);return value.digest('hex');}
const expected=fs.readFileSync(path.join(directory,'SHA256SUMS.txt'),'utf8').trim().split(/\s+/);
assert.equal(expected[1],path.basename(archive));assert.equal(await sha(archive),expected[0]);
const extracted=fs.mkdtempSync(path.join(os.tmpdir(),'SNAG 배포 검증 '));
const outside=path.relative(project,extracted);
assert.ok(path.isAbsolute(outside)||outside==='..'||outside.startsWith('..'+path.sep),'The distribution test must run outside the project');
const extractEnv={...process.env,SNAG_DISTRIBUTION_ZIP:archive,SNAG_DISTRIBUTION_TARGET:extracted};delete extractEnv.PSModulePath;
execFileSync('powershell.exe',['-NoProfile','-Command',"Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::ExtractToDirectory($env:SNAG_DISTRIBUTION_ZIP,$env:SNAG_DISTRIBUTION_TARGET)"],{env:extractEnv,windowsHide:true,stdio:'inherit'});
const root=path.join(extracted,name),manifest=JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8'));
const allowed=new Set(['release.json',...manifest.files.map(file=>file.path)]);
function walk(directory,prefix=''){
  for(const entry of fs.readdirSync(directory,{withFileTypes:true})){
    const relative=prefix+entry.name;
    if(entry.isDirectory())walk(path.join(directory,entry.name),relative+'/');
    else assert.ok(allowed.has(relative),`Unexpected file in distribution: ${relative}`);
  }
}
walk(root);
for(const entry of manifest.files){
  const file=path.resolve(root,entry.path),relative=path.relative(root,file);
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative));
  assert.ok(!/(^|\/)(queue\.json|bridge\.json|native-host\.json|node_modules|\.git)(\/|$)/.test(entry.path));
  assert.equal(fs.statSync(file).size,entry.size,entry.path);assert.equal(await sha(file),entry.sha256,entry.path);
}
assert.equal(manifest.executable,'SNAG(beta).exe');
console.log(`PASS: extracted distribution outside project; verified ${allowed.size} files and ZIP checksum`);

// A marker proves that the app uses the extracted engine rather than the source tree.
const versionFile=path.join(root,'engine/versions.json'),original=fs.readFileSync(versionFile,'utf8');
const marker='isolated-distribution-engine';fs.writeFileSync(versionFile,JSON.stringify({...JSON.parse(original),distributionTestMarker:marker}));
const env={...process.env,STREAMDROP_BINARY:path.join(root,manifest.executable),STREAMDROP_BUNDLED_TEST:'1',STREAMDROP_EXPECT_ENGINE_MARKER:marker};delete env.STREAMDROP_ENGINE_DIR;
try{
  const child=spawn(process.execPath,['scripts/smoke.mjs'],{env,stdio:'inherit',windowsHide:true});
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});assert.equal(code,0,'Extracted application smoke test');
}finally{fs.writeFileSync(versionFile,original);}
const result={passed:true,version,applicationSourceCommit:manifest.applicationSourceCommit,zipSha256:expected[0],filesVerified:allowed.size,extractedOutsideProject:true,bundledEngineVerified:true};
fs.writeFileSync(path.join(directory,'verification.json'),JSON.stringify(result,null,2)+'\n');
fs.writeFileSync('.test-artifacts/distribution-verification.json',JSON.stringify({...result,extractedRoot:root},null,2)+'\n');
console.log('PASS: extracted SNAG runs with its bundled engines, native bridge and MP4/MP3 downloads');
