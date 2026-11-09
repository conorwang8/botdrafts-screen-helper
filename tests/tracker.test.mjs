import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DraftTracker} from '../tracker.mjs';
const fixture=async name=>JSON.parse(await fs.readFile(new URL('fixtures/'+name+'.json',import.meta.url),'utf8'));

test('normal updates wait for a matching second read',async()=>{
 const read=await fixture('complete');const tracker=new DraftTracker();
 tracker.read(read,1000);assert.equal(tracker.state.mine[0],null);
 tracker.read(read,2000);assert.equal(tracker.state.mine[0],'MELODIE');
});
test('fast updates immediately accept a very clear locked pick',async()=>{
 const read=await fixture('complete');const tracker=new DraftTracker({fast:true});tracker.read(read,1000);
 assert.equal(tracker.state.mine[0],'MELODIE');
});
test('fast updates still ignore pre-picks',async()=>{
 const read=await fixture('complete');read.mine[0].locked=false;
 const tracker=new DraftTracker({fast:true});for(let i=0;i<4;i++)tracker.read(read,1000+i*500);
 assert.equal(tracker.state.mine[0],null);
});
test('hidden bans cannot be filled from background colors',async()=>{
 const read=await fixture('hidden-bans');const tracker=new DraftTracker({fast:true});
 for(let i=0;i<4;i++)tracker.read(read,1000+i*500);
 assert.deepEqual(tracker.state.bans,Array(6).fill(null));
});
test('complete recorded draft preserves both teams and ban sets',async()=>{
 const read=await fixture('complete');const tracker=new DraftTracker({fast:true});
 for(let i=0;i<3;i++)tracker.read(read,1000+i*500);
 assert.deepEqual(tracker.state.mine,['MELODIE','NAJIA','BO']);
 assert.deepEqual(tracker.state.enemy,['JESSIE','COLETTE','EMZ']);
 assert.deepEqual(tracker.state.bans.slice(0,3).sort(),['GIGI','AMBER','SHADE'].sort());
 assert.deepEqual(tracker.state.bans.slice(3).sort(),['BROCK','MICO','MEEPLE'].sort());
});
test('manual corrections survive later automatic reads',async()=>{
 const read=await fixture('complete');const tracker=new DraftTracker({fast:true});tracker.read(read,1000);
 tracker.correct('mine.0','COLETTE');tracker.read(read,1500);
 assert.equal(tracker.state.mine[0],'COLETTE');
});
test('returning for a new draft clears old picks and manual corrections',async()=>{
 const tracker=new DraftTracker({fast:true});const read=await fixture('complete');
 for(let i=0;i<3;i++)tracker.read(read,1000+i*500);
 tracker.correct('mine.0','COLETTE');tracker.read({isDraft:false},20000);
 const next=await fixture('hidden-bans');tracker.read(next,21000);tracker.read(next,21500);
 assert.deepEqual(tracker.state.mine,Array(3).fill(null));assert.equal(tracker.locks.size,0);
});
