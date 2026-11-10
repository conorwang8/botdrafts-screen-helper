import http from 'node:http';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Vision} from './vision.mjs';
import {DraftTracker} from './tracker.mjs';
import {buildPage} from './site-bridge.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const appVersion=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8')).version;
const PORT=Number(process.env.BOTDRAFTS_PORT||8766),host='127.0.0.1',base=`http://${host}:${PORT}`;
const execute=promisify(execFile),tracker=new DraftTracker({fast:true}),listeners=new Set(),captureFormats=new Map();
const replayPath=process.env.BOTDRAFTS_REPLAY||null;
const replayFiles=replayPath?(await fs.readdir(replayPath)).filter(f=>f.endsWith('.png')).sort().map(f=>path.join(replayPath,f)):[];
if(replayPath&&!replayFiles.length)throw Error('The replay folder contains no PNG frames.');
const runtime={running:false,ready:false,status:'Preparing the reader…',devices:[],device:null,error:null,timing:0,captureMs:0,readMs:0,captureFormat:null,fastUpdates:true,frameAt:0,reads:0};
let frame=null,vision=null,adb='adb',closed=false,loopPromise=null,lastDraftRead=null;
const catalog=JSON.parse(await fs.readFile(path.join(root,'assets/catalog.json'),'utf8'));
if(process.env.BOTDRAFTS_RECOVERY_FILE){
 const recovered=JSON.parse(await fs.readFile(process.env.BOTDRAFTS_RECOVERY_FILE,'utf8'));
 if(!Object.keys(catalog.maps).includes(recovered.map)||!['mine','enemy'].includes(recovered.first))throw Error('Invalid recovered draft');
 for(const side of ['bans','mine','enemy'])if(!Array.isArray(recovered[side])||recovered[side].length!==(side==='bans'?6:3)||recovered[side].some(b=>b&&!catalog.portraits[b]))throw Error('Invalid recovered brawlers');
 for(const key of ['map','first','phase','bans','mine','enemy'])tracker.state[key]=structuredClone(recovered[key]);
 if(Array.isArray(recovered.locks))tracker.locks=new Set(recovered.locks.filter(key=>['map','first','phase'].includes(key)||/^(bans\.[0-5]|mine\.[0-2]|enemy\.[0-2])$/.test(key)));
 tracker.lastPhase=recovered.phase;tracker.lastDraftAt=Date.now();tracker.waiting=false;tracker.revision++;
}
await fs.mkdir(path.join(root,'cache'),{recursive:true});
let page=buildPage(await fs.readFile(path.join(root,'upstream/index.html'),'utf8'));
function snapshot(){return {runtime,draft:tracker.snapshot(),read:tracker.lastRead,lastDraftRead,catalog:{maps:Object.keys(catalog.maps),brawlers:Object.keys(catalog.portraits).sort()}};}
function publish(){const value='data: '+JSON.stringify(snapshot())+'\n\n';for(const r of listeners)r.write(value);}
async function findAdb(){
 if(process.env.ADB_PATH)return process.env.ADB_PATH;
 try{await execute('adb',['version'],{windowsHide:true,timeout:3000});return 'adb';}catch{}
 const packages=path.join(process.env.LOCALAPPDATA||'','Microsoft','WinGet','Packages');
 for(const p of await fs.readdir(packages).catch(()=>[]))if(p.startsWith('Genymobile.scrcpy_')){
  const dir=path.join(packages,p);for(const sub of await fs.readdir(dir)){
   const file=path.join(dir,sub,'adb.exe');try{await fs.access(file);return file;}catch{}
  }
 }
 throw Error('ADB was not found. Keep scrcpy installed, or set ADB_PATH to its adb.exe.');
}
async function devices(){
 if(replayPath){runtime.devices=[{id:'replay',name:'Recorded draft test'}];runtime.device='replay';return runtime.devices;}
 const {stdout}=await execute(adb,['devices','-l'],{windowsHide:true,timeout:5000});
 runtime.devices=stdout.split(/\r?\n/).filter(s=>/^\S+\s+device\b/.test(s)).map(s=>({id:s.split(/\s+/)[0],name:(s.match(/model:(\S+)/)?.[1]||s.split(/\s+/)[0]).replaceAll('_',' ')}));
 if(!runtime.devices.some(d=>d.id===runtime.device))runtime.device=runtime.devices.length===1?runtime.devices[0].id:null;
 return runtime.devices;
}
async function screen(){
 if(replayPath)return fs.readFile(replayFiles[Math.min(Math.floor(runtime.reads/3),replayFiles.length-1)]);
 let format=captureFormats.get(runtime.device)||'jpeg',stdout;
 const capture=async flag=>(await execute(adb,['-s',runtime.device,'exec-out','screencap',flag],{encoding:'buffer',maxBuffer:24*1024*1024,timeout:5000,windowsHide:true})).stdout;
 try{stdout=await capture(format==='jpeg'?'-j':'-p');}
 catch(error){if(format==='jpeg'&&/invalid option|unrecognized|unknown option|usage:|unsupported/i.test(String(error.stderr||error.message))){format='png';stdout=await capture('-p');}else throw error;}
 let jpeg=stdout.length>2&&stdout[0]===255&&stdout[1]===216,png=stdout.length>8&&stdout.readUInt32BE(0)===0x89504e47;
 if(!jpeg&&!png&&format==='jpeg'){format='png';stdout=await capture('-p');png=stdout.length>8&&stdout.readUInt32BE(0)===0x89504e47;}
 if(!jpeg&&!png)throw Error('The phone did not return a screen image.');
 runtime.captureFormat=jpeg?'JPEG':'PNG';captureFormats.set(runtime.device,jpeg?'jpeg':'png');return stdout;
}
async function loop(){
 while(runtime.running&&!closed){const started=Date.now();try{
  if(!runtime.device){await devices();if(!runtime.device){runtime.status=runtime.devices.length?'Choose which phone to read.':'Waiting for your phone — reconnect it and reopen scrcpy.';runtime.error=null;publish();await new Promise(r=>setTimeout(r,2000));continue;}}
  const captureStarted=Date.now(),nextFrame=await screen();if(!runtime.running)break;frame=nextFrame;runtime.frameAt=Date.now();runtime.captureMs=Date.now()-captureStarted;
  const readStarted=Date.now(),result=await vision.read(frame);runtime.readMs=Date.now()-readStarted;
  if(!runtime.running)break;
  runtime.reads++;
  tracker.read(result);if(result.isDraft)lastDraftRead=result;runtime.error=null;runtime.status=(replayPath?'Recorded draft test · ':'')+(result.isDraft?`${result.phase==='banning'?'Reading bans':'Reading locked picks'} · ${result.map}`:'Waiting for a ranked draft…');
  runtime.timing=Date.now()-started;publish();
 }catch(e){const phoneError=/adb|screencap|device|timed out|timeout/i.test(e.message);runtime.error=phoneError?null:e.message;runtime.status=phoneError?'Waiting for your phone — reconnect it and reopen scrcpy.':'Retrying the screen read…';if(phoneError)runtime.device=null;publish();await new Promise(r=>setTimeout(r,1500));}
 if(runtime.running)await new Promise(r=>setTimeout(r,Math.max(20,450-(Date.now()-started))));
 }
}
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
async function body(req){let text='';for await(const c of req){text+=c;if(text.length>24_000)throw Error('Request too large');}return text?JSON.parse(text):{};}
function allowed(req){
 const hostname=req.headers.host;if(hostname!==`${host}:${PORT}`&&hostname!==`localhost:${PORT}`)return false;
 if(req.headers['sec-fetch-site']==='cross-site')return false;
 const origin=req.headers.origin;return !origin||origin===base||origin===`http://localhost:${PORT}`;
}
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.webp':'image/webp','.webm':'video/webm','.mp4':'video/mp4'};
async function refresh(){
 const response=await fetch('https://botdrafts.pages.dev/',{signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('BotDrafts returned '+response.status);
 const html=await response.text();const nextPage=buildPage(html);
 const m=JSON.parse(html.match(/<script[^>]*id="model"[^>]*>([\s\S]*?)<\/script>/)[1]);
 for(const f of m.split||[]){if(!/^data\/[a-zA-Z0-9_.-]+\.json$/.test(f))throw Error('Unexpected data path');const r=await fetch(new URL(f,'https://botdrafts.pages.dev/'),{signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('Data download failed');await fs.writeFile(path.join(root,'upstream',f),Buffer.from(await r.arrayBuffer()));}
 await fs.writeFile(path.join(root,'upstream/index.html'),html);page=nextPage;
}
const server=http.createServer(async(req,res)=>{
 try{
  if(!allowed(req)){json(res,403,{error:'This helper is only available locally.'});return;}
  const url=new URL(req.url,base),route=url.pathname;
  if(route==='/helper/health'){json(res,200,{name:'BotDrafts Screen Helper',version:appVersion,ready:runtime.ready});return;}
  if(route==='/api/ping'){json(res,200,{public:true});return;}
  if(route==='/api/player'&&req.method==='GET'){
   const tag=url.searchParams.get('tag')||'';
   if(!/^#?[A-Z0-9]{3,20}$/i.test(tag)){json(res,400,{error:'Enter a valid Brawl Stars player tag.'});return;}
   const upstream=await fetch('https://botdrafts.pages.dev/api/player?tag='+encodeURIComponent(tag),{signal:AbortSignal.timeout(15000)});
   const data=await upstream.json().catch(()=>({error:'Player lookup is unavailable right now.'}));json(res,upstream.status,data);return;
  }
  if(route==='/helper/state'){json(res,200,snapshot());return;}
  if(route==='/helper/events'){
   res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});listeners.add(res);res.write('data: '+JSON.stringify(snapshot())+'\n\n');req.on('close',()=>listeners.delete(res));return;
  }
  if(route==='/helper/frame'){
   if(!frame){res.writeHead(204);res.end();return;}res.writeHead(200,{'Content-Type':frame[0]===255&&frame[1]===216?'image/jpeg':'image/png','Cache-Control':'no-store'});res.end(frame);return;
  }
  if(route.startsWith('/helper/')&&req.method==='POST'){
   const value=await body(req);
   if(route==='/helper/start'){
    if(!runtime.ready)throw Error('The reader is still preparing.');
    await devices();if(value.device){if(!runtime.devices.some(x=>x.id===value.device))throw Error('That phone is not connected.');runtime.device=value.device;}
    if(!runtime.device&&runtime.devices.length>1)throw Error('Choose the phone to read.');
    if(!runtime.running){if(loopPromise)await loopPromise;runtime.running=true;runtime.error=null;runtime.status='Looking for the draft…';loopPromise=loop();}
   }else if(route==='/helper/pause'){runtime.running=false;runtime.status='Paused';}
   else if(route==='/helper/speed'){if(typeof value.fast!=='boolean')throw Error('Choose a valid update mode.');runtime.fastUpdates=value.fast;tracker.fast=value.fast;}
   else if(route==='/helper/reset'){tracker.reset();}
   else if(route==='/helper/correct'){
    const {key,value:selection}=value;
    if(key==='map'){if(!Object.keys(catalog.maps).includes(selection))throw Error('Unknown map');}
    else if(key==='first'){if(!['mine','enemy'].includes(selection))throw Error('Choose a team');}
    else if(key==='phase'){if(!['banning','picking'].includes(selection))throw Error('Unknown phase');}
    else {if(!/^(bans\.[0-5]|mine\.[0-2]|enemy\.[0-2])$/.test(key))throw Error('Unknown draft slot');if(selection!==null&&!Object.keys(catalog.portraits).includes(selection))throw Error('Unknown brawler');}
    tracker.correct(key,selection);
   }else if(route==='/helper/refresh'){await refresh();}
   else if(route==='/helper/stop'){runtime.running=false;json(res,200,{ok:true});setTimeout(shutdown,100);return;}
   else{json(res,404,{error:'Unknown command'});return;}
   publish();json(res,200,{ok:true});return;
  }
  if(req.method!=='GET'){json(res,405,{error:'Method not allowed'});return;}
  if(route==='/'||route==='/index.html'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(page);return;}
  const publicFile=route==='/helper.js'||route==='/helper.css'?path.join(root,route.slice(1)):route.startsWith('/assets/')?path.join(root,route.slice(1)):route.startsWith('/data/')?path.join(root,'upstream',route.slice(1)):null;
  if(!publicFile||(!route.startsWith('/assets/')&&!route.startsWith('/data/')&&!['/helper.js','/helper.css'].includes(route))||!path.resolve(publicFile).startsWith(root+path.sep)||route.includes('..')){res.writeHead(404);res.end();return;}
  const data=await fs.readFile(publicFile);res.writeHead(200,{'Content-Type':mime[path.extname(publicFile)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(data);
 }catch(e){if(!res.headersSent)json(res,400,{error:e.code==='ENOENT'?'File not found':e.message});else res.end();}
});
async function shutdown(){if(closed)return;closed=true;runtime.running=false;for(const r of listeners)r.end();await vision?.close();server.close();setTimeout(()=>process.exit(0),300).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
server.on('error',async e=>{if(e.code==='EADDRINUSE'){
 try{const existing=await fetch(base+'/helper/health',{signal:AbortSignal.timeout(2000)}).then(r=>r.json());if(existing.name==='BotDrafts Screen Helper'){if(process.argv.includes('--open'))openBrowser();process.exit(0);}}catch{}
 console.error('The helper port is already being used by another app. Set BOTDRAFTS_PORT to a different port.');process.exit(1);
}console.error(e.message);process.exit(1);});
function openBrowser(){spawn('rundll32.exe',['url.dll,FileProtocolHandler',base+'/#draft'],{windowsHide:true,detached:true,stdio:'ignore'}).unref();}
server.listen(PORT,host,()=>{console.log(`BotDrafts helper: ${base}/#draft`);if(process.argv.includes('--open'))openBrowser();});
try{
 if(!replayPath)adb=await findAdb();await devices();vision=new Vision(root);await vision.init();runtime.ready=true;
 runtime.status=runtime.device?'Ready — press Start reading.':'Connect your phone and open scrcpy, then press Start reading.';publish();
}catch(e){runtime.error=e.message;runtime.status='Setup needs attention';publish();}
