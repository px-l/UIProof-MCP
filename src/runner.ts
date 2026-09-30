import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { configSchema, confined, type Config, type Rect } from './config.js';
import { capture, type ElementEvidence } from './capture.js';
import { compare } from './compare.js';
import { report } from './report.js';
export interface Issue { id:string; title:string; severity:'warning'|'error'; box:Rect; elements:ElementEvidence[] }
export interface StateResult { name:string; status:'passed'|'failed'|'error'; baselineHash?:string; ratio?:number; diffPixels?:number; ignoredPixels?:number; issues:Issue[]; error?:string; capture?:Awaited<ReturnType<typeof capture>>['metadata'] }
export interface Run { version:1; id:string; status:'passed'|'failed'|'error'; startedAt:string; config:Config; states:StateResult[]; analysis?:unknown; recheck?:unknown }
export const hash=(b:Buffer|string)=>createHash('sha256').update(b).digest('hex');
export async function outputRoot(root:string) {
  const base=await realpath(root), out=path.join(base,'.uiproof');
  await mkdir(out,{recursive:true});
  if(await realpath(out)!==out) throw new Error('Output directory must not be a symlink');
  return out;
}
export async function readRun(root:string,id:string):Promise<{run:Run;dir:string}> {
  if(!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid run ID');
  const dir=await confined(await outputRoot(root),id);
  const run=JSON.parse(await readFile(await confined(dir,'run.json'),'utf8')) as Run;
  if(run.id!==id||run.version!==1) throw new Error('Invalid run manifest');
  return {run,dir};
}
export async function persist(dir:string,run:Run) {
  await writeFile(path.join(dir,'run.json'),JSON.stringify(run,null,2));
  await writeFile(path.join(dir,'index.html'),report(run));
}
export async function runProof(root:string,input:Config):Promise<Run> {
  root=await realpath(root);
  const config=configSchema.parse(input),id=randomUUID(),dir=path.join(await outputRoot(root),id);
  await mkdir(dir);
  const run:Run={version:1,id,status:'error',startedAt:new Date().toISOString(),config,states:[]};
  for(const state of config.states) {
    const out=path.join(dir,state.name);await mkdir(out);
    const result:StateResult={name:state.name,status:'error',issues:[]};run.states.push(result);
    try {
      const baseline=await readFile(await confined(root,state.baseline));
      result.baselineHash=hash(baseline);
      await writeFile(path.join(out,'baseline.source'),baseline);
      const captured=await capture(config,state);result.capture=captured.metadata;
      await writeFile(path.join(out,'raw.png'),captured.screenshot);
      const diff=await compare(baseline,captured.screenshot,config);
      result.ratio=diff.ratio;result.diffPixels=diff.diffPixels;result.ignoredPixels=diff.ignoredPixels;result.status=diff.passed?'passed':'failed';
      for(const [file,data] of Object.entries({expected:diff.expected,actual:diff.actual,diff:diff.diff})) await writeFile(path.join(out,file+'.png'),data);
      // Limit detailed crops, but retain all changed pixels and explicitly group the overflow region.
      const boxes=diff.boxes.slice(0,99);
      if(diff.boxes.length>99) {
        const rest=diff.boxes.slice(99),x=Math.min(...rest.map(b=>b.x)),y=Math.min(...rest.map(b=>b.y));
        boxes.push({x,y,width:Math.max(...rest.map(b=>b.x+b.width))-x,height:Math.max(...rest.map(b=>b.y+b.height))-y});
      }
      for(const [index,box] of boxes.entries()) {
        const issue:Issue={id:`issue-${String(index+1).padStart(3,'0')}`,title:index===99?'Remaining difference regions (grouped)':'Visual difference',severity:diff.passed?'warning':'error',box,elements:captured.elements.map(e=>({...e,box:{...e.box,x:e.box.x+config.alignment.x,y:e.box.y+config.alignment.y}})).filter(e=>e.box.x<box.x+box.width&&e.box.x+e.box.width>box.x&&e.box.y<box.y+box.height&&e.box.y+e.box.height>box.y).sort((a,b)=>a.box.width*a.box.height-b.box.width*b.box.height).slice(0,8)};
        result.issues.push(issue);
        for(const [kind,data] of Object.entries({expected:diff.expected,actual:diff.actual,diff:diff.diff})) await sharp(data).extract({left:box.x,top:box.y,width:box.width,height:box.height}).png().toFile(path.join(out,`${issue.id}-${kind}.png`));
      }
      const overlay=Buffer.from(`<svg width="${config.viewport.width}" height="${config.viewport.height}">${boxes.map((b,i)=>`<rect x="${b.x+1}" y="${b.y+1}" width="${Math.max(1,b.width-2)}" height="${Math.max(1,b.height-2)}" fill="#ef444422" stroke="#ef4444" stroke-width="2"/><text x="${b.x+4}" y="${b.y+14}" fill="#a00" font-size="12">${i+1}</text>`).join('')}</svg>`);
      await sharp(diff.actual).composite([{input:overlay}]).png().toFile(path.join(out,'annotated.png'));
    } catch(error) {result.status='error';result.error=error instanceof Error?error.message:String(error);}
  }
  run.status=run.states.some(s=>s.status==='error')?'error':run.states.some(s=>s.status==='failed')?'failed':'passed';
  await persist(dir,run);return run;
}
export async function recheck(root:string,id:string) {
  root=await realpath(root);
  const {run:previous,dir}=await readRun(root,id);
  if(previous.states.some(s=>!s.baselineHash)) throw new Error('Previous run has no complete baseline snapshots');
  const config=structuredClone(previous.config);
  for(const state of config.states) {
    const file=await confined(dir,`${state.name}/baseline.source`),baseline=await readFile(file);
    if(hash(baseline)!==previous.states.find(s=>s.name===state.name)?.baselineHash) throw new Error('Baseline snapshot was modified');
    state.baseline=path.relative(root,file);
  }
  const run=await runProof(root,config);
  run.recheck={previousRunId:id,states:run.states.map(s=>{const before=previous.states.find(p=>p.name===s.name)!;return {name:s.name,before:before.status,after:s.status,ratioBefore:before.ratio,ratioAfter:s.ratio,improved:s.ratio!==undefined&&before.ratio!==undefined?s.ratio<before.ratio:null,environmentChanged:JSON.stringify({...before.capture,capturedAt:undefined,attempts:undefined})!==JSON.stringify({...s.capture,capturedAt:undefined,attempts:undefined})};})};
  await persist(path.join(await outputRoot(root),run.id),run);return run;
}
