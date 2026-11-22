import {spawn} from 'node:child_process';
import path from 'node:path';
import {fixtures} from './fixtures.mjs';
const fixture=await fixtures();
try {
  const child=spawn(process.execPath,['scripts/rust.mjs','test','--no-default-features','--test','engine','--','--ignored','--nocapture'],{env:{...process.env,STREAMDROP_FIXTURE_URL:fixture.url,STREAMDROP_ENGINE_DIR:path.resolve('engine'),STREAMDROP_FIXTURE_OUTPUT:path.resolve('.test-artifacts/engine-output')},stdio:'inherit',windowsHide:true});
  process.exitCode=await new Promise(resolve=>child.on('exit',code=>resolve(code??1)));
}finally{await fixture.close();}
