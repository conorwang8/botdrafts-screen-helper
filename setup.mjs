import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPage} from './site-bridge.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const source='https://botdrafts.pages.dev/';
async function download(url){
 const response=await fetch(url,{signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`Download failed (${response.status}): ${new URL(url).hostname}`);
 return response;
}
async function main(){
 for(const dir of ['assets/portraits','assets/emoji','upstream/data','cache'])await fs.mkdir(path.join(root,dir),{recursive:true});
 console.log('Downloading the public BotDrafts page and recommendation data…');
 const html=await(await download(source)).text();
 buildPage(html); // Check compatibility before replacing the saved page.
 const modelScript=html.match(/<script[^>]*id="model"[^>]*>([\s\S]*?)<\/script>/);
 if(!modelScript)throw Error('The BotDrafts page no longer contains the expected model.');
 const model=JSON.parse(modelScript[1]);
 if(!model.img||!model.maps)throw Error('The downloaded recommendation model is incomplete.');
 const catalog={maps:model.maps,portraits:{},emoji:{},source,artSource:'https://brawlapi.com/'};
 for(const [name,value]of Object.entries(model.img)){
  const match=String(value).match(/^data:image\/(webp|png|jpeg);base64,([A-Za-z0-9+/=\s]+)$/);
  if(!match)throw Error('Unexpected portrait format for '+name+'. The helper needs an update.');
  const slug=name.toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(!slug)throw Error('Unexpected brawler name.');
  const file='assets/portraits/'+slug+'.'+match[1];
  await fs.writeFile(path.join(root,file),Buffer.from(match[2],'base64'));catalog.portraits[name]=file;
 }
 const api=await(await download('https://api.brawlapi.com/v1/brawlers')).json();
 if(!Array.isArray(api.list))throw Error('BrawlAPI returned an unexpected brawler list.');
 const jobs=api.list.filter(b=>catalog.portraits[String(b.name).toUpperCase()]);
 console.log(`Downloading ${jobs.length} public ban-icon references…`);
 let next=0;const failures=[];
 await Promise.all(Array.from({length:4},async()=>{
  for(;;){const b=jobs[next++];if(!b)return;
   const url=new URL(b.imageUrl3);
   if(url.protocol!=='https:'||url.hostname!=='cdn.brawlify.com'){failures.push(b.name);continue;}
   try{
    const image=Buffer.from(await(await download(url)).arrayBuffer());
    if(image.length<8||image.readUInt32BE(0)!==0x89504e47)throw Error('Invalid icon image');
    const name=String(b.name).toUpperCase(),file='assets/emoji/'+Number(b.id)+'.png';
    await fs.writeFile(path.join(root,file),image);catalog.emoji[name]=file;
   }catch{failures.push(b.name);}
  }
 }));
 if(failures.length)throw Error('Some ban icons could not download: '+failures.join(', ')+'. Run setup again.');
 if(!Object.keys(catalog.emoji).length)throw Error('No matching ban icons were found.');
 for(const file of model.split||[]){
  if(!/^data\/[A-Za-z0-9_.-]+\.json$/.test(file))throw Error('Unexpected model data path.');
  const data=Buffer.from(await(await download(new URL(file,source))).arrayBuffer());
  await fs.writeFile(path.join(root,'upstream',file),data);
 }
 const languageFile=path.join(root,'eng.traineddata.gz');
 try{await fs.access(languageFile);}catch{
  console.log('Downloading English text-recognition data…');
  await fs.writeFile(languageFile,Buffer.from(await(await download('https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz')).arrayBuffer()));
 }
 await fs.writeFile(path.join(root,'assets/catalog.json'),JSON.stringify(catalog));
 await fs.writeFile(path.join(root,'upstream/index.html'),html);
 console.log('Setup complete. Open Start BotDrafts.vbs or run npm start.');
}
main().catch(error=>{console.error('Setup failed: '+error.message);process.exitCode=1;});
