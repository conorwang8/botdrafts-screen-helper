import fs from 'node:fs/promises';
export function buildPage(source){
 const marker='  DATA.then(() => render(), () => {});';
 if(source.split(marker).length!==2)throw Error('BotDrafts changed its page format. The saved copy is kept; the helper needs an update before using the new page.');
 const bridge=`
  // Local screen reader integration. The original recommendations and attribution remain intact.
  let helperApplying = false;
  const helperSnapshot = () => ({map:S.map, first:S.first, phase:S.active?.side==='bans'?'banning':'picking', bans:[...S.bans],mine:[...S.mine],enemy:[...S.enemy]});
  let helperPrevious = helperSnapshot();
  const helperRender = render;
  render = function(){ helperRender(); const next=helperSnapshot(),changes={};
    for(const key of ['map','first','phase'])if(next[key]!==helperPrevious[key])changes[key]=next[key];
    for(const side of ['bans','mine','enemy'])for(let i=0;i<next[side].length;i++)if(next[side][i]!==helperPrevious[side][i])changes[side+'.'+i]=next[side][i];
    helperPrevious=next;
    if(!helperApplying&&Object.keys(changes).length)window.dispatchEvent(new CustomEvent('draft-helper-edit',{detail:changes}));
  };
  window.draftScreenBridge = {
    catalog: {brawlers:ALL,maps:Object.keys(M.maps)},
    read:helperSnapshot,
    apply(d){
      if(d.map&&!M.maps[d.map])throw Error('Unknown map');
      for(const side of ['bans','mine','enemy'])if(!Array.isArray(d[side])||d[side].length!==(side==='bans'?6:3)||d[side].some(b=>b&&!ALL.includes(b)))throw Error('Invalid draft');
      helperApplying=true;
      try{if(d.map){S.map=d.map;mapSel.value=d.map;}if(d.first)S.first=d.first;
        S.bans=[...d.bans];S.mine=[...d.mine];S.enemy=[...d.enemy];S.q='';$('q').value='';
        S.active=d.phase==='banning'?{side:'bans',i:Math.max(0,S.bans.indexOf(null))}:nextPick();render();
      }finally{helperApplying=false;}
    }
  };
  window.dispatchEvent(new Event('draft-helper-ready'));
`;
 let html=source.replace(marker,marker+'\n'+bridge);
 // Empty the example draft. A helper must never present the demo picks as detected picks.
 html=html.replace(/const S = \{ map:"Dueling Beetles", bans:\[[\s\S]*?pastSide:"mine" \};/,`const S = {map:"Dueling Beetles",bans:Array(6).fill(null),mine:Array(3).fill(null),enemy:Array(3).fill(null),active:{side:'bans',i:0},q:'',first:'mine',pastSide:'mine'};`);
 html=html.replace('src="bg.mp4"','');
 return html+'\n<link rel="stylesheet" href="/helper.css"><script type="module" src="/helper.js"></script>\n';
}
