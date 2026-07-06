// DermaGuru redesign — generates world-class design artboards as crisp 2x PNGs.
// Run: node docs/redesign/build.mjs   (uses the repo's local `sharp`)
import sharp from "sharp";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = dirname(fileURLToPath(import.meta.url));

/* ----------------------------- design tokens ----------------------------- */
const T = {
  ink: "#1A1714", inkSoft: "#3A332E", muted: "#6E6660", faint: "#A39B92",
  sand: "#FAF8F5", paper: "#F1EEE9", white: "#FFFFFF",
  line: "rgba(20,17,16,0.09)", lineMid: "rgba(20,17,16,0.14)",
  teal: "#1F6F5C", tealDk: "#12473A", tealTint: "#E7F1EE", tealTint2: "#D6E7E1",
  rose: "#B75D6E", roseDk: "#8A4250", roseTint: "#F6E9EC", roseTint2: "#EFD9DE",
  gold: "#9A6B2F", goldTint: "#F6EDDC",
  safe: "#0F7A55", safeTint: "#E9F8EF",
  warnInk: "#7A3F25", warnTint: "#FFF6EF", warnRule: "#D2754B",
};
const SANS = "'Helvetica Neue', Arial, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

/* ------------------------------- svg helpers ------------------------------ */
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function t(x, y, s, o = {}) {
  const a = [
    `x="${x}"`, `y="${y}"`, `font-size="${o.size ?? 13}"`,
    `fill="${o.fill ?? T.ink}"`, `font-weight="${o.weight ?? 400}"`,
    `font-family="${o.family ?? SANS}"`,
    o.anchor ? `text-anchor="${o.anchor}"` : "",
    o.ls != null ? `letter-spacing="${o.ls}"` : "",
    o.rtl ? `direction="rtl"` : "",
    o.op != null ? `opacity="${o.op}"` : "",
  ].filter(Boolean).join(" ");
  return `<text ${a}>${esc(s)}</text>`;
}
function r(x, y, w, h, o = {}) {
  const a = [
    `x="${x}"`, `y="${y}"`, `width="${w}"`, `height="${h}"`,
    o.rx != null ? `rx="${o.rx}"` : "",
    `fill="${o.fill ?? "none"}"`,
    o.stroke ? `stroke="${o.stroke}"` : "",
    o.sw ? `stroke-width="${o.sw}"` : "",
    o.op != null ? `opacity="${o.op}"` : "",
    o.filter ? `filter="${o.filter}"` : "",
  ].filter(Boolean).join(" ");
  return `<rect ${a}/>`;
}
const pill = (x, y, w, h, o = {}) => r(x, y, w, h, { rx: h / 2, ...o });
function spark(cx, cy, rad, fill) {
  const p = `M${cx} ${cy - rad} C ${cx + rad * 0.18} ${cy - rad * 0.18}, ${cx + rad * 0.18} ${cy - rad * 0.18}, ${cx + rad} ${cy} ` +
            `C ${cx + rad * 0.18} ${cy + rad * 0.18}, ${cx + rad * 0.18} ${cy + rad * 0.18}, ${cx} ${cy + rad} ` +
            `C ${cx - rad * 0.18} ${cy + rad * 0.18}, ${cx - rad * 0.18} ${cy + rad * 0.18}, ${cx - rad} ${cy} ` +
            `C ${cx - rad * 0.18} ${cy - rad * 0.18}, ${cx - rad * 0.18} ${cy - rad * 0.18}, ${cx} ${cy - rad} Z`;
  return `<path d="${p}" fill="${fill}"/>`;
}
// little product "bottle" so swatches read as real products
function bottle(cx, top, h, color, cap) {
  const bw = h * 0.5, x = cx - bw / 2;
  return `<g>
    <rect x="${cx - bw * 0.22}" y="${top}" width="${bw * 0.44}" height="${h * 0.16}" rx="3" fill="${cap}"/>
    <rect x="${x}" y="${top + h * 0.14}" width="${bw}" height="${h * 0.86}" rx="${bw * 0.26}" fill="${color}"/>
    <rect x="${x + bw * 0.16}" y="${top + h * 0.42}" width="${bw * 0.68}" height="${h * 0.3}" rx="3" fill="#ffffff" opacity="0.55"/>
  </g>`;
}

const DEFS = `
<defs>
  <linearGradient id="bgSand" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#FCFBF8"/><stop offset="0.55" stop-color="${T.sand}"/><stop offset="1" stop-color="#F0ECE6"/>
  </linearGradient>
  <linearGradient id="gTeal" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2A8067"/><stop offset="1" stop-color="${T.tealDk}"/>
  </linearGradient>
  <linearGradient id="gRose" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#C76E7E"/><stop offset="1" stop-color="${T.roseDk}"/>
  </linearGradient>
  <linearGradient id="sw1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#EAF3F0"/><stop offset="1" stop-color="#CFE4DD"/></linearGradient>
  <linearGradient id="sw2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F7EBEE"/><stop offset="1" stop-color="#E7CDD4"/></linearGradient>
  <linearGradient id="sw3" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#F6EEDD"/><stop offset="1" stop-color="#E6D6B8"/></linearGradient>
  <linearGradient id="sw4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#EDF1EA"/><stop offset="1" stop-color="#D3DEC8"/></linearGradient>
  <filter id="fCard" x="-40%" y="-40%" width="180%" height="180%"><feDropShadow dx="0" dy="22" stdDeviation="34" flood-color="#2A211C" flood-opacity="0.16"/></filter>
  <filter id="fSoft" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="0" dy="10" stdDeviation="18" flood-color="#2A211C" flood-opacity="0.16"/></filter>
  <filter id="fBlur" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="46"/></filter>
</defs>`;

function doc(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}" font-family="${SANS}">${DEFS}<rect width="${w}" height="${h}" fill="url(#bgSand)"/>${body}</svg>`;
}

/* --------- shared widget pieces (themeable: teal tenant / rose tenant) ----- */
function productCard(x, y, w, theme, { step, name, why, price, sponsored }) {
  const c = theme.brand, tint = theme.swatch;
  const addW = 64, addX = x + w - 16 - addW, addY = y + 56;
  let s = r(x, y, w, 92, { rx: 16, fill: T.white, stroke: T.line, sw: 1 });
  s += r(x + 14, y + 14, 64, 64, { rx: 12, fill: `url(#${tint})` });
  s += bottle(x + 14 + 32, y + 22, 50, theme.bottle, theme.cap);
  const tx = x + 92;
  let cy = y + 22;
  if (sponsored) {
    s += pill(tx, cy - 11, 70, 15, { fill: T.goldTint });
    s += t(tx + 35, cy, "SPONSORED", { size: 8, fill: T.gold, weight: 700, anchor: "middle", ls: 0.6 });
    cy += 18;
  } else {
    s += t(tx, cy, step, { size: 8.5, fill: c, weight: 700, ls: 1 });
    cy += 16;
  }
  s += t(tx, cy + 4, name, { size: 13, weight: 700 });
  s += t(tx, cy + 21, why, { size: 10.5, fill: T.muted });
  s += t(tx, cy + 40, price, { size: 12.5, weight: 700, fill: c });
  s += pill(addX, addY, addW, 26, { fill: c });
  s += t(addX + addW / 2, addY + 17, "Add", { size: 11, fill: "#fff", weight: 600, anchor: "middle" });
  return s;
}

/* ============================ Artboard 1 — EN ============================= */
function widgetEN() {
  const W = 1000, H = 824;
  const th = { brand: T.teal, swatch: "sw1", bottle: "#7FB4A4", cap: "#3F6F61" };
  const PX = 308, PW = 384, PAD = 22, IX = PX + PAD, IR = PX + PW - PAD, CW = IR - IX;
  const PY = 124, PH = 600;
  let b = "";
  // backdrop blobs
  b += `<circle cx="190" cy="300" r="150" fill="${T.tealTint}" opacity="0.7" filter="url(#fBlur)"/>`;
  b += `<circle cx="840" cy="600" r="150" fill="${T.roseTint}" opacity="0.6" filter="url(#fBlur)"/>`;
  // caption
  b += t(64, 60, "DermaGuru — the embeddable skincare advisor", { size: 23, weight: 700, ls: -0.3 });
  b += t(64, 86, "Shadow-DOM web component · brand-tokened · grounded in the store's real catalog · ~7KB", { size: 12.5, fill: T.muted });
  b += pill(PX + PW - 132, 95, 132, 24, { fill: T.white, stroke: T.line, sw: 1 });
  b += `<circle cx="${PX + PW - 116}" cy="107" r="4" fill="${T.teal}"/>`;
  b += t(PX + PW - 104, 111, "ENGLISH · LTR", { size: 10.5, fill: T.inkSoft, weight: 700, ls: 0.4 });
  // panel
  b += r(PX, PY, PW, PH, { rx: 24, fill: T.white, filter: "url(#fCard)" });
  // header
  b += r(IX, PY + 22, 40, 40, { rx: 12, fill: "url(#gTeal)" });
  b += t(IX + 20, PY + 48, "C", { size: 18, fill: "#fff", weight: 700, anchor: "middle" });
  b += t(IX + 52, PY + 40, "Cicabelle", { size: 15, weight: 700 });
  b += `<circle cx="${IX + 56}" cy="${PY + 53}" r="3" fill="${T.safe}"/>`;
  b += t(IX + 64, PY + 56, "Skincare advisor · online", { size: 10.5, fill: T.muted });
  b += t(IR, PY + 46, "×", { size: 20, fill: T.faint, anchor: "end" });
  b += r(IX, PY + 74, CW, 26, { rx: 8, fill: T.tealTint });
  b += t(IX + 12, PY + 91, "Educational beauty guidance — not medical advice.", { size: 10.5, fill: T.tealDk, weight: 600 });
  // chat
  let cy = 244;
  b += r(IX, cy, 304, 58, { rx: 16, fill: T.paper });
  b += t(IX + 14, cy + 24, "Hi! Tell me your main skin concern and I'll", { size: 12.5 });
  b += t(IX + 14, cy + 42, "build a simple routine from this store.", { size: 12.5 });
  cy += 74;
  const chips = [["Dryness", 74], ["Dullness", 74], ["Sensitivity", 88]];
  let chx = IX;
  for (const [label, cw] of chips) {
    b += pill(chx, cy, cw, 28, { fill: T.white, stroke: T.tealTint2, sw: 1.2 });
    b += t(chx + cw / 2, cy + 18, label, { size: 11.5, fill: T.teal, weight: 600, anchor: "middle" });
    chx += cw + 8;
  }
  cy += 44;
  b += pill(IR - 250, cy, 250, 32, { fill: T.tealTint });
  b += t(IR - 16, cy + 21, "Dry skin and some dullness", { size: 12.5, anchor: "end", fill: T.tealDk });
  cy += 50;
  b += t(IX, cy, "Here's a gentle two-step routine —", { size: 12, fill: T.muted });
  cy += 16;
  b += productCard(IX, cy, CW, th, { step: "STEP 1 · CLEANSE", name: "Gentle Gel Cleanser", why: "Fragrance-free, supports your skin barrier.", price: "AED 79.00" });
  cy += 104;
  b += productCard(IX, cy, CW, th, { step: "", name: "Barrier Repair Moisturizer", why: "Ceramides to lock in hydration.", price: "AED 120.00", sponsored: true });
  cy += 110;
  // input
  b += r(IX, cy, CW - 50, 40, { rx: 12, fill: T.white, stroke: T.lineMid, sw: 1 });
  b += t(IX + 14, cy + 25, "Ask anything about your skin…", { size: 12, fill: T.faint });
  b += r(IR - 40, cy, 40, 40, { rx: 12, fill: T.teal });
  b += t(IR - 20, cy + 26, "↑", { size: 18, fill: "#fff", anchor: "middle" });
  cy += 54;
  b += t(PX + PW / 2, cy, "Not medical advice · Powered by DermaGuru", { size: 10, fill: T.faint, anchor: "middle" });
  // launcher
  const lx = (W - 200) / 2, ly = 748;
  b += pill(lx, ly, 200, 50, { fill: "url(#gTeal)", filter: "url(#fSoft)" });
  b += spark(lx + 28, ly + 25, 7, "#fff");
  b += t(lx + 46, ly + 30, "Skincare advisor", { size: 14.5, fill: "#fff", weight: 600 });
  return doc(W, H, b);
}

/* ============================ Artboard 2 — AR ============================= */
function widgetAR() {
  const W = 1000, H = 824;
  const th = { brand: T.rose, swatch: "sw2", bottle: "#D29AA6", cap: "#7E4350" };
  const PX = 308, PW = 384, PAD = 22, IX = PX + PAD, IR = PX + PW - PAD, CW = IR - IX;
  const PY = 124, PH = 600;
  let b = "";
  b += `<circle cx="180" cy="560" r="150" fill="${T.tealTint}" opacity="0.6" filter="url(#fBlur)"/>`;
  b += `<circle cx="840" cy="300" r="150" fill="${T.roseTint}" opacity="0.75" filter="url(#fBlur)"/>`;
  b += t(64, 60, "Arabic · RTL — the same component, fully mirrored", { size: 23, weight: 700, ls: -0.3 });
  b += t(64, 86, "One codebase. data-locale=\"ar\" flips layout, type and the safety copy. Right-to-left by default.", { size: 12.5, fill: T.muted });
  b += pill(PX, 95, 120, 24, { fill: T.white, stroke: T.line, sw: 1 });
  b += `<circle cx="${PX + 16}" cy="107" r="4" fill="${T.rose}"/>`;
  b += t(PX + 28, 111, "العربية · RTL", { size: 10.5, fill: T.inkSoft, weight: 700, rtl: true });
  // panel
  b += r(PX, PY, PW, PH, { rx: 24, fill: T.white, filter: "url(#fCard)" });
  // header mirrored (avatar right)
  b += r(IR - 40, PY + 22, 40, 40, { rx: 12, fill: "url(#gRose)" });
  b += t(IR - 20, PY + 48, "C", { size: 18, fill: "#fff", weight: 700, anchor: "middle" });
  b += t(IR - 52, PY + 40, "سيكابيل", { size: 15, weight: 700, anchor: "end", rtl: true });
  b += t(IR - 52, PY + 56, "مستشارة العناية بالبشرة", { size: 10.5, fill: T.muted, anchor: "end", rtl: true });
  b += t(IX, PY + 46, "×", { size: 20, fill: T.faint });
  b += r(IX, PY + 74, CW, 26, { rx: 8, fill: T.roseTint });
  b += t(IR - 12, PY + 91, "إرشادات تجميلية تثقيفية — ليست نصيحة طبية.", { size: 10.5, fill: T.roseDk, weight: 600, anchor: "end", rtl: true });
  // chat
  let cy = 252;
  b += r(IR - 304, cy, 304, 58, { rx: 16, fill: T.paper });
  b += t(IR - 14, cy + 24, "مرحبًا! أخبريني بأهم ما يشغل بشرتكِ", { size: 12.5, anchor: "end", rtl: true });
  b += t(IR - 14, cy + 42, "وسأقترح روتينًا بسيطًا من هذا المتجر.", { size: 12.5, anchor: "end", rtl: true });
  cy += 74;
  const chips = [["جفاف", 64], ["بهتان", 64], ["حساسية", 78]];
  let chx = IR;
  for (const [label, cw] of chips) {
    b += pill(chx - cw, cy, cw, 28, { fill: T.white, stroke: T.roseTint2, sw: 1.2 });
    b += t(chx - cw / 2, cy + 18, label, { size: 11.5, fill: T.rose, weight: 600, anchor: "middle", rtl: true });
    chx -= cw + 8;
  }
  cy += 44;
  b += pill(IX, cy, 260, 32, { fill: T.roseTint });
  b += t(IX + 14, cy + 21, "بشرتي ملتهبة ومؤلمة منذ أيام", { size: 12.5, rtl: true, fill: T.roseDk });
  cy += 50;
  // SAFETY referral card (red-flag → output gate)
  b += r(IX, cy, CW, 98, { rx: 14, fill: T.warnTint, stroke: "#F0D9C8", sw: 1 });
  b += r(IR - 3, cy, 3, 98, { rx: 2, fill: T.warnRule });
  // shield icon (right)
  b += `<path d="M${IR - 18} ${cy + 16} l11 4 v9 c0 7 -5 11 -11 14 c-6 -3 -11 -7 -11 -14 v-9 z" fill="none" stroke="${T.warnRule}" stroke-width="2"/>`;
  b += t(IR - 36, cy + 30, "قد يحتاج هذا إلى مراجعة مختص.", { size: 12, fill: T.warnInk, weight: 700, anchor: "end", rtl: true });
  b += t(IR - 16, cy + 52, "يمكنني تقديم إرشادات تجميلية عامة فقط،", { size: 11.5, fill: T.warnInk, anchor: "end", rtl: true });
  b += t(IR - 16, cy + 70, "ويُفضّل مراجعة طبيب الجلدية للحالة.", { size: 11.5, fill: T.warnInk, anchor: "end", rtl: true });
  b += t(IR - 16, cy + 88, "↑ red-flag → referral (output gate)", { size: 9, fill: "#B08A76", anchor: "end" });
  cy += 116;
  // gentle cosmetic alternative (still helpful, non-medical)
  b += r(IR - 312, cy, 312, 44, { rx: 16, fill: T.roseTint });
  b += t(IR - 14, cy + 27, "يمكنني مشاركة نصائح عامة للعناية بالبشرة.", { size: 11.5, anchor: "end", rtl: true, fill: T.roseDk });
  cy += 58;
  // input mirrored
  b += r(IX + 50, cy, CW - 50, 40, { rx: 12, fill: T.white, stroke: T.lineMid, sw: 1 });
  b += t(IR - 14, cy + 25, "اسأليني عن بشرتكِ…", { size: 12, fill: T.faint, anchor: "end", rtl: true });
  b += r(IX, cy, 40, 40, { rx: 12, fill: T.rose });
  b += t(IX + 20, cy + 26, "↑", { size: 18, fill: "#fff", anchor: "middle" });
  cy += 54;
  b += t(PX + PW / 2, cy, "ليست نصيحة طبية · مشغّل بواسطة DermaGuru", { size: 10, fill: T.faint, anchor: "middle", rtl: true });
  // launcher (left corner in RTL)
  const lx = PX, ly = 748;
  b += pill(lx, ly, 210, 50, { fill: "url(#gRose)", filter: "url(#fSoft)" });
  b += spark(lx + 182, ly + 25, 7, "#fff");
  b += t(lx + 166, ly + 30, "مستشار العناية بالبشرة", { size: 14, fill: "#fff", weight: 600, anchor: "end", rtl: true });
  return doc(W, H, b);
}

/* ==================== Artboard 3 — Landing + system ====================== */
function landing() {
  const W = 1200, H = 904;
  let b = "";
  b += `<circle cx="980" cy="250" r="190" fill="${T.tealTint}" opacity="0.7" filter="url(#fBlur)"/>`;
  b += `<circle cx="220" cy="760" r="170" fill="${T.roseTint}" opacity="0.55" filter="url(#fBlur)"/>`;
  // nav
  b += `<rect x="0" y="0" width="${W}" height="74" fill="rgba(250,248,245,0.7)"/>`;
  b += `<path d="M70 30 l10 7 l-10 7 l-10 -7 z" fill="${T.teal}"/>`;
  b += t(92, 42, "DermaGuru", { size: 17, weight: 700 });
  b += t(840, 42, "Product", { size: 13, fill: T.muted, anchor: "middle" });
  b += t(932, 42, "Pricing", { size: 13, fill: T.muted, anchor: "middle" });
  b += t(1016, 42, "Docs", { size: 13, fill: T.muted, anchor: "middle" });
  b += pill(1066, 22, 110, 36, { fill: T.ink });
  b += t(1121, 45, "Add to store", { size: 12.5, fill: "#fff", weight: 700, anchor: "middle" });
  // hero copy
  b += t(70, 168, "AI SKINCARE ADVISOR · SHOPIFY & WOOCOMMERCE", { size: 12, fill: T.teal, weight: 700, ls: 1.4 });
  b += t(66, 222, "Turn skin concerns", { size: 52, weight: 700, family: SERIF });
  b += t(66, 278, "into confident", { size: 52, weight: 700, family: SERIF });
  b += `<text x="66" y="334" font-size="52" font-weight="700" font-family="${SERIF}"><tspan fill="${T.ink}">skincare </tspan><tspan fill="${T.teal}" font-style="italic" dx="8">routines.</tspan></text>`;
  b += t(70, 380, "An embeddable advisor that recommends only what the store actually", { size: 16, fill: T.inkSoft });
  b += t(70, 404, "sells — grounded, safe, and fully bilingual. Never diagnostic.", { size: 16, fill: T.inkSoft });
  b += pill(70, 432, 188, 52, { fill: T.ink });
  b += t(164, 464, "Add to your store", { size: 14.5, fill: "#fff", weight: 700, anchor: "middle" });
  b += pill(270, 432, 150, 52, { fill: T.white, stroke: T.lineMid, sw: 1.4 });
  b += spark(300, 458, 6, T.teal);
  b += t(320, 464, "See it live", { size: 14.5, weight: 700, anchor: "start" });
  const trust = [["Catalog-grounded", 150], ["Arabic & RTL", 120], ["Not medical advice", 162], ["PDPL-ready", 110]];
  let txx = 70;
  for (const [label, cw] of trust) {
    b += pill(txx, 512, cw, 34, { fill: T.safeTint });
    b += `<path d="M${txx + 16} ${529} l4 4 l8 -9" fill="none" stroke="${T.safe}" stroke-width="2"/>`;
    b += t(txx + 34, 533, label, { size: 12, fill: "#0B5E43", weight: 600 });
    txx += cw + 10;
  }
  // hero right — floating mini widget
  const MX = 762, MY = 150, MW = 372, MH = 392;
  b += r(MX, MY, MW, MH, { rx: 22, fill: T.white, filter: "url(#fCard)" });
  b += r(MX + 20, MY + 20, 36, 36, { rx: 11, fill: "url(#gTeal)" });
  b += t(MX + 38, MY + 44, "C", { size: 16, fill: "#fff", weight: 700, anchor: "middle" });
  b += t(MX + 64, MY + 36, "Cicabelle", { size: 14, weight: 700 });
  b += t(MX + 64, MY + 51, "Skincare advisor", { size: 10, fill: T.muted });
  b += r(MX + 20, MY + 70, MW - 40, 24, { rx: 8, fill: T.tealTint });
  b += t(MX + 32, MY + 86, "Educational guidance — not medical advice.", { size: 10, fill: T.tealDk, weight: 600 });
  b += r(MX + 20, MY + 104, 230, 40, { rx: 14, fill: T.paper });
  b += t(MX + 32, MY + 122, "Dry skin and some dullness —", { size: 11, fill: T.ink });
  b += t(MX + 32, MY + 137, "what should I use?", { size: 11, fill: T.ink });
  const th = { brand: T.teal, swatch: "sw1", bottle: "#7FB4A4", cap: "#3F6F61" };
  b += productCard(MX + 20, MY + 158, MW - 40, th, { step: "STEP 1 · CLEANSE", name: "Gentle Gel Cleanser", why: "Fragrance-free, barrier-supporting.", price: "AED 79.00" });
  b += productCard(MX + 20, MY + 262, MW - 40, th, { step: "STEP 2 · HYDRATE", name: "Hydrating Serum", why: "Hyaluronic acid for plump skin.", price: "AED 110.00" });
  // launcher chip floating
  b += pill(MX + MW - 150, MY + MH - 4, 150, 44, { fill: "url(#gTeal)", filter: "url(#fSoft)" });
  b += spark(MX + MW - 128, MY + MH + 18, 6, "#fff");
  b += t(MX + MW - 112, MY + MH + 23, "Skincare advisor", { size: 12.5, fill: "#fff", weight: 600 });

  /* ---- design-system board ---- */
  const BY = 610;
  b += `<line x1="70" y1="${BY - 26}" x2="${W - 70}" y2="${BY - 26}" stroke="${T.line}"/>`;
  b += t(70, BY, "DESIGN SYSTEM", { size: 12, fill: T.muted, weight: 700, ls: 1.4 });
  b += t(68, BY + 34, "One calm system — tokened, themeable, bilingual.", { size: 24, weight: 700, family: SERIF });
  // swatches
  const sw = [["Ink", T.ink, "#FFFFFF"], ["Teal", T.teal, "#FFFFFF"], ["Rose", T.rose, "#FFFFFF"],
              ["Sand", T.paper, T.ink], ["Gold", T.gold, "#FFFFFF"], ["Safe", T.safe, "#FFFFFF"]];
  let sx = 70;
  for (const [name, hex, fg] of sw) {
    b += r(sx, BY + 60, 110, 72, { rx: 14, fill: hex, stroke: T.line, sw: 1 });
    b += t(sx + 14, BY + 104, name, { size: 13, fill: fg, weight: 700 });
    b += t(sx + 14, BY + 120, hex.toUpperCase(), { size: 9.5, fill: fg, op: 0.8 });
    sx += 122;
  }
  // type scale
  const TX = 70, TY = BY + 168;
  b += t(TX, TY, "TYPE", { size: 10, fill: T.faint, weight: 700, ls: 1.2 });
  b += t(TX - 2, TY + 54, "Aa", { size: 62, weight: 700, family: SERIF });
  b += t(TX + 86, TY + 30, "Display — Serif", { size: 15, weight: 700, family: SERIF });
  b += t(TX + 86, TY + 50, "Editorial, warm, trustworthy", { size: 12, fill: T.muted });
  b += t(TX + 86, TY + 74, "UI — Sans · 13/1.5 · the quick brown fox", { size: 12.5, fill: T.inkSoft });
  // components
  const CX = 660, CY = BY + 168;
  b += t(CX, CY, "COMPONENTS", { size: 10, fill: T.faint, weight: 700, ls: 1.2 });
  b += pill(CX, CY + 16, 120, 40, { fill: T.ink });
  b += t(CX + 60, CY + 41, "Primary", { size: 13, fill: "#fff", weight: 700, anchor: "middle" });
  b += pill(CX + 132, CY + 16, 92, 40, { fill: T.white, stroke: T.lineMid, sw: 1.3 });
  b += t(CX + 178, CY + 41, "Ghost", { size: 13, weight: 700, anchor: "middle" });
  b += pill(CX + 236, CY + 22, 84, 28, { fill: T.white, stroke: T.tealTint2, sw: 1.3 });
  b += t(CX + 278, CY + 40, "Chip", { size: 12, fill: T.teal, weight: 600, anchor: "middle" });
  b += pill(CX + 332, CY + 24, 84, 24, { fill: T.goldTint });
  b += t(CX + 374, CY + 40, "SPONSORED", { size: 8, fill: T.gold, weight: 700, anchor: "middle", ls: 0.6 });
  // safety pill row
  b += pill(CX, CY + 70, 250, 34, { fill: T.warnTint, stroke: "#F0D9C8", sw: 1 });
  b += `<path d="M${CX + 18} ${CY + 80} l7 2.6 v6 c0 4.6 -3.2 7.2 -7 9 c-3.8 -1.8 -7 -4.4 -7 -9 v-6 z" fill="none" stroke="${T.warnRule}" stroke-width="1.6"/>`;
  b += t(CX + 36, CY + 91, "Red-flag → see a professional", { size: 12, fill: T.warnInk, weight: 600 });
  b += pill(CX + 264, CY + 70, 152, 34, { fill: T.safeTint });
  b += t(CX + 340, CY + 91, "Catalog-grounded only", { size: 11.5, fill: "#0B5E43", weight: 600, anchor: "middle" });
  return doc(W, H, b);
}

/* -------------------------------- render --------------------------------- */
const boards = [
  ["01-widget-en", widgetEN()],
  ["02-widget-ar", widgetAR()],
  ["03-landing-system", landing()],
];
for (const [name, svg] of boards) {
  writeFileSync(join(DIR, `${name}.svg`), svg);
  const info = await sharp(Buffer.from(svg)).png().toFile(join(DIR, `${name}.png`));
  console.log(`✓ ${name}.png  ${info.width}×${info.height}  ${(info.size / 1024).toFixed(0)}KB`);
}
console.log("done");
