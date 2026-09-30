import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixture} from '../examples/fixture.js';
import {configSchema} from '../src/config.js';
import {capture} from '../src/capture.js';
import {runProof,recheck} from '../src/runner.js';
test('real Chromium: two states, regression detection and immutable-baseline repair loop',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'uiproof-test-'));const app=await fixture();
  try {
    const config=configSchema.parse({url:app.url,viewport:{width:1000,height:700},maxDiffRatio:0,states:[{name:'default',baseline:'default.png'},{name:'expanded',baseline:'expanded.png',steps:[{action:'click',selector:'#create'}]}]});
    for(const state of config.states)await writeFile(path.join(root,state.baseline),(await capture(config,state)).screenshot);
    const pass=await runProof(root,config);assert.equal(pass.status,'passed');
    app.setBroken(true);const fail=await runProof(root,config);assert.equal(fail.status,'failed');assert.ok(fail.states.every(s=>s.issues.length>0));
    const html=await readFile(path.join(root,'.uiproof',fail.id,'index.html'),'utf8');assert.ok(html.includes('annotated.png'));assert.ok(html.includes('附近页面元素'));
    // Changing the input file cannot influence a recheck: use saved design bytes.
    await writeFile(path.join(root,'default.png'),'not an image');app.setBroken(false);
    const repaired=await recheck(root,fail.id);assert.equal(repaired.status,'passed');assert.ok(repaired.recheck);
    await writeFile(path.join(root,'.uiproof',fail.id,'default','baseline.source'),'tampered');await assert.rejects(recheck(root,fail.id),/modified/);
  } finally {await app.close();await rm(root,{recursive:true,force:true});}
});
