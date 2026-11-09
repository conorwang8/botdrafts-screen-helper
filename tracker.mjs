export class DraftTracker {
 constructor({fast=false}={}){this.fast=fast;this.revision=0;this.id=0;this.reset();}
 reset(map=null){
  this.id++;this.state={id:this.id,map,first:null,phase:'banning',bans:Array(6).fill(null),mine:Array(3).fill(null),enemy:Array(3).fill(null)};
  this.votes=new Map();this.locks=new Set();this.lastDraftAt=0;this.lastPhase=null;this.waiting=true;this.lastRead=null;this.revision++;
 }
 vote(key,value,required=2){
  if(value==null){this.votes.delete(key);return false;}
  const old=this.votes.get(key);const count=old?.value===value?old.count+1:1;
  this.votes.set(key,{value,count});return count>=required;
 }
 correct(key,value){
  if(key==='map'||key==='first'||key==='phase'){this.state[key]=value;this.locks.add(key);}
  else {const [side,i]=key.split('.');this.state[side][Number(i)]=value;this.locks.add(key);}
  this.revision++;
 }
 read(result,now=Date.now()){
  this.lastRead=result;
  if(!result.isDraft){if(this.lastDraftAt&&now-this.lastDraftAt>6000)this.waiting=true;return;}
  const newPhase=this.lastPhase==='picking'&&result.phase==='banning';
  const changedMap=this.state.map&&this.state.map!==result.map&&!this.locks.has('map');
  const returning=this.waiting&&this.lastDraftAt>0;
  if((newPhase||changedMap||returning)&&this.vote('_reset',result.map+'|'+result.phase)){
   this.reset(result.map);this.lastRead=result;
  }else if(newPhase||changedMap||returning){return;}
  this.votes.delete('_reset');this.waiting=false;this.lastDraftAt=now;this.lastPhase=result.phase;
  let changed=false;
  for(const key of ['map','first','phase'])if(result[key]&&!this.locks.has(key)&&this.vote(key,result[key],this.fast&&key==='map'&&result.mapScore>=.95?1:2)&&this.state[key]!==result[key]){this.state[key]=result[key];changed=true;}
  for(const side of ['bans','mine','enemy'])for(let i=0;i<result[side].length;i++){
   const key=side+'.'+i;if(this.locks.has(key))continue;
   const read=result[side][i];
   const strongPick=read.locked&&read.error<66&&read.margin>13;
   const stablePick=read.locked&&read.error<50&&read.margin>3.5;
   const sure=side==='bans'?!(i>=3&&result.phase==='banning')&&read.badge>.07&&read.texture>22&&read.error<58&&read.margin>12:strongPick||stablePick;
   const value=sure?read.name:null;
   const veryClear=read.error<40&&read.margin>20&&(side!=='bans'||read.badge>.1);
   const confirmations=this.fast&&veryClear?1:side!=='bans'&&!strongPick?3:2;
   if(!this.vote(key,value,confirmations)||!value)continue;
   if(side==='bans'){
    const start=i<3?0:3;if(this.state.bans.some((b,j)=>j!==i&&j>=start&&j<start+3&&b===value))continue;
   }else if(['mine','enemy'].some(s=>this.state[s].some((b,j)=>b===value&&(s!==side||i!==j))))continue;
   if(this.state[side][i]!==value){this.state[side][i]=value;changed=true;}
  }
  if(changed)this.revision++;
 }
 snapshot(){return {...structuredClone(this.state),revision:this.revision,locks:[...this.locks]};}
}
