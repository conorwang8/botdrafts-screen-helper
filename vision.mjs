import sharp from 'sharp';
import {createWorker,PSM} from 'tesseract.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {locateDraftLayout,shiftRegions} from './layout.mjs';

export const WIDTH=1170;
export const REGIONS={
  mine:[ [0,.115,.115,.190],[0,.307,.115,.190],[0,.499,.115,.190] ],
  enemy:[ [.028,.754,.071,.158],[.116,.754,.071,.158],[.204,.754,.071,.158] ],
  bans:[ [.265,.134,.046,.105],[.256,.322,.046,.105],[.250,.513,.046,.105],
         [.040,.874,.049,.108],[.126,.872,.049,.108],[.213,.874,.049,.108] ],
  checks:{mine:[[.286,.24,.027,.055],[.280,.432,.027,.055],[.273,.625,.027,.055]],
          enemy:[[.086,.868,.024,.050],[.174,.868,.024,.050],[.262,.868,.024,.050]]}
};
const normalize=s=>String(s).toUpperCase().replace(/[^A-Z0-9]/g,'');
export function distance(a,b){
  const d=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){let prev=d[0];d[0]=i;for(let j=1;j<=b.length;j++){const old=d[j];d[j]=Math.min(d[j]+1,d[j-1]+1,prev+(a[i-1]!==b[j-1]));prev=old;}}
  return d[b.length];
}
export function mapFromText(text,maps){
 const value=normalize(text);let best=null;
 for(const map of maps){const q=normalize(map);let score=value.includes(q)?1:0;
  if(!score) for(let i=0;i<=Math.max(0,value.length-q.length+2);i++)for(const len of [q.length-1,q.length,q.length+1]){if(len<3)continue;const part=value.slice(i,i+len);score=Math.max(score,1-distance(part,q)/q.length);}
  if(!best||score>best.score)best={map,score};
 }
 return best&&best.score>=.80?best:null;
}
function rect(r,w,h){return {left:Math.max(0,Math.round(r[0]*w)),top:Math.max(0,Math.round(r[1]*h)),width:Math.max(1,Math.round(r[2]*w)),height:Math.max(1,Math.round(r[3]*h))};}
async function textMask(image,region,w,h,height=90,yellow=false){
 const {data,info}=await sharp(image).extract(rect(region,w,h)).resize({height}).removeAlpha().raw().toBuffer({resolveWithObject:true});
 for(let i=0;i<data.length;i+=3){const R=data[i],G=data[i+1],B=data[i+2];const on=Math.min(R,G,B)>190||(yellow&&R>190&&G>155&&B<125);const v=on?0:255;data[i]=v;data[i+1]=v;data[i+2]=v;}
 return sharp(data,{raw:info}).png().toBuffer();
}
function greenRatio(raw,w,h,r){const a=rect(r,w,h);let yes=0,n=0;for(let y=a.top;y<Math.min(h,a.top+a.height);y++)for(let x=a.left;x<Math.min(w,a.left+a.width);x++){const i=(y*w+x)*3,R=raw[i],G=raw[i+1],B=raw[i+2];n++;if(G>135&&G>R*1.7&&G>B*1.5&&R<130)yes++;}return yes/Math.max(1,n);}
function texture(raw,w,h,region){const r=rect(region,w,h);let sum=0,sum2=0,n=0;for(let y=r.top;y<Math.min(h,r.top+r.height);y+=2)for(let x=r.left;x<Math.min(w,r.left+r.width);x+=2){const i=(y*w+x)*3;const v=Math.max(raw[i],raw[i+1],raw[i+2]);sum+=v;sum2+=v*v;n++;}return Math.sqrt(Math.max(0,sum2/n-(sum/n)**2));}
function banBadge(raw,w,h,region){const [x,y,rw,rh]=region;const r=rect([x+rw*.55,y+rh*.53,rw*.60,rh*.60],w,h);let red=0,n=0;for(let yy=r.top;yy<Math.min(h,r.top+r.height);yy++)for(let xx=r.left;xx<Math.min(w,r.left+r.width);xx++){const i=(yy*w+xx)*3;n++;if(raw[i]>220&&raw[i+1]<75&&raw[i+2]<75)red++;}return red/Math.max(n,1);}
function portraitSignature(raw,w,h,region){
 const r=rect(region,w,h),values=[];
 for(let y=1;y<16;y++)for(let x=1;x<13;x++){
  const sx=Math.round(r.left+r.width*x/16),sy=Math.round(r.top+r.height*y/16),i=(sy*w+sx)*3;
  values.push(raw[i],raw[i+1],raw[i+2]);
 }
 return values;
}
function samePortrait(a,b){let total=0,max=0;for(let i=0;i<a.length;i++){const d=Math.abs(a[i]-b[i]);total+=d;max=Math.max(max,d);}return max<10&&total/a.length<.65;}
// Transparent ban pins: compare only visible artwork, excluding the lower-right ban badge.
async function pinTemplates(root,catalog){
 const result=[];
 for(const [name,file]of Object.entries(catalog.emoji)){
  const source=await fs.readFile(path.join(root,file));const meta=await sharp(source).metadata();
  const variants=[];
  for(const height of [32,36,40,44,48,52,56]){
   const width=Math.round(height*meta.width/meta.height);
   const {data}=await sharp(source).ensureAlpha().resize(width,height).blur(.7).raw().toBuffer({resolveWithObject:true});
   const points=[];
   for(let y=2;y<height-2;y+=3)for(let x=2;x<width-2;x+=3){const i=(y*width+x)*4;if(data[i+3]<240||x>width*.57&&y>height*.48)continue;points.push([x,y,data[i],data[i+1],data[i+2]]);}
   variants.push({width,height,points});
  }
  result.push({name,variants});
 }
 return result;
}
export function matchPin(raw,w,h,region,templates){
 const r=rect(region,w,h),rank=[];
 for(const t of templates){let best=1e9,bbox=null;
  for(const v of t.variants){
   const cx=r.left+r.width/2-v.width/2,cy=r.top+r.height/2-v.height/2;
   for(let dy=-6;dy<=6;dy+=3)for(let dx=-6;dx<=6;dx+=3){let loss=0,n=0;const ox=Math.round(cx+dx),oy=Math.round(cy+dy);
    for(const [x,y,R,G,B]of v.points){const sx=ox+x,sy=oy+y;if(sx<0||sy<0||sx>=w||sy>=h)continue;const i=(sy*w+sx)*3;const dr=raw[i]-R,dg=raw[i+1]-G,db=raw[i+2]-B;loss+=dr*dr+dg*dg+db*db;n+=3;}
    loss/=Math.max(n,1);if(loss<best){best=loss;bbox=[ox/w,oy/h,v.width/w,v.height/h];}
   }
  }
  rank.push({name:t.name,error:Math.sqrt(best),box:bbox});
 }
 rank.sort((a,b)=>a.error-b.error);
 const top=rank[0];return {...top,score:Math.max(0,1-top.error/120),margin:rank[1].error-top.error,alternatives:rank.slice(0,3)};
}

async function portraitTemplates(root,catalog){
 const list=[];
 for(const [name,file]of Object.entries(catalog.portraits)){
  const data=await sharp(path.join(root,file)).resize(32,32).removeAlpha().raw().toBuffer();list.push({name,data});
 }
 return list;
}
export async function matchPortrait(image,region,templates){
 const {data:raw,info}=await sharp(image).removeAlpha().blur(1.15).raw().toBuffer({resolveWithObject:true});
 const r=rect(region,info.width,info.height),blue=region[2]>.09;
 const rank=[];
 // The team slot is slanted and partially covered; middle/top pixels carry most identity.
 for(const t of templates){rank.push({name:t.name,error:1e9});}
 function loss(target,size,dx,dy){
  const ox=r.left+dx,oy=r.top+dy;let error=0,n=0;
  for(let y=2;y<30;y+=2)for(let x=2;x<29;x+=2){
   const sx=Math.round(ox+x/32*size),sy=Math.round(oy+y/32*size);
   if(sx<r.left+2||sy<r.top+2||sx>r.left+r.width*.88||sy>r.top+r.height-3)continue;
   if(blue&&sx<r.left+27&&sy<r.top+36)continue;
   if(!blue&&x>22&&y<10||!blue&&x>22&&y>24)continue;
   const i=(y*32+x)*3,j=(sy*info.width+sx)*3;
   for(let c=0;c<3;c++){const d=raw[j+c]-target[i+c];error+=d*d;n++;}
  }
  return n>90?Math.sqrt(error/n):1e9;
 }
 for(const size of (blue?[98,106,114,122,130,138]:[74,82,90,98,106]))for(const dx of (blue?[-28,-20,-12,-4,4,12]:[-12,-6,0,6,12]))for(const dy of (blue?[-36,-28,-20,-12,-4,4,12]:[-12,-6,0,6,12])){
  for(let k=0;k<templates.length;k++){
   const error=loss(templates[k].data,size,dx,dy);
   if(error<rank[k].error)Object.assign(rank[k],{error,transform:{size,dx,dy},template:k});
  }
 }
 rank.sort((a,b)=>a.error-b.error);
 for(const candidate of rank.slice(0,5)){
  const center=candidate.transform,target=templates[candidate.template].data;
  for(let size=center.size-6;size<=center.size+6;size+=2)for(let dx=center.dx-5;dx<=center.dx+5;dx++)for(let dy=center.dy-5;dy<=center.dy+5;dy++){
   const error=loss(target,size,dx,dy);if(error<candidate.error)candidate.error=error;
  }
 }
 rank.sort((a,b)=>a.error-b.error);const top=rank[0];
 const summarize=c=>({name:c.name,error:c.error});
 return {...summarize(top),score:Math.max(0,1-top.error/120),margin:rank[1].error-top.error,alternatives:rank.slice(0,3).map(summarize)};
}

export class Vision{
 constructor(root){this.root=root;this.overrides=null;this.pickCache=new Map();this.banCache=new Map();this.numberCache=new Map();this.headerCache=null;this.mapCache=null;}
 async init(){
  this.catalog=JSON.parse(await fs.readFile(path.join(this.root,'assets/catalog.json'),'utf8'));
  [this.pins,this.portraits]=await Promise.all([pinTemplates(this.root,this.catalog),portraitTemplates(this.root,this.catalog)]);
  this.worker=await createWorker('eng',1,{langPath:this.root,cachePath:path.join(this.root,'cache'),logger:()=>{}});
  await this.worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,user_defined_dpi:'150'});
 }
 async read(buffer,{debug=false}={}){
  const source=sharp(buffer);const metadata=await source.metadata();
  if(metadata.width<metadata.height)return {isDraft:false,reason:'Rotate the phone to landscape.'};
  const image=await source.resize({width:WIDTH}).removeAlpha().png().toBuffer();
  const {data:raw,info}=await sharp(image).blur(.7).raw().toBuffer({resolveWithObject:true});
  const w=info.width,h=info.height;
  const layout=locateDraftLayout(raw,w,h),offsetX=layout.offsetX;
  // Only the header is sent to local OCR. The game screen never leaves the computer.
  const headerSignature=portraitSignature(raw,w,h,[Math.max(0,offsetX),.01,.26,.09]);
  let headerText;
  if(this.headerCache&&samePortrait(headerSignature,this.headerCache.signature))headerText=this.headerCache.text;
  else{
   const header=await textMask(buffer,[0,0,.326+offsetX,.114],metadata.width,metadata.height,110,true);
   headerText=(await this.worker.recognize(header)).data.text;
   this.headerCache={signature:headerSignature,text:headerText};
  }
  const mapRegion=[.379+offsetX,.058,.158,.046],mapSignature=portraitSignature(raw,w,h,mapRegion);
  let mapText;
  if(this.mapCache&&samePortrait(mapSignature,this.mapCache.signature))mapText=this.mapCache.text;
  else{
   const mapCrop=await textMask(buffer,mapRegion,metadata.width,metadata.height,110);
   await this.worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_LINE});
   mapText=(await this.worker.recognize(mapCrop)).data.text;
   await this.worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT});
   this.mapCache={signature:mapSignature,text:mapText};
  }
  let text=headerText+'\n'+mapText;
  let map=mapFromText(mapText,Object.keys(this.catalog.maps));
  if(!map&&/TURN|BRAWLER|PICK|BAN\b/i.test(headerText)){
   const fullHeader=await textMask(buffer,[0,0,Math.min(.7,.55+offsetX),.114],metadata.width,metadata.height,110,true);
   text+='\n'+(await this.worker.recognize(fullHeader)).data.text;
   map=mapFromText(text,Object.keys(this.catalog.maps));
  }
  const isDraft=Boolean(map&&/TURN|BRAWLER|PICK|BAN\b/i.test(text));
  if(!isDraft)return {isDraft:false,reason:'Waiting for a ranked draft…',headerText:debug?text:undefined};
  const phase=/BANABRAWLER|BANNING/.test(normalize(text))?'banning':'picking';
  const regions=this.overrides||shiftRegions(REGIONS,offsetX);
  const bans=regions.bans.map((r,index)=>{
   const detail=texture(raw,w,h,r),badge=banBadge(raw,w,h,r);
   if(badge<=.07||detail<=22||index>=3&&phase==='banning'){
    this.banCache.delete(index);return {name:null,error:120,score:0,margin:0,alternatives:[],texture:detail,badge};
   }
   const signature=portraitSignature(raw,w,h,r),cached=this.banCache.get(index);let result;
   if(cached&&samePortrait(signature,cached.signature))result=cached.result;
   else{result=matchPin(raw,w,h,r,this.pins);this.banCache.set(index,{signature,result});}
   return {...result,texture:detail,badge};
  });
  const mine=[],enemy=[];
  for(const side of ['mine','enemy'])for(let i=0;i<3;i++){
   const locked=greenRatio(raw,w,h,regions.checks[side][i])>.045;
   const key=side+'.'+i;let result=null;
   if(locked){
    const signature=portraitSignature(raw,w,h,regions[side][i]),cached=this.pickCache.get(key);
    if(cached&&samePortrait(signature,cached.signature))result=cached.result;
    else{result=await matchPortrait(image,regions[side][i],this.portraits);this.pickCache.set(key,{signature,result});}
   }else this.pickCache.delete(key);
   (side==='mine'?mine:enemy).push({locked,...result,box:regions[side][i]});
  }
  // During banning, slot numbers reveal first pick, even before any portrait appears.
  await this.worker.setParameters({tessedit_pageseg_mode:PSM.SINGLE_CHAR,tessedit_char_whitelist:'123456'});
  const readNumber=async(key,region)=>{
   const signature=portraitSignature(raw,w,h,region),cached=this.numberCache.get(key);
   if(cached&&samePortrait(signature,cached.signature))return cached.text;
   const crop=await sharp(image).extract(rect(region,w,h)).resize({height:90}).grayscale().extend({top:12,bottom:12,left:12,right:12,background:'black'}).png().toBuffer();
   const text=(await this.worker.recognize(crop)).data.text.trim();this.numberCache.set(key,{signature,text});return text;
  };
  const numText=await readNumber('blue-first',[.276+offsetX,.245,.038,.057]);
  let first=numText==='1'?'mine':numText==='2'?'enemy':null;
  if(!first){const n=await readNumber('red-first',[.080+offsetX,.863,.024,.047]);first=n==='1'?'enemy':n==='2'?'mine':null;}
  if(!first){const n=await readNumber('blue-last',[.267+offsetX,.625,.028,.055]);first=n==='5'?'mine':n==='6'?'enemy':null;}
  await this.worker.setParameters({tessedit_pageseg_mode:PSM.SPARSE_TEXT,tessedit_char_whitelist:''});
  if(!first){
   const mc=mine.filter(x=>x.locked).length,ec=enemy.filter(x=>x.locked).length,total=mc+ec;
   if([1,3,5].includes(total)&&Math.abs(mc-ec)===1)first=(total===3?mc<ec:mc>ec)?'mine':'enemy';
  }
  return {isDraft:true,map:map.map,mapScore:map.score,phase,first,bans,mine,enemy,layout,headerText:debug?text:undefined,width:w,height:h};
 }
 async close(){await this.worker?.terminate();}
}
