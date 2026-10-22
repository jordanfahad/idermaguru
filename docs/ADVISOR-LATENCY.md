# Advisor latency and drawer regression

Measured locally on 2026-10-22 from task `advisor-20261022-wa-voice-latency`, based on `3603203`.

## Scope of the measurements

These are wall-clock measurements of the real route handlers in Vitest on Windows, using the seed catalogue and local provider doubles. They are single samples, not production percentiles. Database access is disabled, fetch is intercepted, and no paid API was called. The audio bytes and transcript in the spoken-turn probe are synthetic. This exercises server response and buffering behavior; it does not measure recognition accuracy or audible playback.

Command: `npx vitest run tests/advisor-latency.test.ts --reporter verbose --disableConsoleIntercept`

| Probe | Observed time | What it includes |
| --- | ---: | --- |
| Product opening, English | 8.8 ms | Route, seed product lookup, JSON response |
| Product opening, Arabic | 1.9 ms | Same path after the English sample |
| Typed first concern, "I have acne" | 15.5 ms | Parsing, dialogue, authored reply, JSON response |
| Recorded turn: transcription | 188.7 ms | Real transcribe route with an injected 180 ms upstream delay |
| Recorded turn: advisor response | 7.3 ms | Transcript "oily" answering the skin-type question |
| Recorded turn: speech headers | 132.2 ms | Real speech route with an injected 120 ms header delay |
| Recorded turn: complete speech blobs | 412.6 ms | Headers plus an injected 280 ms body tail; parts fetched in parallel |
| Recorded turn: audio blobs ready, total | 608.7 ms | Transcription, advisor response, full speech bodies |
| Two stalled opening enrichments | 811.2 ms | Both optional calls run together under the 800 ms budget |
| Routine, stalled stock lookup, rich replies off | 512.9 ms | The 500 ms stock budget and local recommendation work |
| Routine, stalled stock and explanation, rich replies on | 1317.2 ms | The slower 1300 ms explanation budget, with stock in parallel |
| Unrecognized skin answer | 2.0 ms | "my skin is puzzling"; misses becomes 1, answer-reader calls observed: 0 |

The first route import took 505.3 ms in this run. That includes the Vitest/Vite module-loading path and must not be presented as a deployed function cold start. The final probe ran alongside the browser tests, so these timings also include ordinary local scheduling noise.

## Where a pause can accumulate

- The opening branch in `src/app/api/voice-agent/route.ts` does not call a model for English or Arabic. It resolves the product and uses authored copy. Some client comments still describe this as an LLM round trip. A live product opening still depends on host/tenant resolution and a catalogue read; those database and network times were not measured here.
- Around line 933, intake extraction and empathy run in parallel and are disabled unless `ADVISOR_RICH_REPLIES=1`. Around line 1253, stock and optional recommendation explanation also run in parallel. Their budgets are 500 ms for stock, 800 ms for reading, and 1300 ms for explanation. Reducing them blindly is not supported by these measurements.
- The answer-reader branch around line 964 has an 800 ms budget, but the unrecognized-answer sample did not reach it: `updateSlots` changes `misses`, while `misheard` compares the entire slots object for equality. The reader's production frequency and this apparent mismatch need separate review. The probe records the observed call count instead of assuming a model was called.
- `inStockOnly` uses the stock service's default 1500 ms budget, unlike the 500 ms face-routine path. The stock fetch itself has a 1200 ms abort timer. Hair/body/follow-up paths can therefore wait longer, and some perform more than one stock pass. Those paths were inspected but not timed with a merchant catalogue.
- The speech route streams the upstream body. Both `speak` and `speakSequence` nevertheless await `response.blob()` before playback. In the controlled sample, speech headers arrived at 132.2 ms but complete blobs took 412.6 ms, a 280.4 ms extra wait. The probe's chunks are not playable MP3 frames, so this difference is buffering evidence, not a proven improvement in time to audible speech.
- Product-specific greetings are prewarmed through GET, but the speech GET endpoint accepts fixed scripted lines only. A product-naming greeting is dynamic, so that warm request cannot populate the intended recording. Actual playback uses POST. Fixing this requires coordinating the prewarm result with playback ownership and the iOS tap path.
- Recorded turns wait for more than 900 ms of silence; the no-meter fallback is 5000 ms, and a recording is capped at 15000 ms. Speech on iOS also allows up to 450 ms for the audio session to settle after capture ends. These are source constants, not measured device delays, and cannot simply be added without accounting for overlap.
- Speech and transcription upstream fetches have no explicit application timeout. `withBudget` bounds the caller's wait but does not cancel its underlying model request. Neither upstream behavior nor possible continued provider cost after a budget expires was exercised.

The runtime latency paths were left unchanged. Streaming the first line, reusing product-greeting audio, changing stock budgets, and changing iOS timing all need evidence from an actual device and configured services. The task explicitly preserves the voice engine.

## Drawer regression

`tests/fixtures/advisor-host.ts` renders the real advisor component and styles inside a 384x624 iframe, with a separate fixed 56px WhatsApp-style button 20px from the host edges. Arabic mirrors both corners. The browser suite also covers a flush drawer, a 320x624 drawer, and a dock crowded with camera, notice and call content.

Before the fix, the send-button rectangle overlapped the host button by 1368 square pixels in the inset drawer and 1680 in the flush drawer. The flush layout also overlapped the small mic by 320 square pixels. All six cases failed their overlap check. That first run used installed Edge and also hit a 30-second browser-close timeout.

After the fix, all six cases passed with Playwright's Chromium headless shell: send and mic overlap were both zero. The mic is a labeled 64px primary action above the text composer; the embedded composer reserves 76px at its inline end. The input remains at least 100px wide at 320px, and the thread retains its 96px floor when dock extras overflow. The real voice-engine code before the render section is identical to the base commit.

To run the browser regression:

```text
npx playwright install chromium --only-shell
npm run test:browser
```

CI installs Chromium and runs the suite separately from the Node unit tests. `PLAYWRIGHT_BROWSERS_PATH` can place the browser under the checkout's ignored `.localappdata` directory. `ADVISOR_SCREENSHOTS` optionally captures the host fixtures. The fixture measures server-rendered layout without hydration, microphone permission, or network calls; it does not substitute for iPhone testing.

Still unmeasured: production function cold starts, merchant database/cache latency, CDN hits, actual STT/TTS/model latency, browser speech recognition, audio decoding, mobile network transport, iOS recording/playback and user-perceived time to the first audible word.
