import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";
import { advisorHost } from "./fixtures/advisor-host";

type Rect = { x: number; y: number; width: number; height: number };
function overlap(a: Rect, b: Rect) {
  return Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
}

let browser: Browser;
beforeAll(async () => {
  browser = await chromium.launch({ channel: process.env.ADVISOR_BROWSER_CHANNEL || undefined });
});
afterAll(async () => { await browser?.close(); });

describe("the advisor beside the store's WhatsApp button", () => {
  for (const lang of ["en", "ar"] as const) {
    for (const [width, inset] of [[384, 20], [384, 0], [320, 0]]) {
      it(`${lang}: ${width}x624 drawer, ${inset}px from the corner`, async () => {
        const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
        try {
          // No hydration or network: this test measures the real server-rendered layout.
          await page.setContent(advisorHost(lang, width, inset));
          const frame = page.frameLocator("iframe");
          const bubble = (await page.locator(".whatsapp").boundingBox())!;
          const send = (await frame.locator(".va-send").boundingBox())!;
          const mic = (await frame.locator(".va-mic").boundingBox())!;
          const input = (await frame.locator(".va-composer input").boundingBox())!;
          const thread = (await frame.locator(".va-thread").boundingBox())!;
          const drawer = (await page.locator("iframe").boundingBox())!;
          console.log(JSON.stringify({ lang, width, inset, sendOverlap: overlap(send, bubble), micOverlap: overlap(mic, bubble) }));
          expect(overlap(send, bubble), "send is covered by the host button").toBe(0);
          expect(overlap(mic, bubble), "microphone is covered by the host button").toBe(0);
          expect(mic.height, "voice is the primary action").toBeGreaterThanOrEqual(64);
          expect(mic.y + mic.height).toBeLessThan(input.y);
          expect(input.width, "typing remains usable at drawer width").toBeGreaterThanOrEqual(100);
          expect(thread.height).toBeGreaterThanOrEqual(96);
          for (const control of [send, mic, input]) {
            expect(control.y + control.height).toBeLessThanOrEqual(drawer.y + drawer.height);
            expect(control.x).toBeGreaterThanOrEqual(drawer.x);
            expect(control.x + control.width).toBeLessThanOrEqual(drawer.x + drawer.width);
          }
          expect(await frame.locator(".va-mic").innerText()).toContain(lang === "ar" ? "اضغط للتحدث" : "Tap to speak");
          if (process.env.ADVISOR_SCREENSHOTS) {
            await page.screenshot({ path: join(process.env.ADVISOR_SCREENSHOTS, `${lang}-${width}-${inset}.png`), animations: "disabled" });
          }
          // Camera, notice and call status can exhaust the extras' space.
          // The voice action and text input must stay in place when they do.
          await frame.locator(".va-dock-extras").evaluate((extras) => {
            const camera = document.createElement("div");
            camera.className = "va-camera";
            camera.innerHTML = '<video></video><div class="va-camera-actions">Camera preview</div>';
            const notice = document.createElement("div");
            notice.className = "va-alert";
            notice.textContent = "A notice with enough text to wrap across several lines. ".repeat(5);
            const call = document.createElement("div");
            call.className = "va-callbar";
            call.textContent = "Listening";
            extras.append(camera, notice, call);
          });
          expect((await frame.locator(".va-thread").boundingBox())!.height).toBeGreaterThanOrEqual(96);
          expect((await frame.locator(".va-mic").boundingBox())!.y).toBeCloseTo(mic.y, 1);
          expect((await frame.locator(".va-composer input").boundingBox())!.y).toBeCloseTo(input.y, 1);
        } finally {
          await page.close();
        }
      });
    }
  }
});
