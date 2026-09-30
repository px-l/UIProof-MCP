import sharp from 'sharp';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import type { Config, Rect } from './config.js';
export async function normalize(input: Buffer): Promise<PNG> {
  return PNG.sync.read(await sharp(input, { limitInputPixels: 2560 * 2560 }).flatten({ background: '#fff' }).ensureAlpha().png().toBuffer());
}
export function regions(mask: PNG): Rect[] {
  // Connected occupied 16px tiles: bounded memory and no issue explosion for noisy backgrounds.
  const size = 16, cols = Math.ceil(mask.width / size), rows = Math.ceil(mask.height / size);
  const cells = new Uint8Array(cols * rows);
  for (let y=0;y<mask.height;y++) for(let x=0;x<mask.width;x++) if (mask.data[(y*mask.width+x)*4+3]) cells[Math.floor(y/size)*cols+Math.floor(x/size)] = 1;
  const result: Rect[]=[];
  for(let i=0;i<cells.length;i++) {
    if(!cells[i]) continue;
    const queue=[i]; cells[i]=0; let minX=cols,minY=rows,maxX=0,maxY=0;
    for(let j=0;j<queue.length;j++) {
      const n=queue[j], x=n%cols,y=Math.floor(n/cols);
      minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);
      for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
        const nx=x+dx,ny=y+dy,k=ny*cols+nx;
        if(nx>=0&&nx<cols&&ny>=0&&ny<rows&&cells[k]){cells[k]=0;queue.push(k);}
      }
    }
    result.push({x:minX*size,y:minY*size,width:Math.min(mask.width,(maxX+1)*size)-minX*size,height:Math.min(mask.height,(maxY+1)*size)-minY*size});
  }
  return result.sort((a,b)=>b.width*b.height-a.width*a.height);
}
export async function compare(expectedBuffer: Buffer, actualBuffer: Buffer, config: Config) {
  const expected=await normalize(expectedBuffer), original=await normalize(actualBuffer);
  const {width,height}=expected;
  if(width!==config.viewport.width||height!==config.viewport.height||original.width!==width||original.height!==height) throw new Error(`Dimension mismatch: design ${width}x${height}, page ${original.width}x${original.height}, viewport ${config.viewport.width}x${config.viewport.height}; resizing is never automatic`);
  const actual=new PNG({width,height}), invalid=new Uint8Array(width*height), ignored=new Uint8Array(width*height);
  // Alignment means moving the actual page by an explicit integer offset; uncovered pixels always fail.
  for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
    const sx=x-config.alignment.x,sy=y-config.alignment.y,i=y*width+x;
    if(sx<0||sy<0||sx>=width||sy>=height) {invalid[i]=1;actual.data.fill(255,i*4,i*4+4);}
    else original.data.copy(actual.data,i*4,(sy*width+sx)*4,(sy*width+sx)*4+4);
  }
  const e=Buffer.from(expected.data),a=Buffer.from(actual.data);
  for(const m of config.masks) for(let y=m.y;y<m.y+m.height;y++) for(let x=m.x;x<m.x+m.width;x++) ignored[y*width+x]=1;
  let ignoredPixels=0;
  for(let i=0;i<ignored.length;i++) if(ignored[i]) {ignoredPixels++;e.fill(255,i*4,i*4+4);a.fill(255,i*4,i*4+4);}
  if(ignoredPixels===width*height) throw new Error('Masks cover the entire viewport');
  const diff=new PNG({width,height});
  pixelmatch(e,a,diff.data,width,height,{threshold:config.threshold,includeAA:config.includeAA,diffMask:true});
  let diffPixels=0;
  for(let i=0;i<invalid.length;i++) {
    if(invalid[i]&&!ignored[i]) diff.data.set([255,0,0,255],i*4);
    if(diff.data[i*4+3]) diffPixels++;
  }
  const ratio=diffPixels/(width*height-ignoredPixels);
  return { expected:PNG.sync.write(expected),actual:PNG.sync.write(actual),diff:PNG.sync.write(diff),boxes:regions(diff),diffPixels,ignoredPixels,ratio,passed:ratio<=config.maxDiffRatio };
}
