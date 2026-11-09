// Find the slanted right edge of the blue team panel. Android can inset the
// game horizontally (for the camera cutout) without changing screenshot size.
export function locateDraftLayout(raw,width,height){
 let best=null;
 for(let slope=.035;slope<=.075;slope+=.002)for(let intercept=.30;intercept<.425;intercept+=.001){
  let dark=0,blue=0,total=0;
  for(let fy=.14;fy<.97;fy+=.015){
   const x=Math.round((intercept-slope*fy)*width),y=Math.round(fy*height),i=(y*width+x)*3;
   if(Math.max(raw[i],raw[i+1],raw[i+2])<40)dark++;
   if(fy<.67){const j=(y*width+x-13)*3;if(raw[j+2]>130&&raw[j+2]>raw[j]*1.7&&raw[j+2]>raw[j+1]*1.35)blue++;}
   total++;
  }
  const score=dark/total+blue/total*.18;
  if(!best||score>best.score)best={intercept,slope,score,confidence:dark/total};
 }
 if(best.confidence<.65)return {offsetX:0,confidence:0};
 return {...best,offsetX:best.intercept-best.slope*.5-(.333-.055*.5)};
}
export function shiftRegions(regions,offsetX){
 const shift=r=>[r[0]+offsetX,r[1],r[2],r[3]];
 return {mine:regions.mine.map(shift),enemy:regions.enemy.map(shift),bans:regions.bans.map(shift),checks:{mine:regions.checks.mine.map(shift),enemy:regions.checks.enemy.map(shift)}};
}
