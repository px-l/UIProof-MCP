import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fixture} from './fixture.js';
import {capture} from '../src/capture.js';
import {configSchema} from '../src/config.js';
import {runProof,recheck} from '../src/runner.js';
const root=process.cwd(),app=await fixture();
try {
  await mkdir(path.join(root,'.uiproof','demo-baselines'),{recursive:true});
  const config=configSchema.parse({url:app.url,viewport:{width:1000,height:700},states:[{name:'dashboard',baseline:'.uiproof/demo-baselines/dashboard.png'},{name:'expanded',baseline:'.uiproof/demo-baselines/expanded.png',steps:[{action:'click',selector:'#create'}]}]});
  for(const s of config.states)await writeFile(path.join(root,s.baseline),(await capture(config,s)).screenshot);
  app.setBroken(true);const broken=await runProof(root,config);app.setBroken(false);const repaired=await recheck(root,broken.id);
  console.log(JSON.stringify({demo:'Seeded defects: missing card, wrong count, wrong button color',broken:broken.status,report:path.join(root,'.uiproof',broken.id,'index.html'),repaired:repaired.status,repairedReport:path.join(root,'.uiproof',repaired.id,'index.html')},null,2));
  if(broken.status!=='failed'||repaired.status!=='passed')process.exitCode=2;
} finally {await app.close();}
