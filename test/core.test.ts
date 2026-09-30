import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {configSchema} from '../src/config.js';
import {compare} from '../src/compare.js';
import {escapeHtml} from '../src/report.js';
const config=()=>configSchema.parse({url:'http://127.0.0.1',viewport:{width:100,height:100},maxDiffRatio:0,states:[{name:'default',baseline:'baseline.png'}]});
function png(change=false){const p=new PNG({width:100,height:100});p.data.fill(255);if(change)for(let y=30;y<50;y++)for(let x=20;x<40;x++)p.data.set([0,0,0,255],(y*100+x)*4);return PNG.sync.write(p);}
test('identical images pass, changed region has locatable evidence',async()=>{const c=config();assert.equal((await compare(png(),png(),c)).ratio,0);const r=await compare(png(),png(true),c);assert.equal(r.passed,false);assert.equal(r.diffPixels,400);assert.equal(r.boxes.length,1);assert.ok(r.boxes[0].x<=20&&r.boxes[0].y<=30);});
test('masks exclude identical regions from numerator and denominator',async()=>{const c=config();c.masks=[{x:20,y:30,width:20,height:20}];const r=await compare(png(),png(true),c);assert.equal(r.passed,true);assert.equal(r.ignoredPixels,400);});
test('alignment cannot hide uncovered edges',async()=>{const c=config();c.alignment={x:2,y:0};const r=await compare(png(),png(),c);assert.equal(r.diffPixels,200);assert.equal(r.passed,false);});
test('wrong dimensions reject instead of resizing',async()=>{const c=config();c.viewport.width=101;await assert.rejects(compare(png(),png(),c),/Dimension mismatch/);});
test('configuration rejects dangerous protocol, duplicate state and unknown keys',()=>{assert.throws(()=>configSchema.parse({...config(),url:'file:///etc/passwd'}));assert.throws(()=>configSchema.parse({...config(),states:[config().states[0],config().states[0]]}));assert.throws(()=>configSchema.parse({...config(),threshhold:0.2}));});
test('union of masks cannot cover all pixels',async()=>{const c=config();c.masks=[{x:0,y:0,width:50,height:100},{x:50,y:0,width:50,height:100}];await assert.rejects(compare(png(),png(),c),/entire viewport/);});
test('report escapes untrusted DOM content',()=>{assert.equal(escapeHtml('<script>"&'), '&lt;script&gt;&quot;&amp;');});
