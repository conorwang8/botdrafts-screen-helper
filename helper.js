const $=s=>document.querySelector(s);
let current=null,lastApplied=null,source=null,busy=false,stream=null,frameAt=0,seenId=null,editedTimer=null;
const nice=s=>s?s.toLowerCase().replace(/(^|[\s.&-])([a-z])/g,(_,p,c)=>p+c.toUpperCase()).replace(/^R-t$/,'R-T'):'—';
const el=(tag,attrs={},text='')=>{const n=document.createElement(tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);n.textContent=text;return n;};
const panel=el('section',{class:'dh-panel','aria-label':'Automatic draft reader'});
panel.innerHTML=`
 <div class="dh-title"><div><span class="dh-eyebrow">PHONE → BOTDRAFTS</span><h2>Draft reader <span id="dh-dot"></span></h2></div><span class="dh-local">Runs on your computer</span></div>
 <div class="dh-toolbar"><button id="dh-start" class="dh-primary" disabled>Preparing…</button><button id="dh-reset">New draft</button><button id="dh-details" aria-expanded="false">Check reads</button><label class="dh-fast" title="Use one especially clear scan; uncertain portraits still get extra checks."><input type="checkbox" id="dh-fast" checked> Fast updates</label><span id="dh-speed"></span></div>
 <div id="dh-status" role="status">Connecting to the local helper…</div>
 <div id="dh-error" role="alert" hidden></div>
 <div id="dh-device-row" hidden><label for="dh-device">Phone</label><select id="dh-device"></select></div>
 <div class="dh-readout"><span id="dh-summary">Open a ranked draft, then start reading.</span><span id="dh-corrections"></span></div>
 <div id="dh-detail" hidden>
  <p class="dh-note">Only locked picks are added. A corrected slot stays as you set it until the next draft.</p>
  <div class="dh-setting"><label for="dh-map">Map</label><select id="dh-map"></select><label for="dh-first">First pick</label><select id="dh-first"><option value="">Detecting…</option><option value="mine">Your team</option><option value="enemy">Enemy team</option></select></div>
  <div id="dh-slots"></div>
  <details class="dh-preview"><summary>Show phone preview</summary><img id="dh-frame" alt="Latest game screen, kept on this computer"><p>Screen reading stops when paused. The last frame stays in memory until the helper closes.</p></details>
  <div class="dh-footer"><button id="dh-refresh">Refresh BotDrafts stats</button><a href="https://botdrafts.pages.dev/#draft" target="_blank" rel="noopener">Original BotDrafts</a><button id="dh-stop">Close helper</button></div>
 </div>`;
document.querySelector('.wrap').prepend(panel);
async function command(route,value={}){
 const res=await fetch('/helper/'+route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 const result=await res.json();if(!res.ok)throw Error(result.error||'The helper could not complete that action.');return result;
}
function showError(e){$('#dh-error').textContent=e.message;$('#dh-error').hidden=false;}
async function action(fn){if(busy)return;busy=true;try{$('#dh-error').hidden=true;await fn();}catch(e){showError(e);}finally{busy=false;}}
$('#dh-start').onclick=()=>action(()=>command(current?.runtime.running?'pause':'start',{device:$('#dh-device').value||undefined}));
$('#dh-reset').onclick=()=>action(()=>command('reset'));
$('#dh-fast').onchange=()=>action(()=>command('speed',{fast:$('#dh-fast').checked}));
$('#dh-details').onclick=()=>{const open=$('#dh-detail').hidden;$('#dh-detail').hidden=!open;$('#dh-details').setAttribute('aria-expanded',String(open));};
$('#dh-refresh').onclick=()=>action(async()=>{const was=current.runtime.running;if(was)await command('pause');$('#dh-status').textContent='Refreshing recommendation data…';await command('refresh');location.reload();});
$('#dh-stop').onclick=()=>action(async()=>{await command('stop');source?.close();$('#dh-start').disabled=true;$('#dh-status').textContent='Helper closed. Open “Start BotDrafts.vbs” to start it again.';$('#dh-dot').className='';});
function selectOptions(select,entries,placeholder){select.replaceChildren();if(placeholder)select.append(el('option',{value:''},placeholder));for(const[value,label]of entries)select.append(el('option',{value},label));}
function setup(catalog){
 selectOptions($('#dh-map'),catalog.maps.map(m=>[m,m]),'Detecting…');
 const container=$('#dh-slots');
 for(const [side,title,count]of [['mine','Your locked picks',3],['enemy','Enemy locked picks',3],['bans','Bans · your team, then enemy team',6]]){
  const group=el('div',{class:'dh-slotgroup'});group.append(el('h3',{},title));const grid=el('div',{class:'dh-slotgrid'});
  for(let i=0;i<count;i++){
   const key=side+'.'+i,card=el('label',{class:'dh-slot'});card.append(el('span',{class:'dh-slotlabel'},side==='bans'?(i<3?'Your ban ':'Enemy ban ')+(i%3+1):'Pick '+(i+1)));
   const select=el('select',{'data-dh-key':key,'aria-label':side+' '+(i+1)});selectOptions(select,catalog.brawlers.map(b=>[b,nice(b)]),'Empty / not read');
   select.onchange=()=>action(()=>command('correct',{key,value:select.value||null}));card.append(select,el('small',{'data-dh-review':key},'Waiting'));grid.append(card);
  }group.append(grid);container.append(group);
 }
 $('#dh-map').onchange=()=>{if($('#dh-map').value)action(()=>command('correct',{key:'map',value:$('#dh-map').value}));};
 $('#dh-first').onchange=()=>{if($('#dh-first').value)action(()=>command('correct',{key:'first',value:$('#dh-first').value}));};
}
function apply(state){
 current=state;if(!stream){setup(state.catalog);stream=true;}
 const {runtime:r,draft:d,read}=state;
 $('#dh-start').disabled=!r.ready;$('#dh-start').textContent=r.running?'Pause':r.reads?'Resume':'Start reading';
 $('#dh-dot').className=r.running?'dh-on':'';$('#dh-status').textContent=r.status;
 $('#dh-fast').checked=Boolean(r.fastUpdates);
 $('#dh-speed').textContent=r.timing&&r.running?'Latest read: '+(r.timing/1000).toFixed(1)+'s':'';
 $('#dh-error').hidden=!r.error;if(r.error)$('#dh-error').textContent=r.error;
 $('#dh-device-row').hidden=r.devices.length<2;
 if($('#dh-device').options.length!==r.devices.length){selectOptions($('#dh-device'),r.devices.map(x=>[x.id,x.name]));}if(r.device)$('#dh-device').value=r.device;
 const n=d.mine.filter(Boolean).length+d.enemy.filter(Boolean).length,nb=d.bans.filter(Boolean).length;
 $('#dh-summary').textContent=(d.map||'Map pending')+' · '+nb+'/6 bans · '+n+'/6 locked picks'+(d.first?' · '+(d.first==='mine'?'You pick first':'Enemy picks first'):' · First pick pending');
 $('#dh-corrections').textContent=d.locks.length?d.locks.length+' manual '+(d.locks.length===1?'correction':'corrections'):'';
 if(document.activeElement!==$('#dh-map'))$('#dh-map').value=d.map||'';
 if(document.activeElement!==$('#dh-first'))$('#dh-first').value=d.first||'';
 for(const side of ['mine','enemy','bans'])for(let i=0;i<d[side].length;i++){
  const key=side+'.'+i,select=panel.querySelector('[data-dh-key="'+key+'"]'),status=panel.querySelector('[data-dh-review="'+key+'"]');
  if(document.activeElement!==select)select.value=d[side][i]||'';
  let text=d.locks.includes(key)?'Set manually':d[side][i]?'Read automatically':'Waiting';
  const candidate=read?.isDraft?read[side]?.[i]:null;
  if(!d[side][i]&&candidate&&(side==='bans'?candidate.badge>.07&&candidate.texture>22&&!(i>=3&&read.phase==='banning'):candidate.locked))text='Check: '+nice(candidate.name);
  status.textContent=text;status.className=d[side][i]?'dh-good':text.startsWith('Check')?'dh-review':'';
 }
 if(window.draftScreenBridge&&lastApplied!==d.revision){
  window.draftScreenBridge.apply(d);lastApplied=d.revision;
  if(seenId!==d.id){seenId=d.id;location.hash='draft';}
 }
 const preview=panel.querySelector('.dh-preview');
 if(preview.open&&r.frameAt!==frameAt){$('#dh-frame').src='/helper/frame?t='+r.frameAt;frameAt=r.frameAt;}
}
window.addEventListener('draft-helper-edit',event=>{
 if(!current)return;const changes=event.detail;
 clearTimeout(editedTimer);editedTimer=setTimeout(async()=>{
  try{
   for(const [key,value] of Object.entries(changes))await command('correct',{key,value});
  }catch(e){showError(e);}
 },100);
});
panel.querySelector('.dh-preview').ontoggle=()=>{if(panel.querySelector('.dh-preview').open&&current?.runtime.frameAt)$('#dh-frame').src='/helper/frame?t='+current.runtime.frameAt;};
source=new EventSource('/helper/events');source.onmessage=event=>{try{apply(JSON.parse(event.data));}catch(e){showError(e);}};
source.onerror=()=>{$('#dh-status').textContent='Local helper disconnected. Reopen “Start BotDrafts.vbs” if it was closed.';$('#dh-dot').className='';};
