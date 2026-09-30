#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import { loadConfig } from './config.js';
import { runProof, recheck } from './runner.js';
try {
  const {positionals,values}=parseArgs({allowPositionals:true,options:{root:{type:'string'},config:{type:'string'}}});
  const root=path.resolve(values.root??process.cwd());
  const command=positionals[0];
  if(command==='run'||command==='recheck') {
    const run=command==='run'?await runProof(root,await loadConfig(root,values.config??'uiproof.json')):await recheck(root,positionals[1]??'');
    console.log(JSON.stringify({id:run.id,status:run.status,report:path.join(root,'.uiproof',run.id,'index.html'),states:run.states},null,2));
    process.exitCode=run.status==='passed'?0:run.status==='failed'?1:2;
  } else { console.log('UIProof\n  uiproof run --config uiproof.json [--root directory]\n  uiproof recheck RUN_ID [--root directory]\nExit codes: 0 passed, 1 differences, 2 capture/configuration error.'); if(command&&command!=='help') process.exitCode=2; }
} catch(error) {console.error(error instanceof Error?error.message:String(error));process.exitCode=2;}
