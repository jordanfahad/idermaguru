import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { VoiceAgent } from "../../src/components/voice-agent";

const css = readFileSync(new URL("../../src/components/voice-agent.css", import.meta.url), "utf8");
const embed = readFileSync(new URL("../../src/app/advisor/advisor-embed.css", import.meta.url), "utf8");

/** Real advisor markup and styles, inside a store with its own floating chat button. */
export function advisorHost(lang: "en" | "ar", width = 384, inset = 20) {
  const dir = lang === "ar" ? "rtl" : "ltr";
  const panel = renderToStaticMarkup(createElement(VoiceAgent, { initialLang: lang, variant: "full" }));
  const frame = `<!doctype html><html lang="${lang}" dir="${dir}"><head><style>
    * { box-sizing: border-box; }
    body { margin: 0; background: #f7faf8; }
    button, input { font: inherit; }
    ${css}
    ${embed}
  </style></head><body><main class="advisor-embed" dir="${dir}">${panel}</main></body></html>`;
  const srcdoc = frame.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!doctype html><html dir="${dir}"><head><style>
    body { margin: 0; background: #eeeae3; font-family: system-ui; }
    iframe { position: fixed; width: ${width}px; height: 624px; bottom: ${inset}px;
      inset-inline-end: ${inset}px; border: 0; border-radius: 16px; }
    .whatsapp { position: fixed; width: 56px; height: 56px; bottom: 20px;
      inset-inline-end: 20px; border: 0; border-radius: 50%; z-index: 2;
      background: #25d366; color: #fff; font-size: 22px; }
  </style></head><body><p>Storefront fixture</p>
    <iframe title="Skin advisor" srcdoc="${srcdoc}"></iframe>
    <button class="whatsapp" aria-label="WhatsApp">WA</button>
  </body></html>`;
}
