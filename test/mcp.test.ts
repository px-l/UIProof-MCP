import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fixture} from '../examples/fixture.js';
import {capture} from '../src/capture.js';
import {configSchema} from '../src/config.js';
test('MCP stdio: discover tools, run job, read issues and image evidence, reject traversal',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'uiproof-mcp-')),app=await fixture();
  const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','src/mcp.ts','--root',root],stderr:'pipe'});
  const client=new Client({name:'integration-test',version:'1.0'});
  try {
    const config=configSchema.parse({url:app.url,viewport:{width:1000,height:700},states:[{name:'default',baseline:'baseline.png'}]});
    await writeFile(path.join(root,'baseline.png'),(await capture(config,config.states[0])).screenshot);
    await writeFile(path.join(root,'uiproof.json'),JSON.stringify(config));app.setBroken(true);
    await client.connect(transport);assert.ok((await client.listTools()).tools.some(t=>t.name==='uiproof_evidence'));
    const call=async(name:string,args:Record<string,unknown>)=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse((r.content as {text:string}[])[0].text);};
    const {jobId}=await call('uiproof_run',{});let job;
    for(let i=0;i<150;i++){job=await call('uiproof_status',{jobId});if(job.status!=='running')break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(job.status,'complete');const result=await call('uiproof_result',{runId:job.runId});assert.equal(result.status,'failed');
    const issues=await call('uiproof_issues',{runId:job.runId,state:'default'});assert.ok(issues.total>0);
    const evidence=await client.callTool({name:'uiproof_evidence',arguments:{runId:job.runId,state:'default',issueId:issues.issues[0].id,kind:'actual'}});
    assert.ok((evidence.content as {type:string}[]).some(c=>c.type==='image'));
    const invalid=await client.callTool({name:'uiproof_evidence',arguments:{runId:job.runId,state:'../',issueId:'../../secret',kind:'actual'}});assert.equal(invalid.isError,true);
  } finally {await client.close();await app.close();await rm(root,{recursive:true,force:true});}
});
