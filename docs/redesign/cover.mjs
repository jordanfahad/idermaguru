// Renders a luxe cover PNG faithful to prototype/home.html's hero (for inline preview).
// Raster fonts fall back to DejaVu Serif/Sans; the real pages use Fraunces + Inter.
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const DIR = dirname(fileURLToPath(import.meta.url));

const C = { ink:"#17130F", ink2:"#3D362F", muted:"#736A60", faint:"#A89E92",
  ivory:"#FBF9F5", cream:"#F4EFE7", white:"#FFFFFF", line:"rgba(23,19,15,0.12)",
  brass:"#9A7B4F", brass2:"#B9986A", teal:"#1F6F5C", tealDk:"#123F34", tealTint:"#E7F1EE",
  safe:"#0F7A55", safeTint:"#E9F8EF", gold:"#9A6B2F", goldTint:"#F4EBD9" };
const SANS="'Helvetica Neue',Arial,sans-serif", SERIF="Georgia,'Times New Roman',serif";
const esc=s=>String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const t=(x,y,s,o={})=>`<text x="${x}" y="${y}" font-size="${o.size??14}" fill="${o.fill??C.ink}" font-weight="${o.weight??400}" font-family="${o.family??SANS}"${o.anchor?` text-anchor="${o.anchor}"`:""}${o.ls!=null?` letter-spacing="${o.ls}"`:""}${o.italic?` font-style="italic"`:""}>${esc(s)}</text>`;
const r=(x,y,w,h,o={})=>`<rect x="${x}" y="${y}" width="${w}" height="${h}"${o.rx!=null?` rx="${o.rx}"`:""} fill="${o.fill??"none"}"${o.stroke?` stroke="${o.stroke}"`:""}${o.sw?` stroke-width="${o.sw}"`:""}${o.filter?` filter="${o.filter}"`:""}/>`;
const pill=(x,y,w,h,o={})=>r(x,y,w,h,{rx:h/2,...o});

const W=1200,H=760;
let b="";
b+=`<rect width="${W}" height="${H}" fill="${C.ivory}"/>`;
b+=`<circle cx="1080" cy="150" r="240" fill="${C.tealTint}" opacity="0.6" filter="url(#blur)"/>`;
b+=`<circle cx="120" cy="720" r="200" fill="${C.goldTint}" opacity="0.5" filter="url(#blur)"/>`;
// nav
b+=`<rect x="70" y="34" width="34" height="34" rx="10" fill="url(#gt)"/>`;
b+=t(88,57,"D",{size:16,fill:"#fff",weight:700,anchor:"middle",family:SERIF});
b+=t(116,50,"DermaGuru",{size:17,weight:600});
b+=t(116,63,"AI SKINCARE ADVISOR",{size:8,fill:C.faint,weight:600,ls:1.5});
b+=t(720,55,"Live consultation",{size:12.5,fill:C.ink2,anchor:"middle"});
b+=t(854,55,"Pricing",{size:12.5,fill:C.ink2,anchor:"middle"});
b+=t(946,55,"About",{size:12.5,fill:C.ink2,anchor:"middle"});
b+=pill(1006,34,124,36,{fill:C.ink});
b+=t(1068,57,"Add to store",{size:12.5,fill:"#fff",weight:600,anchor:"middle"});
b+=`<line x1="70" y1="92" x2="1130" y2="92" stroke="${C.line}"/>`;
// left column
b+=pill(70,150,330,30,{fill:C.white,stroke:C.line,sw:1});
b+=`<circle cx="90" cy="165" r="4" fill="${C.teal}"/>`;
b+=t(104,169,"SKINCARE ADVISOR — NEVER MEDICAL ADVICE",{size:10.5,fill:C.ink2,weight:600,ls:0.6});
b+=t(66,248,"Beauty advice that",{size:62,weight:600,family:SERIF});
b+=`<text x="66" y="320" font-size="62" font-weight="600" font-family="${SERIF}"><tspan fill="${C.ink}">actually</tspan><tspan fill="${C.teal}" font-style="italic" dx="14">converts.</tspan></text>`;
b+=t(70,372,"An embeddable AI advisor that understands a shopper's skin — in",{size:16.5,fill:C.ink2});
b+=t(70,398,"English or Arabic — and recommends only what you actually sell.",{size:16.5,fill:C.ink2});
b+=pill(70,432,196,52,{fill:C.ink});
b+=t(168,464,"Add to your store",{size:14.5,fill:"#fff",weight:600,anchor:"middle"});
b+=pill(278,432,178,52,{fill:C.white,stroke:C.line,sw:1.4});
b+=t(367,464,"Try the live demo →",{size:14.5,weight:600,anchor:"middle"});
// trust chips
const trust=[["Catalog-grounded",156],["Arabic & RTL",128],["PDPL / GDPR-ready",168]];
let tx=70;
for(const[label,w]of trust){
  b+=pill(tx,514,w,34,{fill:C.safeTint});
  b+=`<path d="M${tx+16} ${531} l4 4 l8 -9" fill="none" stroke="${C.safe}" stroke-width="2"/>`;
  b+=t(tx+34,535,label,{size:12,fill:"#0B5E43",weight:600});
  tx+=w+12;
}
// right: hero art + floating advisor panel
const AX=706,AY=140,AW=380,AH=470;
b+=r(AX,AY,AW,AH,{rx:26,fill:"url(#champ)",filter:"url(#sh)"});
b+=t(AX+28,AY+52,"The Ritual",{size:13,fill:"#fff",weight:600,ls:2});
b+=t(AX+26,AY+92,"Editorial",{size:30,fill:"#fff",weight:600,family:SERIF});
b+=t(AX+26,AY+124,"skincare, grounded.",{size:30,fill:"#fff",weight:600,family:SERIF,italic:true});
// floating advisor mini-panel
const PX=AX-44,PY=AY+250,PW=300;
b+=r(PX,PY,PW,210,{rx:18,fill:C.white,filter:"url(#sh)"});
b+=r(PX+16,PY+16,34,34,{rx:10,fill:"url(#gt)"});
b+=t(PX+33,PY+39,"C",{size:15,fill:"#fff",weight:700,anchor:"middle",family:SERIF});
b+=t(PX+58,PY+30,"Cicabelle",{size:13,weight:700});
b+=`<circle cx="${PX+62}" cy="${PY+42}" r="3" fill="${C.safe}"/>`;
b+=t(PX+70,PY+45,"Skincare advisor · online",{size:9.5,fill:C.muted});
b+=r(PX+16,PY+62,PW-32,22,{rx:7,fill:C.tealTint});
b+=t(PX+26,PY+77,"Educational guidance — not medical advice.",{size:9.5,fill:C.tealDk,weight:600});
b+=pill(PX+PW-150,PY+96,134,30,{fill:C.tealTint});
b+=t(PX+PW-22,PY+116,"Dry skin & some dullness?",{size:10.5,fill:C.tealDk,anchor:"end"});
// product card
b+=r(PX+16,PY+136,PW-32,58,{rx:12,fill:C.white,stroke:C.line,sw:1});
b+=r(PX+26,PY+146,38,38,{rx:9,fill:"url(#sw)"});
b+=t(PX+74,PY+158,"STEP 1 · CLEANSE",{size:7.5,fill:C.brass,weight:700,ls:1});
b+=t(PX+74,PY+173,"Gentle Gel Cleanser",{size:12,weight:600});
b+=t(PX+74,PY+188,"AED 79.00",{size:11,fill:C.teal,weight:700});
b+=pill(PX+PW-72,PY+150,56,24,{fill:C.teal});
b+=t(PX+PW-44,PY+166,"Add",{size:10.5,fill:"#fff",weight:600,anchor:"middle"});

const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${W*2}" height="${H*2}" viewBox="0 0 ${W} ${H}" font-family="${SANS}">
<defs>
<linearGradient id="gt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2A8067"/><stop offset="1" stop-color="${C.tealDk}"/></linearGradient>
<linearGradient id="champ" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#C9B79B"/><stop offset="1" stop-color="#8C7355"/></linearGradient>
<linearGradient id="sw" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#EAF3F0"/><stop offset="1" stop-color="#CFE4DD"/></linearGradient>
<filter id="sh" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="24" stdDeviation="36" flood-color="#2A211C" flood-opacity="0.18"/></filter>
<filter id="blur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="60"/></filter>
</defs>
<rect width="${W}" height="${H}" fill="${C.ivory}"/>${b}</svg>`;
writeFileSync(join(DIR,"04-home-cover.svg"),svg);
const info=await sharp(Buffer.from(svg)).png().toFile(join(DIR,"04-home-cover.png"));
console.log(`✓ 04-home-cover.png ${info.width}×${info.height} ${(info.size/1024).toFixed(0)}KB`);
