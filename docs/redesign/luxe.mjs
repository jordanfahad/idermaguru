// DermaGuru — haute renders: widget+questionnaire flow, admin control room, logic flowchart, hero.
// No network in the container, so "photography" is rendered as duotone editorial art + grain.
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const DIR = dirname(fileURLToPath(import.meta.url));

const C = { ink:"#14110D", ink2:"#3A332C", muted:"#6E665C", faint:"#A89E92",
  ivory:"#FBF9F5", cream:"#F3EEE6", white:"#FFFFFF", line:"rgba(20,16,11,.10)", line2:"rgba(20,16,11,.16)",
  brass:"#9A7B4F", brass2:"#C2A36B", brassTint:"#F2EAD9",
  teal:"#1F6F5C", tealDk:"#103E33", tealTint:"#E7F1EE",
  rose:"#B05A6B", roseDk:"#83404E", roseTint:"#F6E8EB",
  gold:"#9A6B2F", goldTint:"#F4EBD8",
  safe:"#0F7A55", safeTint:"#E9F8EF",
  warnInk:"#7A3F25", warnTint:"#FFF6EF", warnRule:"#CC6B3D" };
const SANS="'Helvetica Neue',Arial,sans-serif", SERIF="Georgia,'Times New Roman',serif";
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const t=(x,y,s,o={})=>`<text x="${x}" y="${y}" font-size="${o.size??14}" fill="${o.fill??C.ink}" font-weight="${o.weight??400}" font-family="${o.family??SANS}"${o.anchor?` text-anchor="${o.anchor}"`:""}${o.ls!=null?` letter-spacing="${o.ls}"`:""}${o.italic?` font-style="italic"`:""}${o.rtl?` direction="rtl"`:""}>${esc(s)}</text>`;
const r=(x,y,w,h,o={})=>`<rect x="${x}" y="${y}" width="${w}" height="${h}"${o.rx!=null?` rx="${o.rx}"`:""} fill="${o.fill??"none"}"${o.stroke?` stroke="${o.stroke}"`:""}${o.sw?` stroke-width="${o.sw}"`:""}${o.op!=null?` opacity="${o.op}"`:""}${o.filter?` filter="${o.filter}"`:""}/>`;
const pill=(x,y,w,h,o={})=>r(x,y,w,h,{rx:h/2,...o});
const line=(x1,y1,x2,y2,st=C.line,sw=1)=>`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${st}" stroke-width="${sw}"/>`;
function chip(x,y,label,o={}){const w=o.w??(18+label.length*7.2),h=o.h??30,sel=o.sel;
  return pill(x,y,w,h,{fill:sel?C.teal:C.white,stroke:sel?C.teal:C.line2,sw:1.2})
    + t(x+w/2,y+h/2+4,label,{size:11.5,fill:sel?"#fff":C.ink2,weight:sel?600:500,anchor:"middle",rtl:o.rtl});}
const DEFS=`<defs>
<linearGradient id="gTeal" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2A8067"/><stop offset="1" stop-color="${C.tealDk}"/></linearGradient>
<linearGradient id="gRose" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C16E7E"/><stop offset="1" stop-color="${C.roseDk}"/></linearGradient>
<linearGradient id="gBrass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C.brass2}"/><stop offset="1" stop-color="${C.brass}"/></linearGradient>
<linearGradient id="duo" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D9C3A1"/><stop offset=".55" stop-color="#A98E63"/><stop offset="1" stop-color="${C.tealDk}"/></linearGradient>
<linearGradient id="sw1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#EAF3F0"/><stop offset="1" stop-color="#CDE2DB"/></linearGradient>
<linearGradient id="sw2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7EAEE"/><stop offset="1" stop-color="#E6CCD3"/></linearGradient>
<linearGradient id="sw3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F4ECDB"/><stop offset="1" stop-color="#E3D2B2"/></linearGradient>
<linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#241F18"/><stop offset="1" stop-color="${C.ink}"/></linearGradient>
<filter id="sh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="22" stdDeviation="34" flood-color="#2A211C" flood-opacity="0.16"/></filter>
<filter id="sh2" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#2A211C" flood-opacity="0.14"/></filter>
<filter id="blur"><feGaussianBlur stdDeviation="55"/></filter>
<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.05 0"/></filter>
<marker id="arr" markerWidth="11" markerHeight="11" refX="7.5" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="#A89E92"/></marker>
<marker id="arrT" markerWidth="11" markerHeight="11" refX="7.5" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="${C.teal}"/></marker>
<marker id="arrW" markerWidth="11" markerHeight="11" refX="7.5" refY="3" orient="auto"><path d="M0,0 L8,3 L0,6 Z" fill="${C.warnRule}"/></marker>
</defs>`;
const doc=(w,h,body,grain=true)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w*2}" height="${h*2}" viewBox="0 0 ${w} ${h}" font-family="${SANS}">${DEFS}<rect width="${w}" height="${h}" fill="${C.ivory}"/>${body}${grain?r(0,0,w,h,{filter:"url(#grain)"}):""}</svg>`;

// shared widget chrome
function widgetHead(x,y,w,{name="Cicabelle",sub="Skincare advisor · online",brand="gTeal",rtl=false}={}){
  const ix=x+18,ir=x+w-18;let s=r(x,y,w,72,{});
  if(rtl){s+=r(ir-38,y+16,38,38,{rx:11,fill:`url(#${brand})`});s+=t(ir-19,y+40,"C",{size:15,fill:"#fff",weight:700,anchor:"middle",family:SERIF});
    s+=t(ir-46,y+31,name,{size:13.5,weight:700,anchor:"end",rtl:true});s+=t(ir-46,y+48,sub,{size:9.5,fill:C.muted,anchor:"end",rtl:true});s+=t(ix,y+38,"×",{size:18,fill:C.faint});}
  else{s+=r(ix,y+16,38,38,{rx:11,fill:`url(#${brand})`});s+=t(ix+19,y+40,"C",{size:15,fill:"#fff",weight:700,anchor:"middle",family:SERIF});
    s+=t(ix+48,y+31,name,{size:13.5,weight:700});s+=`<circle cx="${ix+52}" cy="${y+43}" r="3" fill="${C.safe}"/>`;s+=t(ix+60,y+46,sub,{size:9.5,fill:C.muted});s+=t(ir,y+38,"×",{size:18,fill:C.faint,anchor:"end"});}
  s+=line(x,y+72,x+w,y+72);return s;
}
function discBar(x,y,w,{tint=C.tealTint,fg=C.tealDk,txt="Educational beauty guidance — not medical advice.",rtl=false}={}){
  return r(x,y,w,26,{fill:tint})+t(rtl?x+w-12:x+12,y+17,txt,{size:10,fill:fg,weight:600,anchor:rtl?"end":"start",rtl});
}
function prod(x,y,w,{name,why,price,step,sponsored,sw="sw1",brand=C.teal}){
  let s=r(x,y,82,{}); s=r(x,y,w,84,{rx:14,fill:C.white,stroke:C.line,sw:1});
  s+=r(x+12,y+12,60,60,{rx:11,fill:`url(#${sw})`});
  // bottle hint
  s+=r(x+30,y+22,24,42,{rx:7,fill:"#fff",op:.6});
  const tx=x+86;let cy=y+22;
  if(sponsored){s+=pill(tx,cy-11,72,15,{fill:C.goldTint});s+=t(tx+36,cy,"SPONSORED",{size:7.5,fill:C.gold,weight:700,anchor:"middle",ls:.6});cy+=16;}
  else{s+=t(tx,cy,step,{size:8,fill:C.brass,weight:700,ls:1});cy+=15;}
  s+=t(tx,cy+4,name,{size:12.5,weight:700});s+=t(tx,cy+21,why,{size:10,fill:C.muted});s+=t(tx,cy+40,price,{size:12,weight:700,fill:brand});
  s+=pill(x+w-72,y+50,60,26,{fill:brand});s+=t(x+w-42,y+67,"Add",{size:10.5,fill:"#fff",weight:600,anchor:"middle"});return s;
}

/* ======================= 1 · WIDGET + QUESTIONNAIRE FLOW ================= */
function widgetFlow(){
  const W=1460,H=900;let b="";
  b+=`<circle cx="180" cy="240" r="200" fill="${C.tealTint}" opacity=".55" filter="url(#blur)"/>`;
  b+=`<circle cx="1300" cy="700" r="200" fill="${C.brassTint}" opacity=".6" filter="url(#blur)"/>`;
  b+=t(70,68,"THE WIDGET",{size:12.5,fill:C.brass,weight:700,ls:3});
  b+=line(70,80,150,80,C.brass2,1.4);
  b+=t(66,124,"From a skin concern to a safe, shoppable routine.",{size:34,weight:600,family:SERIF});
  b+=t(70,152,"The embeddable advisor — first-use consent, a short questionnaire, grounded recommendations, and a hard safety stop. English & Arabic.",{size:13.5,fill:C.muted});
  const PY=196,PH=584,PW=400,xs=[70,520,990-20];
  const caps=["Consent + a short questionnaire","Grounded routine · AED pricing · sponsored disclosed","Red-flag → referral, never a diagnosis"];
  const tags=["01 · UNDERSTAND","02 · RECOMMEND","03 · STAY SAFE"];
  // panel frames
  xs.forEach((x,i)=>{b+=r(x,PY,PW,PH,{rx:24,fill:C.white,filter:"url(#sh)"});
    b+=pill(x,PY-2,128,24,{fill:C.ink});b+=t(x+64,PY+14,tags[i],{size:9,fill:"#fff",weight:700,anchor:"middle",ls:1});});
  // ---- Panel 1: consent + questionnaire
  let x=xs[0],ix=x+18,ir=x+PW-18,iw=PW-36;
  b+=widgetHead(x,PY+24,PW);b+=discBar(ix,PY+98,iw);
  let cy=PY+140;
  b+=t(ix,cy,"STEP 1 OF 4 · YOUR SKIN",{size:9,fill:C.brass,weight:700,ls:1.2});
  // progress dots
  for(let d=0;d<4;d++)b+=pill(ir-92+d*24,cy-9,16,5,{fill:d===0?C.teal:C.cream});
  cy+=26;
  b+=t(ix,cy,"What's your skin type?",{size:14.5,weight:600,family:SERIF});cy+=18;
  b+=chip(ix,cy,"Dry",{w:78,sel:true})+chip(ix+88,cy,"Oily",{w:78})+chip(ix+88+88,cy,"Combination",{w:118});cy+=40;
  b+=chip(ix,cy,"Sensitive",{w:96})+chip(ix+106,cy,"Not sure",{w:92});cy+=52;
  b+=t(ix,cy,"Main concern?",{size:14.5,weight:600,family:SERIF});cy+=18;
  b+=chip(ix,cy,"Dullness",{w:88,sel:true})+chip(ix+98,cy,"Dryness",{w:84})+chip(ix+98+94,cy,"Acne",{w:64});cy+=40;
  b+=chip(ix,cy,"Anti-aging",{w:98})+chip(ix+108,cy,"Redness",{w:86});cy+=56;
  b+=t(ix,cy,"Anything we should avoid?",{size:14.5,weight:600,family:SERIF});cy+=18;
  b+=chip(ix,cy,"Fragrance",{w:96,sel:true})+chip(ix+106,cy,"Pregnancy-safe",{w:132,sel:true});cy+=54;
  b+=pill(ix,cy,iw,46,{fill:C.ink});b+=t(x+PW/2,cy+29,"Continue",{size:13.5,fill:"#fff",weight:600,anchor:"middle"});
  // ---- Panel 2: recommend
  x=xs[1];ix=x+18;iw=PW-36;
  b+=widgetHead(x,PY+24,PW);b+=discBar(ix,PY+98,iw);
  cy=PY+140;
  b+=pill(ir=x+PW-18,0,0,0);
  b+=pill(x+PW-18-238,cy-2,238,30,{fill:C.tealTint});b+=t(x+PW-30,cy+18,"Dry skin and some dullness",{size:11.5,fill:C.tealDk,anchor:"end"});cy+=44;
  b+=r(ix,cy,250,40,{rx:14,fill:C.cream});b+=t(ix+14,cy+18,"A gentle two-step routine from",{size:11.5});b+=t(ix+14,cy+33,"Cicabelle — here's why each fits.",{size:11.5});cy+=54;
  b+=prod(ix,cy,iw,{step:"STEP 1 · CLEANSE",name:"Gentle Gel Cleanser",why:"Fragrance-free, barrier-supporting.",price:"AED 79.00"});cy+=96;
  b+=prod(ix,cy,iw,{step:"STEP 2 · HYDRATE",name:"Hydrating Serum",why:"Hyaluronic acid for plump skin.",price:"AED 110.00"});cy+=96;
  b+=prod(ix,cy,iw,{name:"Barrier Repair Cream",why:"Ceramides to lock in hydration.",price:"AED 120.00",sponsored:true,sw:"sw2"});cy+=100;
  b+=pill(ix,cy,iw,44,{fill:C.teal});b+=t(x+PW/2,cy+28,"Add routine to cart",{size:13,fill:"#fff",weight:600,anchor:"middle"});
  // ---- Panel 3: safety
  x=xs[2];ix=x+18;ir=x+PW-18;iw=PW-36;
  b+=widgetHead(x,PY+24,PW);b+=discBar(ix,PY+98,iw);
  cy=PY+140;
  b+=pill(ir-250,cy-2,250,30,{fill:C.warnTint,stroke:"#F0D9C8",sw:1});b+=t(ir-12,cy+18,"It's painful, swollen and bleeding",{size:11.5,fill:C.warnInk,anchor:"end"});cy+=48;
  b+=r(ix,cy,iw,118,{rx:14,fill:C.warnTint,stroke:"#F0D9C8",sw:1});b+=r(ix,cy,3,118,{rx:2,fill:C.warnRule});
  b+=`<path d="M${ix+22} ${cy+22} l13 5 v11 c0 9 -6 14 -13 17 c-7 -3 -13 -8 -13 -17 v-11 z" fill="none" stroke="${C.warnRule}" stroke-width="2"/>`;
  b+=t(ix+48,cy+30,"This may need a professional.",{size:13,fill:C.warnInk,weight:700});
  b+=t(ix+18,cy+54,"I can only share general cosmetic",{size:11.5,fill:C.warnInk});
  b+=t(ix+18,cy+72,"guidance — please see a dermatologist",{size:11.5,fill:C.warnInk});
  b+=t(ix+18,cy+90,"for symptoms like these.",{size:11.5,fill:C.warnInk});
  b+=t(ix+18,cy+108,"Triage: REFER_CLINIC · no products shown",{size:9,fill:"#B08A76"});cy+=136;
  b+=r(ix,cy,iw-30,40,{rx:14,fill:C.cream});b+=t(ix+14,cy+18,"I can still share gentle daily-care",{size:11.5});b+=t(ix+14,cy+33,"tips while you do. Want those?",{size:11.5});cy+=58;
  b+=t(ix,cy,"Output gate also rewrites any diagnosis,",{size:10.5,fill:C.muted});cy+=16;
  b+=t(ix,cy,"“cure”, or guaranteed-result claims.",{size:10.5,fill:C.muted});
  // captions
  xs.forEach((x,i)=>{b+=t(x+2,PY+PH+34,caps[i],{size:12,fill:C.ink2,weight:600});});
  // launcher chip top-right
  b+=pill(W-260,54,190,46,{fill:"url(#gTeal)",filter:"url(#sh2)"});
  b+=`<circle cx="${W-232}" cy="77" r="5" fill="#fff" opacity=".9"/>`;b+=t(W-216,82,"Skincare advisor",{size:13.5,fill:"#fff",weight:600});
  return doc(W,H,b);
}

/* ============================ 2 · ADMIN CONTROL ROOM ===================== */
function admin(){
  const W=1460,H=940;let b="";
  const SW=250; // sidebar
  b+=r(0,0,SW,H,{fill:"url(#ink)"});
  // brand
  b+=r(22,26,34,34,{rx:10,fill:"url(#gBrass)"});b+=t(39,49,"D",{size:15,fill:"#fff",weight:700,anchor:"middle",family:SERIF});
  b+=t(66,42,"DermaGuru",{size:15,fill:"#fff",weight:600});b+=t(66,56,"PLATFORM",{size:8,fill:"rgba(255,255,255,.5)",weight:700,ls:2});
  const nav=[["seg","CONTROL ROOM"],["a","Overview",1],["a","Tenants"],["a","Sponsored marketplace"],["a","Safety review"],["a","Catalog ingestion"],["seg","INSIGHT"],["a","Analytics"],["a","Billing & payouts"],["seg","SYSTEM"],["a","Settings"],["a","Audit log"]];
  let ny=92;for(const n of nav){if(n[0]==="seg"){b+=t(24,ny+12,n[1],{size:8.5,fill:"rgba(255,255,255,.36)",weight:700,ls:2});ny+=30;}
    else{const act=n[2];if(act){b+=r(14,ny-4,SW-28,34,{rx:10,fill:"rgba(255,255,255,.10)"});b+=r(14,ny-4,3,34,{rx:2,fill:C.brass2});}
      b+=`<circle cx="32" cy="${ny+13}" r="4" fill="${act?C.brass2:"rgba(255,255,255,.4)"}"/>`;
      b+=t(48,ny+17,n[1],{size:12.5,fill:act?"#fff":"rgba(255,255,255,.72)",weight:act?600:500});ny+=40;}}
  b+=r(14,H-64,SW-28,44,{rx:12,fill:"rgba(255,255,255,.06)"});b+=`<circle cx="40" cy="${H-42}" r="13" fill="url(#gBrass)"/>`;b+=t(40,H-38,"S",{size:12,fill:"#fff",weight:700,anchor:"middle"});b+=t(62,H-46,"Super admin",{size:11.5,fill:"#fff",weight:600});b+=t(62,H-31,"platform owner",{size:9,fill:"rgba(255,255,255,.5)"});
  // main
  const MX=SW,MW=W-SW;
  b+=r(MX,0,MW,76,{fill:C.cream});b+=line(MX,76,W,76);
  b+=t(MX+34,48,"Control room",{size:24,weight:600,family:SERIF});
  b+=pill(W-300,24,150,40,{fill:C.white,stroke:C.line,sw:1});b+=`<circle cx="${W-280}" cy="44" r="4" fill="${C.muted}"/>`;b+=t(W-266,49,"Search platform…",{size:11.5,fill:C.muted});
  b+=pill(W-138,24,86,40,{fill:C.safeTint});b+=`<circle cx="${W-120}" cy="44" r="4" fill="${C.safe}"/>`;b+=t(W-108,48,"Healthy",{size:11,fill:"#0B5E43",weight:600});
  // metrics
  const mx=MX+34,mw=(MW-68-3*16)/4;const mets=[["ACTIVE TENANTS","38","▲ 4 this week",C.safe],["PUBLIC CONSULTATIONS · TODAY","12,840","▲ 9%",C.safe],["SPONSORED REVENUE · MTD","AED 41,250","▲ 22%",C.safe],["SAFETY FLAGS · 24H","17","reviewed & referred",C.brass]];
  mets.forEach((m,i)=>{const x=mx+i*(mw+16);b+=r(x,108,mw,96,{rx:16,fill:C.white,stroke:C.line,sw:1});
    b+=t(x+18,132,m[0],{size:8.5,fill:C.muted,weight:700,ls:.8});b+=t(x+18,170,m[1],{size:27,family:SERIF});b+=t(x+18,190,m[2],{size:10,fill:m[3],weight:600});});
  // tenants table (left)
  const tx=mx,tw=MW*0.56,ty=232;
  b+=r(tx,ty,tw,322,{rx:16,fill:C.white,stroke:C.line,sw:1});
  b+=t(tx+22,ty+30,"Tenants",{size:14,weight:700});b+=pill(tx+tw-128,ty+14,108,30,{fill:C.white,stroke:C.line2,sw:1.2});b+=t(tx+tw-74,ty+33,"Invite tenant",{size:10.5,weight:600,anchor:"middle"});
  const cols=[tx+22,tx+tw*0.40,tx+tw*0.56,tx+tw*0.72,tx+tw-22];
  b+=t(cols[0],ty+58,"TENANT",{size:8.5,fill:C.muted,weight:700,ls:.8});b+=t(cols[1],ty+58,"PLAN",{size:8.5,fill:C.muted,weight:700,ls:.8});b+=t(cols[2],ty+58,"STATUS",{size:8.5,fill:C.muted,weight:700,ls:.8});b+=t(cols[3],ty+58,"MRR",{size:8.5,fill:C.muted,weight:700,ls:.8});b+=t(cols[4],ty+58,"30D",{size:8.5,fill:C.muted,weight:700,ls:.8,anchor:"end"});
  b+=line(tx+18,ty+68,tx+tw-18,ty+68);
  const rows=[["Cicabelle","Growth","Live","AED 499","8,420","ps-live"],["Lumière","Pro","Live","AED 1,299","21,100","ps-live"],["Sahar & Co","Starter","Live","AED 199","2,980","ps-live"],["Botanica","Growth","Review","AED 499","—","ps-rev"],["Maison Dérma","Starter","Paused","AED 0","410","ps-off"]];
  let ry=ty+92;for(const rw of rows){b+=t(cols[0],ry,rw[0],{size:11.5,weight:600});b+=t(cols[1],ry,rw[1],{size:11,fill:C.ink2});
    const st=rw[5],sc=st==="ps-live"?[C.safeTint,"#0B5E43"]:st==="ps-rev"?[C.goldTint,C.gold]:[ "#EFEAE2",C.muted];
    b+=pill(cols[2],ry-13,66,19,{fill:sc[0]});b+=t(cols[2]+33,ry,rw[2],{size:9.5,fill:sc[1],weight:700,anchor:"middle"});
    b+=t(cols[3],ry,rw[3],{size:11,fill:C.ink2});b+=t(cols[4],ry,rw[4],{size:11,fill:C.ink2,anchor:"end"});b+=line(tx+18,ry+14,tx+tw-18,ry+14);ry+=44;}
  // safety review queue (right)
  const sx=tx+tw+22,sw2=MW-68-tw-22,sy=232;
  b+=r(sx,sy,sw2,322,{rx:16,fill:C.white,stroke:C.line,sw:1});
  b+=t(sx+20,sy+30,"Safety review queue",{size:14,weight:700});b+=pill(sx+sw2-78,sy+14,58,22,{fill:C.warnTint});b+=t(sx+sw2-49,sy+30,"4 open",{size:9.5,fill:C.warnInk,weight:700,anchor:"middle"});
  const flags=[["URGENT","EN","“burning + blurred vision”","Blocked · referred"],["REFER_CLINIC","AR","“ملتهبة ومؤلمة منذ أيام”","Blocked · referred"],["REFER_CLINIC","EN","“spreading rash + fever”","Blocked · referred"]];
  let fy=sy+52;for(const f of flags){b+=r(sx+20,fy,sw2-40,74,{rx:12,fill:C.warnTint,stroke:"#F0D9C8",sw:1});b+=r(sx+20,fy,3,74,{rx:2,fill:C.warnRule});
    b+=pill(sx+34,fy+12,90,18,{fill:"#fff"});b+=t(sx+79,fy+25,f[0],{size:8.5,fill:C.warnInk,weight:700,anchor:"middle"});b+=t(sx+sw2-34,fy+26,f[1],{size:9,fill:C.muted,anchor:"end"});
    b+=t(sx+34,fy+46,f[2],{size:11,fill:C.ink2,italic:true});b+=t(sx+34,fy+63,"✓ "+f[3],{size:9.5,fill:C.safe,weight:600});fy+=84;}
  // sponsored review + chart row
  const by=576,bw=(MW-68-16)/2;
  b+=r(mx,by,bw,300,{rx:16,fill:C.white,stroke:C.line,sw:1});
  b+=t(mx+20,by+30,"Sponsored marketplace · review",{size:14,weight:700});
  b+=t(mx+20,by+50,"Paid placements awaiting approval — disclosed, safety-gated.",{size:10,fill:C.muted});
  const sp=[["Lumière","Vitamin C Glow Serum","AED 1.10 / click"],["Botanica","Rosehip Night Oil","AED 38 / 1k views"],["Sahar & Co","Mineral SPF 50","AED 0.95 / click"]];
  let spy=by+74;for(const s of sp){b+=r(mx+20,spy,bw-40,58,{rx:12,fill:C.ivory,stroke:C.line,sw:1});b+=r(mx+32,spy+12,34,34,{rx:9,fill:"url(#sw3)"});
    b+=t(mx+78,spy+24,s[1],{size:11.5,weight:600});b+=t(mx+78,spy+41,s[0]+" · "+s[2],{size:10,fill:C.muted});
    b+=pill(mx+bw-150,spy+17,58,24,{fill:C.teal});b+=t(mx+bw-121,spy+33,"Approve",{size:9.5,fill:"#fff",weight:600,anchor:"middle"});
    b+=pill(mx+bw-86,spy+17,52,24,{fill:"#fff",stroke:C.line2,sw:1});b+=t(mx+bw-60,spy+33,"Reject",{size:9.5,fill:C.ink2,weight:600,anchor:"middle"});spy+=68;}
  // chart
  const cx=mx+bw+16,cw=bw;b+=r(cx,by,cw,300,{rx:16,fill:C.white,stroke:C.line,sw:1});
  b+=t(cx+20,by+30,"Public consultations · 14 days",{size:14,weight:700});
  const vals=[42,48,55,50,62,70,66,74,80,76,88,95,92,104];const cwi=(cw-56)/vals.length,base=by+260,maxv=110;
  vals.forEach((v,i)=>{const bh=v/maxv*180,bx=cx+28+i*cwi;b+=r(bx,base-bh,cwi-8,bh,{rx:5,fill:"url(#gTeal)"});});
  b+=line(cx+20,base+1,cx+cw-20,base+1,C.line);
  return doc(W,H,b);
}

/* ============================ 3 · LOGIC FLOW CHART ======================= */
function flow(){
  const W=1460,H=860;let b="";
  b+=`<circle cx="200" cy="180" r="180" fill="${C.tealTint}" opacity=".5" filter="url(#blur)"/>`;
  b+=`<circle cx="1280" cy="720" r="180" fill="${C.brassTint}" opacity=".55" filter="url(#blur)"/>`;
  b+=t(70,70,"LOGIC & SAFETY FLOW",{size:12.5,fill:C.brass,weight:700,ls:3});b+=line(70,82,196,82,C.brass2,1.4);
  b+=t(66,124,"How every consultation stays grounded and safe.",{size:32,weight:600,family:SERIF});
  const node=(x,y,w,h,title,sub,o={})=>{let s=r(x,y,w,h,{rx:14,fill:o.fill??C.white,stroke:o.stroke??C.line2,sw:o.sw??1.2,filter:o.sh?"url(#sh2)":undefined});
    if(o.tag)s+=t(x+16,y+22,o.tag,{size:8.5,fill:o.tagc??C.brass,weight:700,ls:1});
    s+=t(x+16,y+(o.tag?42:28),title,{size:o.ts??14,weight:700,fill:o.tc??C.ink,family:o.serif?SERIF:SANS});
    if(sub)s+=t(x+16,y+(o.tag?60:46),sub,{size:10,fill:o.subc??C.muted});return s;};
  const arrow=(x1,y1,x2,y2,m="arr",st=C.faint)=>`<path d="M${x1} ${y1} C ${(x1+x2)/2} ${y1}, ${(x1+x2)/2} ${y2}, ${x2} ${y2}" fill="none" stroke="${st}" stroke-width="2" marker-end="url(#${m})"/>`;
  // row Y centers
  const yMid=300, col=[70,330,590,860,1130];
  // Shopper
  b+=node(col[0],yMid-44,180,88,"Shopper","Types / speaks a concern",{tag:"ENTRY",sh:true});
  // Widget (two modes)
  b+=node(col[1],yMid-58,200,116,"Widget","",{tag:"DELIVERY",sh:true});
  b+=t(col[1]+16,yMid-4,"Private → own catalog",{size:10.5,fill:C.ink2});
  b+=t(col[1]+16,yMid+16,"Public → Cicabelle +",{size:10.5,fill:C.ink2});
  b+=t(col[1]+16,yMid+32,"sponsored marketplace",{size:10.5,fill:C.gold,weight:600});
  // Input gate
  b+=node(col[2],yMid-58,210,116,"Input safety gate","Deterministic triage",{tag:"GATE 1",tagc:C.warnRule,sh:true});
  b+=t(col[2]+16,yMid+22,"LOW · CAUTION · REFER · URGENT",{size:9,fill:C.muted,weight:600});
  // Referral branch (up)
  b+=node(col[3]-10,yMid-200,250,92,"Referral · see a professional","Red-flag → no products shown",{fill:C.warnTint,stroke:"#F0D9C8",sw:1,tag:"URGENT / REFER",tagc:C.warnRule,tc:C.warnInk,subc:C.warnInk});
  // Retrieval (ok path)
  b+=node(col[3],yMid-58,230,116,"Grounded retrieval","pgvector over tenant catalog",{tag:"OK PATH",tagc:C.teal,sh:true});
  b+=t(col[3]+16,yMid+24,"only real, in-stock SKUs",{size:9.5,fill:C.muted});
  // Claude
  b+=node(col[3]+10,yMid+150,250,92,"Claude · grounded synthesis","Explains; never invents or diagnoses",{tag:"AI",tagc:C.teal,sh:true});
  // Output gate
  b+=node(col[4]-30,yMid+150,260,92,"Output safety gate","Rewrites diagnosis / cure / guarantee",{tag:"GATE 2",tagc:C.warnRule,sh:true});
  // Results
  b+=node(col[4]-30,yMid-58,260,116,"Routine results","Cards · AED · why · add-to-cart",{tag:"DELIVER",tagc:C.teal,sh:true});
  b+=t(col[4]-14,yMid+24,"Public: + disclosed Sponsored",{size:9.5,fill:C.gold,weight:600});
  // Attribution
  b+=node(col[4]-30,yMid-200,260,92,"Add to cart + attribution","Impression · click · conversion",{tag:"OUTCOME",sh:true});
  // arrows
  b+=arrow(250,yMid,col[1],yMid);
  b+=arrow(col[1]+200,yMid,col[2],yMid);
  b+=arrow(col[2]+210,yMid-20,col[3]-10,yMid-154,"arrW",C.warnRule); // to referral
  b+=arrow(col[2]+210,yMid+10,col[3],yMid,"arrT",C.teal); // to retrieval
  b+=arrow(col[3]+115,yMid+58,col[3]+135,yMid+150,"arrT",C.teal); // retrieval -> claude (down)
  b+=arrow(col[3]+260,yMid+196,col[4]-30,yMid+196,"arr"); // claude -> output gate
  b+=arrow(col[4]+100,yMid+150,col[4]+100,yMid+58,"arrT",C.teal); // output gate -> results (up)
  b+=arrow(col[4]+100,yMid-58,col[4]+100,yMid-108,"arr"); // results -> attribution
  // legend
  const ly=H-92;b+=line(70,ly-18,W-70,ly-18,C.line);
  const leg=[["Advisor, not medical",C.warnRule],["Catalog-grounded only",C.teal],["Sponsored disclosed & suppressed on red flags",C.gold],["Bilingual EN / AR",C.brass]];
  let lx=70;for(const[txt,c]of leg){b+=`<circle cx="${lx+6}" cy="${ly}" r="5" fill="${c}"/>`;b+=t(lx+20,ly+4,txt,{size:11.5,fill:C.ink2,weight:600});lx+=txt.length*7.0+60;}
  return doc(W,H,b);
}

const boards=[["10-widget-flow",widgetFlow()],["11-admin-control-room",admin()],["12-logic-flow",flow()]];
for(const[n,svg]of boards){writeFileSync(join(DIR,n+".svg"),svg);
  const i=await sharp(Buffer.from(svg)).png({compressionLevel:9,palette:true,quality:90}).toFile(join(DIR,n+".png"));console.log(`✓ ${n}.png ${i.width}×${i.height} ${(i.size/1024|0)}KB`);}
console.log("done");
