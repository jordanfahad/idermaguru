# Regression Log

A running list of bugs found in DermaGuru, so they are not reintroduced. Append
to the top of the current section every time a bug is found — including bugs
found and fixed inside the same change, because those are the ones most likely
to come back.

Each entry records the symptom a shopper would see, the root cause, and the test
that now guards it. An entry without a guarding test is a bug waiting to return.

---

## 2026-07-28 — Reported from a live consultation

### R-030 — "yes I do have period of energy" was recorded as three allergies
- **Symptom:** the answer was accepted, the profile completed, and the shopper went straight to a routine.
- **Cause:** `extractAllergies` stripped a few filler words and kept whatever was left, so it returned `["have","period","energy"]` as allergens. The routine was then built while filtering against them.
- **Why the model did not catch it:** the model reader added in R-028 only runs when the deterministic parser places *nothing*. Here "yes" matched, slots changed, and `misheard` was false — so it was never consulted. The gate guards against silence, not against confident misreading.
- **Fix:** a word only counts as an allergen if it reads like one, or if the shopper said "allergic to" it explicitly — an unknown ingredient named that way is still believed. A bare "yes" now carries no allergen and the agent asks which ones.
- **Also:** "peanut" contains "nut", so both matched and it read back "allergic to nut, peanut". Only the most specific match is kept.
- **Guarded by:** `tests/routine-quality.test.ts`.

### R-031 — The same shampoo was offered twice, in two sizes
- **Symptom:** a 4-step routine spent two steps on Vichy DERCOS anti-dandruff shampoo, 200ML and 390ML.
- **Cause:** they are two catalogue rows with two handles — correctly, after R-029 — but one product to a shopper. Nothing collapsed them at recommendation time.
- **Fix:** the routine keeps one product per family, where the family is the name with its size stripped. Ranked order is best-first, so the survivor is the better-scoring size.
- **Guarded by:** `tests/routine-quality.test.ts`, including that different formulations sharing a name stay separate.

### R-032 — Four products, no sense of what they do or when
- **Symptom:** every card read "Chosen for the dandruff and dry you described." — the same sentence four times, with no indication of when anything would show.
- **Cause:** the reason falls back to concerns alone when a product carries no active ingredients, which is most of a CSV-imported catalogue. Nothing ever expressed a timeframe.
- **Fix:** each step now carries what a shopper can reasonably expect and roughly when, worded as what people typically notice rather than as a promise, and never as treating anything. Sunscreen says it prevents rather than shows.
- **Note:** the reason line is still generic for products with no actives. Populating actives on the catalogue is the real fix.

---

## 2026-07-27 — The catalogue carried 964 rows for 461 products

### R-029 — Every re-import created a fresh copy of the whole catalogue
- **Symptom:** 964 product rows for 461 real products. Shoppers could be shown the same item twice in one routine.
- **Cause:** two of them. The CSV importer minted `csv-${Date.now()}-${index}` as the row identity, so re-importing the same file matched nothing and inserted everything again — one product reached four copies. Separately, the dedup that already existed matched on the whole URL, and the store is reachable on both `a1ce04.myshopify.com` and `cicabelle.com`, so a product carried on both kept a row for each.
- **Fix (data):** deduplicated on the product handle — the segment after `/products/` — which collapses both domains and every re-import. 503 rows removed, 461 kept. The surviving row per product is chosen by: customer-facing domain over the raw myshopify one, in-stock over not, real price over a 0.00 "(Free Gift)" placeholder, then freshest import. No row without an image, no zero-price row, and no "(Free Gift)" row survived.
- **Fix (code):** `productHandle()` is now the identity used by `importProductForTenant`, and the CSV importer derives its id from the handle instead of the clock, so a re-import updates in place.
- **Integrity:** `RecommendationItem.productId` is RESTRICT — deleting a referenced product would have failed. All 503 removed rows were referenced by zero recommendation items and zero events; the 12 referenced products were all keepers. 168 recommendation items intact afterwards.
- **Reversible:** all 964 original rows are in `Product_backup_20260727`.
- **Not merged, deliberately:** two Effaclar Duo+ listings shared one name but are different formulations (the second is SPF30 with niacinamide) — the name was corrected instead. Two Huda setting-powder listings at 130 and 140 remain; both are live storefront products and picking one is a commercial call.
- **Guarded by:** `tests/product-taxonomy.test.ts` — the exact URL pairs that duplicated in production.

---

## 2026-07-27 — Nonsense was absorbed rather than questioned

### R-028 — The intake had no concept of "that made no sense"
- **Symptom:** "I have horns" was absorbed as a failed skin-type answer and the question simply repeated. "I am breastfeeding goat" set a safety slot. Neither was ever questioned.
- **Cause:** structural, not a missing phrase. Every answer was matched against vocabularies; anything unmatched was counted as a miss and moved past. `YES` contains `i have`, so any sentence opening "I have…" reads as an affirmative and skips the tangent check entirely.
- **Fix:** when the deterministic parser cannot place an answer, and only then, the model reads it in the context of the question that was asked and returns a five-field verdict: does it make sense, is it on topic, does it need a clinician, is there a skin type, is there a concern. Nonsense gets "I didn't quite follow that" and a re-ask.
- **Cost:** nothing on the common path. "oily", "no", "no allergies" all parse deterministically and never reach the model. The call is capped at 120 tokens inside a 900ms budget, and the deterministic answer stands if it overruns.
- **Safety:** the model may only ADD an escalation, never remove one — deterministic triage still runs first and still wins. It is never asked about pregnancy or allergies, so it can neither assert nor clear a safety slot. Every field is parsed defensively: a truncated or malformed reply reads as "nothing to add" rather than as nonsense or as a reason to stop.
- **Guarded by:** `tests/answer-reading.test.ts` — 12 cases over malformed, truncated, prose-wrapped and hostile verdicts.

---

## 2026-07-27 — Sitting through real conversations

Found by driving the live API and reading the transcripts as a shopper would.
None of these were caught by the test suite, because the suite exercised the
engine and never held a conversation.

### R-021 — "I have a cancerous pigment" was answered with "how would you describe your skin?"
- **Symptom:** the worst failure this product can have. A shopper reporting suspected cancer was asked about their skin type and taken on to a routine.
- **Cause:** the referral vocabulary demanded the literal phrase "skin cancer". "cancerous", "carcinoma", "malignant", "tumour" and "biopsy" all matched nothing.
- **Fix:** any mention of malignancy escalates, however worded.
- **Guarded by:** `tests/voice-agent-safety.test.ts` — "red flags the vocabulary used to miss", with a counter-test that ordinary pigmentation still gets a routine.

### R-022 — Systemic symptoms were treated as small talk
- **Symptom:** "I feel nauseous" was answered "Just to be clear, I only cover skin and hair here."
- **Cause:** two faults at once. Nausea, vomiting, dizziness and chest pain were in no pattern; and the tangent classifier ran *before* safety triage, so it returned first and triage never saw the turn.
- **Fix:** safety runs first on every turn, before anything can short-circuit it, and systemic symptoms are referral-level.

### R-023 — The opening line was never checked
- **Symptom:** "I have a leg pain" → "I have a leg pain — understood. How would you describe your skin?". "do you sell iphones" became the shopper's skin concern.
- **Cause:** the tangent classifier was only consulted from the second turn; the first utterance was stored as the main concern whatever it contained.
- **Fix:** `classifyOpening` runs on the first line. A non-skin body complaint is sent to a doctor or pharmacist; a genuine tangent is turned away. Neither is stored.
- **Guarded by:** `tests/voice-agent-safety.test.ts` — "the opening line", including that real concerns and one-word answers still pass.

### R-024 — Every shopper was asked whether they were pregnant
- **Symptom:** a man is asked if he is pregnant or breastfeeding. Offensive, and it reads as a form rather than an advisor.
- **Fix:** the question is skipped outright once the shopper has said it does not apply, and is now phrased as a rule about ingredients rather than a question about their body.
- **Guarded by:** `tests/voice-agent-safety.test.ts` — "does not ask a man whether he is pregnant".
- **Still open:** it is still asked of everyone who has not said. The better fix is to ask only when a pregnancy-restricted ingredient is actually a candidate for that shopper's routine — most routines have none.

### R-025 — "I don't know" was met with "I only cover skin and hair here"
- **Cause:** an honest non-answer matched no pattern, so the tangent classifier claimed it.
- **Fix:** unsure answers are answers. They count towards moving the question on, not towards a lecture.

### R-026 — The agent forgot it had given up on the skin type
- **Symptom:** after moving on from an unanswerable skin-type question, the very next turn asked it again.
- **Cause:** `skinTypeUnknown` was missing from the route's zod slot schema, so it was stripped from every round trip.
- **Note:** introduced by the R-017 fix and caught only by reading a live transcript. Any new slot must be added to `SlotsSchema` or it does not survive a turn.

### R-027 — The agent parroted the shopper's words back
- **Symptom:** "I am having acne — understood."
- **Fix:** it acknowledges without repeating. Speech-to-text errors made the echo worse than useless.

---

## 2026-07-27 — Reported from a live consultation

Found by Fahad from a real transcript and routine panel, not by the test suite.

### R-016 — A red flag said mid-intake was never safety-screened
- **Symptom:** shopper answered the skin-type question with "I have blue patches with some acne and". The advisor repeated the question and went on to sell a routine. Blue patches are in the bruising/discolouration escalation list.
- **Cause:** `runSafetyTriage` ran once, after the intake was complete, on the assembled profile. An answer that fits no slot is discarded by `updateSlots`, so those words never reached triage. The escalation patterns worked perfectly — they were never shown the text.
- **Fix:** every turn is triaged against the concern so far plus what was just said, before the next question is asked. Anything alarming stops the intake immediately.
- **Guarded by:** `tests/voice-agent-safety.test.ts` — "the blue patches transcript", including a test that reproduces why the old end-of-intake check missed it.

### R-017 — The advisor invented a skin type and announced it
- **Symptom:** after two answers it could not parse, the agent said "Got it — combination skin" to a shopper who never said it.
- **Cause:** `updateSlots` assigned `skinType = "combination"` after `MAX_MISSES`, to avoid looping. The route then reported it back as something understood.
- **Fix:** it gives up on the question instead of answering it for them, and stops asking. An unknown skin type scores neutrally in the engine, so the routine is still sound — just less tailored. A skin type volunteered later is still accepted.
- **Guarded by:** `tests/voice-agent-safety.test.ts` — "never invents a skin type the shopper did not give".

### R-018 — The same product recommended twice in one routine
- **Symptom:** "CeraVe Hydrating Mineral Sunscreen SPF 30 Face Sheer Tint 50ml" appeared twice in one routine.
- **Cause:** the catalogue holds the same product under several ids and SKUs (see R-019); the routine builder deduplicated on `product.id` only.
- **Fix:** identity within a routine is the product name, not the row id.
- **Guarded by:** `tests/product-taxonomy.test.ts` — "shows a duplicated catalogue product only once".

### R-019 — Every CSV import duplicated the whole catalogue
- **Symptom:** 964 product rows for 509 real products; 466 distinct names.
- **Cause:** the import called `createProductForTenant` per row unconditionally — an insert, never an upsert. The SKU could not act as the key either: the exports carried `csv-<timestamp>-<row>` SKUs, so the same product arrived with a different SKU in every export.
- **Fix:** the import upserts on the product URL, which is stable and populated on every row.

### R-020 — A product that left the store stayed sellable forever
- **Symptom:** out-of-stock products recommended to shoppers.
- **Cause:** nothing ever cleared `inStock`. The read path filters it correctly, but no import pass marked vanished products as gone, so a product imported once stayed in stock permanently.
- **Fix:** an import can be run in `replace` mode, which marks everything absent from the file out of stock. Rows are kept, not deleted — recommendations already made still point at them. Default stays `merge`, because a partial upload under replace semantics would empty the shelf.
- **Still open:** the ~455 duplicate rows already in the live catalogue, and the stale `inStock` flags on them, need a one-off cleanup.

---

## 2026-07-27 — Recommendation engine against a real merchant catalogue

Found while moving the engine from the 12-product seed catalogue to a live
merchant catalogue of 876 in-stock products.

### R-001 — Perfume and shampoo recommended as skincare
- **Symptom:** a face routine for dark spots could contain eau de parfum, bar soap, a lip balm or a shampoo.
- **Cause:** the routine slot was inferred from a few substring tests on `category`, everything unmatched fell into a catch-all "evening treatment" bucket, and a padding pass topped the list up to six with whatever scored highest.
- **Fix:** `productKind()` decides kind first as a hard gate; the padding pass is gone.
- **Guarded by:** `tests/product-taxonomy.test.ts` — "never puts perfume or shampoo in a face routine".

### R-002 — 61 face products were never recommendable
- **Symptom:** whole categories ("toners", "eye creams", "lotions & moisturizers") were silently absent from every routine.
- **Cause:** classifier patterns matched only singular nouns; merchant categories are almost always plural.
- **Fix:** every noun in the taxonomy patterns tolerates the plural.
- **Guarded by:** `tests/product-taxonomy.test.ts` — "reads plural merchant categories".

### R-003 — Devices and accessories treated as routine steps
- **Symptom:** an IPL hair-removal handset could be returned as a hair step; cotton pads and an LED face mask as skincare.
- **Cause:** "IPL hair removal device" contains "hair"; "LED Face Mask" contains "face" and "mask".
- **Fix:** a device/accessory pattern is tested before every other kind.
- **Guarded by:** `tests/product-taxonomy.test.ts` — "is not fooled by devices and accessories".

### R-004 — One product filled two steps of the same routine
- **Symptom:** "La Roche-Posay Effaclar Duo+" appeared as both the moisturiser and the sunscreen.
- **Cause:** `routineStep()` read the marketing description before the merchant's label, so any moisturiser whose copy said "always wear SPF" was classed as a sunscreen.
- **Fix:** the label (category + name) decides; the description is only consulted when the label says nothing.
- **Guarded by:** `tests/product-taxonomy.test.ts` — "does not turn a moisturiser into a sunscreen because its blurb mentions SPF".

### R-005 — Untagged products were ranked as mismatches
- **Symptom:** ordering was close to arbitrary on the live catalogue.
- **Cause:** 63% of products carry no active ingredient and 64% no skin type; an untagged skin type scored 0.25, the same as a genuine mismatch.
- **Fix:** concerns and skin types fall back to what the category implies, and unknown scores a neutral 0.5.
- **Guarded by:** `tests/product-taxonomy.test.ts` (kind/step coverage) and the persona sweep in the delivery notes.

### R-006 — Anti-sponsorship swap broke the routine shape
- **Symptom:** a routine could end up with two cleansers and no sunscreen.
- **Cause:** when every pick was sponsored, the last one was replaced by the next organic candidate *regardless of step*.
- **Fix:** the replacement is drawn from the same step.
- **Guarded by:** `tests/product-taxonomy.test.ts` — "recommends each step at most once".

### R-007 — The last routine step was silently dropped
- **Symptom:** a full routine lost its weekly exfoliant with no explanation.
- **Cause:** `chosen.slice(0, 6)` truncated the tail of a 7-step routine.
- **Fix:** trimming removes steps marked optional first, never an essential step.

### R-008 — Routine panel grouped on display strings
- **Symptom:** relabelling a slot collapsed the Morning/Daily/Evening grouping into one bucket.
- **Cause:** `bucketFor()` matched on the human-readable slot text ("morning cleanser").
- **Fix:** the API sends a machine-readable `step`; the panel groups on that.
- **Verified:** Morning/Daily/Evening confirmed present at all five viewports.

### R-009 — No ingredient-conflict rule existed
- **Symptom:** a routine could pair a retinoid with an AHA/BHA exfoliant and say nothing.
- **Cause:** cautions were computed per product, so a conflict between two products was invisible.
- **Fix:** `flagIngredientConflicts()` runs over the chosen routine and warns on both halves, naming the other product.
- **Guarded by:** `tests/recommendation-engine.test.ts` — "warns on both halves when a retinoid and an acid share a routine".

### R-010 — The conflict warning was invisible in the UI
- **Symptom:** the new warning never reached the shopper.
- **Cause:** the routine card renders `cautions[0]` only, and the warning was appended last.
- **Fix:** routine-level cautions are prepended, ahead of "Patch test before first use."

### R-011 — "Here is a balanced OTC routine for ."
- **Symptom:** a shopper who skipped the concern question, or chose "none of the above", got a sentence with a hole in it.
- **Cause:** the summary interpolated `mainConcern` unconditionally.
- **Fix:** the summary only names a concern when there is one.
- **Guarded by:** `tests/recommendation-engine.test.ts` — "does not name a concern the shopper never gave".

### R-012 — Medical framing in shopper-facing labels (compliance)
- **Symptom:** routine steps were labelled "treatment" and "scalp treatment".
- **Cause:** the routine vocabulary was written without the cosmetic-advisor positioning in mind.
- **Fix:** "serum" and "scalp care". DermaGuru is a cosmetic advisor under UAE Federal Decree-Law No. 38 of 2024 and must not use treatment language.

### R-013 — Product images had no alt text
- **Symptom:** screen readers announced nothing for every product image.
- **Cause:** `alt=""` was hardcoded on the routine card image.
- **Fix:** `alt` is the brand and product name.

### R-014 — Alt text painted inside the fallback tile
- **Symptom:** dead merchant image URLs rendered the product name as raw text inside the grey placeholder tile.
- **Cause:** introduced by R-013 — the error handler removes `src`, and a `src`-less `<img>` paints its alt text.
- **Fix:** the error handler clears `alt` as well; the product name is already beside the image.

### R-015 — Touch targets below 44px
- **Symptom:** the save and open-product buttons on a routine card were 28x28 — easy to mis-tap on a phone.
- **Cause:** the visual pill size was used as the hit area.
- **Fix:** the pill stays 28px; a pseudo-element gives it a 44px hit area. Mode, skin and restart buttons raised to a 44px minimum.
- **Verified:** a click 17px outside the visual circle toggles the button.

### R-016 — "I have a bullet wound" → "Just to be clear, I only cover skin and hair here."
- **Symptom:** a shopper describing a serious injury was answered with a canned redirect to skincare.
- **Cause:** the clinical triage has no pattern for being shot, stabbed or breaking a bone, so the utterance fell through to the tangent classifier — which did exactly what it was built to do.
- **Fix:** `services/empathy.ts` classifies distress (emergency / urgent care / crisis) ahead of everything else on every turn, and answers with concern first and a place to go second.
- **Guarded by:** `tests/empathy.test.ts` — "someone in trouble", plus "not an emergency" for the skin complaints that share a word with one.

### R-017 — "I have a rashes" → "How would you describe your skin — oily, dry, combination, or sensitive?"
- **Symptom:** a symptom that could be anywhere on the body was answered with a question about a face, then a face routine.
- **Cause:** the dialogue had no concept of where the concern was; the face routine was the only thing it could build.
- **Fix:** a `bodyArea` slot, asked before the skin-type question when the concern is location-dependent and the shopper has not already said where. Face and neck take the existing routine, scalp takes the hair path, hands/underarms/elbows/knees/feet/body build from body products, and intimate skin is answered by a person rather than a product.
- **Guarded by:** `tests/body-area.test.ts`.

### R-018 — "dark knuckles" was off-topic
- **Symptom:** dark knuckles, dark elbows and darkening underarms — three of the most-asked questions in the market this ships to — were all answered with "I only cover skin and hair here".
- **Cause:** none of those phrases contains a word from the skin vocabulary, which listed conditions and body parts but no words for how skin *looks*.
- **Fix:** a separate appearance vocabulary (dark, uneven, ashy, blotchy, rough…). Body parts still do not count on their own, so "my elbow hurts" is still not a skincare concern.

### R-019 — "dry patches" recorded as a dry skin type
- **Symptom:** the agent read back "dry skin" to a shopper who had said no such thing, and — believing it was talking about a face — skipped the question about where the patches were.
- **Cause:** the inline slot harvester ran the skin-type reader over the whole sentence, and "dry patches" contains "dry".
- **Fix:** an inline skin type is only taken when the word is attached to the skin ("dry skin", "my skin is dry") or the whole utterance is the answer.

### R-020 — A sold-out product recommended through to checkout
- **Symptom:** a shopper reached Shopify checkout and had the cleanser removed from their cart: "La Roche-Posay Toleriane Face Wash Cleanser, 400ml — SOLD OUT".
- **Cause:** `Product.inStock` is written at sync time and nothing re-reads it; the merchant sold out in between.
- **Fix:** `services/stock.ts` checks the storefront's own public `/products/<handle>.js` for the handful of products about to be shown. Sold-out items are excluded and the routine is **rebuilt**, so the next-best cleanser replaces the missing one instead of the routine losing a step. Fails open — a network fault is not evidence a product is unavailable.
- **Guarded by:** `tests/stock.test.ts`.

### R-021 — "yes salicylic acid" → straight to the routine
- **Symptom:** the shopper named an allergy and the very next sentence was "Here's a simple routine with 4 products", with no acknowledgement. The allergen *was* recorded and *was* filtered out — the shopper simply had no way of knowing.
- **Cause:** the result preface only ran when the shopper had volunteered everything up front (`skippedAhead`); answering the questions one at a time produced no preface at all.
- **Fix:** an allergy named this turn is always read back — "Noted — I'll keep salicylic acid out of everything I suggest." The allergen vocabulary also carries the full names ("salicylic acid") alongside the stems, so the readback is the whole ingredient rather than a truncation; the existing most-specific-match filter keeps only one of the pair.
- **Guarded by:** `tests/routine-followup.test.ts`.

### R-022 — "I need it more intense routine" → the identical routine, the identical sentence
- **Symptom:** every turn after the routine bounced off it. The request was folded into the concern text, the same four products were rebuilt, and the same line was read out again.
- **Cause:** the dialogue had no post-result state. `routinePreference` was hardcoded to "simple" and nothing ever read a follow-up.
- **Fix:** `readAdjustment` reads fuller / simpler / gentler, carried in the slots as `routineShape` and `gentle`. Gentler is matched *before* stronger, because "too strong" is a request for less and contains the word the stronger patterns look for. Gentler sets sensitivity to "very high", which is what the hard filter reads — so the strong acids are actually removed rather than merely re-ranked. The reply names what changed. Asking for stronger having just said it stings says so instead of silently putting the actives back.
- **Also:** the routine on screen is carried in the slots, so when a rebuild produces the identical list the advisor says so — "I'd still put you on the same 4 steps" — rather than replaying the result line. And "make it stronger" no longer trips the off-topic classifier, which it did because it mentions nothing in the skincare vocabulary.

### R-023 — "more intense" added a step, not products
- **Symptom:** asking for a more intense routine switched from the four-step plan to the balanced one — five or six items. A shopper asking for something serious means more products.
- **Cause:** there were only two plans, and the longer one capped at six.
- **Fix:** a third plan. Up to nine: the optional steps promoted to real ones, a **second serum** so a morning active and an evening active can both be in the routine, and a **weekly mask** — the mask step existed in the taxonomy and appeared in no plan, so masks had never been recommended to anyone. The plan now carries the shopper-facing label, so the second serum is called "second serum" rather than a duplicate "serum".
- **Guarded by:** `tests/routine-followup.test.ts` — "an intense routine is a longer one".

### R-024 — Two serums, both labelled "use in the morning"
- **Symptom:** caught while verifying R-023. A two-serum routine told the shopper to use both serums in the morning — the exact thing the guidance existed to prevent.
- **Cause:** each card decided its own timing, so every serum that was not obviously nocturnal claimed the morning.
- **Fix:** the split is decided once for the routine. A vitamin C or niacinamide serum takes the morning, a retinoid never does, and the other serum is named on both cards as the one for the other end of the day.

### R-025 — A reply could spend seven seconds before saying anything
- **Symptom:** the advisor felt slow, worst on the turn that produces a routine.
- **Cause:** every optional model call had a generous budget and they ran one after another. On a result turn: the catalogue read, then up to three sequential storefront stock checks (3 × 1500ms), then the model's phrasing (2500ms). On the opening turn, intake reading (1200ms) then the empathy line (1200ms).
- **Fix:** the stock check and the model's phrasing now run **concurrently** — the turn costs the slower of the two rather than the sum — and the stock check does one verification and at most one rebuild rather than looping. The opening turn's two model calls also run concurrently. Budgets cut to 700ms (stock), 1300ms (phrasing) and 800ms (everything else). Worst case per turn: ~7.3s → ~1.3s on a result, ~2.4s → ~0.8s on the opening.
- **Also:** the catalogue is held in memory for 45s, so a conversation does not re-read 461 rows from another region on every turn. Every write path invalidates it.
- **Correctness note:** the model's phrasing names products, so it is only used when the stock check did not swap any of them out.

### R-026 — On a phone the routine arrived off-screen
- **Symptom:** the shopper answers four questions, the routine is built, and the screen looks unchanged — they have to scroll down to find it.
- **Cause:** stacked, `.va-side-routine` was ordered last, below the orb *and* the transcript.
- **Fix:** the routine now sits directly under the orb, ahead of the transcript, and scrolls itself into view when it changes. Keyed on which products are showing rather than how many, so an adjusted routine of the same length is also brought into view. Desktop is untouched — the routine is already beside the orb there — and `prefers-reduced-motion` gets an instant jump instead of a smooth scroll.

### R-027 — The one-line install shipped the wrong advisor
- **Symptom:** found while writing the integration guide. `dermaguru-widget.js` mounts `SkinAdvisorWidget` against `/api/chat/*`; its iframe fallback points at `/embed`, which is the same older build. None of the recent work is on that path, so the documented install would have put the old advisor on a merchant's storefront.
- **Fix:** a new `/advisor` route — the voice advisor with no site chrome, for embedding — and `data-mode="voice"` on the widget script, which mounts a launcher whose frame carries `allow="microphone"` and is built on first open rather than on page load. Without that attribute the advisor loads, looks right, and cannot hear anybody, with no error shown.
- **Documented in:** `docs/EMBED.md`.

### R-028 — "on my hands" was answered with "That one's outside my world"
- **Symptom:** the advisor asked "whereabouts is it?", the shopper answered, and the answer was rejected as off-topic. The question was then asked again, the next two answers were consumed retrying it, and the advisor gave up and asked a pair of hands whether they were oily.
- **Cause:** "on my hands" contains no word in the skin vocabulary, so the tangent classifier claimed it. The route guards that classifier while the allergen list is open — the same guard was never added for the body-area question introduced in R-017.
- **Fix:** `awaitingArea` guards the classifier the same way `awaitingAllergens` does. Whatever is said while a question is open is an answer to that question.
- **Why 258 tests missed it:** every dialogue test called `updateSlots` and `nextQuestion` directly. The route runs distress, triage, opening and tangent classifiers *in front* of those, and none of that was under test.
- **Guarded by:** `tests/voice-agent-route.test.ts` — nine cases that drive whole conversations through the endpoint the browser calls. Verified to fail without the fix.

### R-029 — An advisor subdomain would have served the marketing site and the admin login
- **Symptom:** found while planning `advisor.cicabelle.com`, before any DNS was created. Two faults, either of which alone would have made the subdomain unusable.
- **Cause 1:** the advisor lives at `/advisor`, so `advisor.cicabelle.com/` would have served DermaGuru's marketing homepage — on the merchant's brand.
- **Cause 2:** the middleware matcher named only `/admin` and the widget APIs, so it never ran on a page route at all. Host-based routing was not possible and the whole site — pricing, login, dashboard, `/admin/login` — was reachable on the merchant's subdomain.
- **Fix:** the matcher covers every non-static path, and an advisor host serves the advisor at `/` (rewritten, so the address bar stays clean), the APIs it calls, and the two legal pages its disclaimer links to. Everything else redirects to `/`. `ADVISOR_HOSTS` names the hosts explicitly; the default is any `advisor.*`.
- **Guarded by:** `tests/advisor-host.test.ts`, including that nothing changes on `idermaguru.com`.

### R-030 — Every turn crossed two oceans, and every spoken line was synthesised from scratch
- **Symptom:** shoppers complaining the advisor is slow. Production logs on a real session showed 3–7 seconds between `POST /api/voice-agent` and the speech call that follows it, then a fresh synthesis on top before any sound.
- **Cause 1 — geography.** Supabase is in `ap-south-1` (Mumbai). No region was configured for Vercel, so functions ran in the default `iad1` (Washington DC). A shopper in Dubai reached Washington (~11,000 km), which reached Mumbai (~12,000 km), and back. Every request paid it; every catalogue read paid it twice.
- **Cause 2 — nothing was cacheable.** Every `/api/voice-agent/speech` call in the logs was a `POST`, which is the client saying "this line is not one of ours". Only the seven scripted questions qualified, so every acknowledgement, every reaction and every result line was sent to the speech API fresh, on every turn, for every shopper.
- **Cause 3 — model calls in the blocking path.** The opening turn waited on an intake reading, and the result turn on a model phrasing. Both produce text no cache has ever seen, so each cost a model round trip *and* a fresh synthesis.
- **Fix:** `vercel.json` pins `bom1` — same region as the database, and roughly 2,000 km from Dubai instead of 11,000. `fixedLines()` now enumerates all 83 deterministic lines per language, so they are fetched by URL and kept by the browser for an hour; 21 of them are prewarmed while the shopper is still reading the greeting. The three optional model enrichments are off unless `ADVISOR_RICH_REPLIES=1`. `readAnswer` is deliberately not gated — it only runs when the parser could not place an answer at all, and it is what catches "I have horns".
- **Guarded by:** `tests/spoken-lines.test.ts` — a fixed line that is not cacheable fails the build.

### R-031 — Four steps of dandruff routine, two of them the same shampoo
- **Symptom:** a shopper asked about dandruff and got the same Vichy DERCOS anti-dandruff shampoo twice — 200ML and 390ML — as two separate steps of a four-step routine, with the rest also shampoo.
- **Cause 1:** `pickHairProducts` is a separate function from the face builder and never got the `productFamily` guard that stops two sizes of one product reading as two products.
- **Cause 2, the bigger one:** it had no concept of a step at all. It took the four best-scoring hair products, and for "dandruff" every high scorer is a shampoo.
- **Cause 3:** the hair taxonomy had three steps and folded hair masks in with conditioners, so there was nothing to build a varied routine out of even if it had tried.
- **Fix:** hair products classify into shampoo / conditioner / mask / oil / scalp, and the hair answer follows a plan — shampoo, conditioner, scalp care, hair oil, weekly mask — picking the best of each and never the same product twice.
- **Also:** the hair reply used the face copy, so a shopper with dandruff was told to use sunscreen every morning. There is a hair line now, and it is cacheable like the rest.
- **Guarded by:** `tests/hair-routine.test.ts`.

### R-032 — Cold starts loaded a large SDK to not use it
- **Symptom:** part of why the advisor still felt slow at low traffic, when most requests land on a cold instance.
- **Cause:** `@anthropic-ai/sdk` was a static import of the LLM provider module, so every cold start of the voice route paid to load it — on a path that, with the optional model enrichments off, usually never calls Anthropic at all.
- **Fix:** type-only import, with the SDK loaded on first real use. Error classification reads the status structurally rather than through `instanceof Anthropic.APIError`, which would have dragged the package back in purely to classify a failure.
- **Also:** the middleware matcher no longer matches `/api/voice-agent/speech`. Those responses are `public, immutable` so they can serve from a point of presence near the shopper, and waking middleware on them risks the one cache that matters most for how fast the advisor feels.

### R-033 — "Super dry dandruff" → "Got it — dry skin."
- **Symptom:** a shopper describing dandruff was told the advisor had understood they had dry *skin*, in a conversation that was never about skin.
- **Cause:** the inline skin-type harvest allowed any utterance of three words or fewer through, and "super dry dandruff" is three words containing "dry". The rule was introduced in R-019 to fix the opposite problem and was too loose.
- **Fix:** an inline skin type is taken only when the word is attached to the skin ("dry skin", "my skin is dry") or the utterance is a skin type and nothing else. The skin-type question is also skipped entirely for a hair concern — a scalp is not oily or combination — and dandruff now sets the body area to the scalp, so it is never asked "whereabouts is it?" either.

### R-034 — "I am breast-feeding man" resolved silently
- **Symptom:** an answer containing both a pregnancy word and a male self-description was read as breastfeeding, and the advisor replied "I'll skip the ingredients that aren't advised" to somebody who had just said they were a man.
- **Cause:** `readsPregnant` tested for pregnancy before it tested for the negative, so whichever came first in the function won.
- **Fix:** an answer that says both is treated as no answer and asked again. If it is still unclear the existing fallback assumes it applies, which excludes the restricted ingredients rather than waving them through — so the safe direction is unchanged.

### R-035 — A named allergy was acknowledged only on the face path (safety)
- **Symptom:** "I do have peanut allergy" was followed straight by a hair routine with no sign it had been heard.
- **Cause:** the read-back added in R-021 was built inside the face branch, and the hair and body branches return before it.
- **Fix:** the acknowledgement is computed once, before the routing splits, and used by all three.
- **And the promise behind it:** the filter could not keep it. Synced products carry no ingredient list — the Shopify importer has nothing structured to read, so `ingredientsJson` is empty and only derived actives are populated. "Peanut" is not an active, so nothing was excluded. Allergy terms are now matched against the merchant's own product copy as well, with a guard so that a "fragrance-free" product is not excluded for a fragrance allergy — the trap being that the safest products name allergens the most.
- **Guarded by:** `tests/heard-correctly.test.ts`.

### R-036 — Scrolling on a phone fought back
- **Symptom:** "very difficult to scroll up and down".
- **Cause 1 — three nested scrollers.** The transcript and the routine each had their own `max-height` and `overflow-y: auto`, inside a scrolling page. On a 390px screen that is three scroll containers, and after R-026 put the routine at the top it filled most of the viewport — so almost any swipe landed on an inner box and moved that instead of the page. It also clipped the last product card behind the cart button.
- **Cause 2 — a repaint every frame, forever.** The orb's `requestAnimationFrame` loop ran for the life of the page and wrote `--level`, which feeds the colour stops of several radial gradients. A gradient whose stops change cannot be composited, so every frame forced a repaint of the orb — while idle, while reading, and while the shopper was trying to scroll. On a phone that is what makes a page feel heavy under the thumb.
- **Fix:** below 1080px the panels are not scrollers; the page is. Inner scrolling stays on desktop, where the columns sit side by side in a fixed viewport and must not lengthen the page. The animation loop runs only while listening or speaking, skips a write when the value has not visibly changed, and does not run at all under `prefers-reduced-motion`.
- **Verified:** driven in a real browser at 390x800 after a full consultation — nested scrollers 0 (was 2), routine no longer clipped, `--level` idle at 0.

### R-037 — "My friend just jumped out of the balcony" → "That one's outside my world, I'm afraid"
- **Symptom:** three transcripts, each answered with the canned off-topic line: a bereavement, an accident, and a person falling from a balcony.
- **Cause:** every distress pattern was written in the FIRST PERSON — "I have a bullet wound", "kill myself". A shopper reporting somebody *else's* emergency matched none of them and fell through to the tangent classifier. The crisis tier covered the shopper wanting to hurt themselves, not a friend who had already fallen.
- **Fix:** a `bystander` tier, matched before the first-person ones, covering falls from height, someone jumping, a collapse, and a named relation who is hurt, unconscious, bleeding, stabbed or shot. Its reply opens with shock and sends them to emergency services with the UAE number — a sentence that opens by explaining our scope reads as indifference to a frightened person.

### R-038 — Grief was treated as a tangent
- **Symptom:** "My dog died" → "That one's outside my world, I'm afraid — skin and hair are what I know."
- **Cause:** nothing in the product had a concept of bad news that is not an emergency and not about skin.
- **Fix:** `readsSorrow` reads grief and misfortune. Unlike distress it does *not* end the session — a condolence is said and the open question still follows, so a shopper who wants to carry on can.
- **The trap avoided:** speech-to-text renders "I dyed my hair" as "I died my hair" constantly, so a bare "died" can never qualify — the thing that died has to be a person or a pet.
- **The other trap:** "I have scars after the accident" is bad news *and* a question this advisor can answer. Diverting it would be its own kind of not listening, so when the utterance also mentions skin or hair it gets a short condolence in front of the ordinary flow instead of a redirect.
- **Guarded by:** `tests/empathy.test.ts`.

### R-039 — Three things that only worked for one merchant in one country
- **Context:** this ships as a SaaS. Found while removing the UAE emergency number.
- **`999` in the emergency copy.** Right in the UAE, wrong nearly everywhere. A shopper in Berlin told to call 999 is worse off than one told nothing. The copy now names no digits by default and says "emergency services"; `ADVISOR_EMERGENCY_NUMBER` takes the whole phrase ("999 in the UAE", "112", "911") and appends it as its own sentence when a deployment serves one country.
- **`currency: "AED"` hardcoded in the Shopify importer.** Every merchant's catalogue was relabelled into a currency they may not trade in. The sync now reads the shop's own currency from Shopify and passes it through; the call failing leaves the previous behaviour rather than silently relabelling a catalogue.
- **`/api/cart/cicabelle` hardcoded `cicabelle.com`.** A second merchant's shoppers would have been sent to Cicabelle's cart. The store is now resolved from the tenant's own catalogue.
- **Security note on that last one:** the obvious fix — deriving the origin from `items[].url` — would be an open redirect, since anyone could hand the endpoint a link to any domain and have us send a shopper there under our own name. The redirect target is built only from product URLs already stored for that tenant; the query string names *which* products, never *where*.

### R-040 — Scrolling still stuck: what a phone pays per scrolled frame
- **Symptom:** reported again after R-036. Removing the nested scrollers and the per-frame JavaScript was only half of it — the CSS never stopped.
- **Cause 1, and the big one: `backdrop-filter: blur(10px)` on a `position: sticky` bar.** The browser has to re-blur everything behind that bar every time the page moves under it. This is charged *per scrolled frame*, which is exactly the shape of the complaint.
- **Cause 2:** two `filter: blur(90px)` glows on 460px and 380px boxes, sitting directly under that bar — so they are what it re-reads.
- **Cause 3:** `.cc-dot` animated `box-shadow`, which is a paint property and is never composited, so it repainted forever whether or not anything was moving.
- **Cause 4:** `.va-halo` (blurred, breathing) and `.va-field` (masked, rotating) animate for the life of the page. A blurred or masked layer that changes has to be re-rasterised.
- **Fix:** below 1080px the sticky bar is opaque, the glows are painted gradients rather than filtered boxes, the pulsing dot is still, and the orb's ambient motion is paused while idle — which is precisely when a shopper is reading their routine and dragging a thumb.
- **Measured** in a real browser at 390x800, scrolling a finished consultation: worst frame 116.7ms → 33.3ms, average 27.7ms → 17.0ms, and the browser rendered 92 frames over the same scroll where it had managed 59.

### R-041 — A four-year-old was sold an adult routine (safety)
- **Symptom:**
  ```
  You      My neighbor's daughter has dandruff
  Advisor  Got it. One safety check — a few ingredients aren't advised in
           pregnancy or breastfeeding. Does either apply to you?
  You      She's four years old
  Advisor  That one's outside my world, I'm afraid — skin and hair are what I know.
  ```
- **Cause 1, the safety one:** `runSafetyTriage` has always had an under-18 rule, and the voice dialogue never populated `ageRange` — so it could not fire, ever. A stated age of four was invisible to it.
- **Cause 2:** "She's four years old" mentions nothing in the skin vocabulary, so the tangent classifier took the single most important fact in that conversation and discarded it as small talk.
- **Cause 3:** every question is written in the second person. "Does either apply to **you**?" is the wrong question when the person using the product is somebody else's child.
- **Fix:** `services/audience.ts` reads an age and whether the advice is for a third party. A child's age ends the session with an age-appropriate referral and holds for the rest of it — without that, later turns fell through to the generic clinical escalation and a shopper answering "no" got a wall of text about breathing difficulties. The pregnancy question is reworded when buying for someone else. The age is also passed to the triage, so its own rule finally works.
- **Care taken:** an age is only read where the sentence is plainly about one. "a simple glow routine under AED 200", "I use it 3 times a week" and "my routine is 4 steps" all read no age.
- **Guarded by:** `tests/audience.test.ts`.

### R-042 — The camera preview was a black rectangle
- **Symptom:** "Show your skin" opened the camera — the phone's camera light came on and the browser showed its recording indicator — but the preview rendered solid black.
- **Cause:** the stream was attached inside a `requestAnimationFrame` fired immediately after `setCamera("live")`. The `<video>` only renders in that state, and React commits when it commits: on a phone that frame regularly arrived before the element existed, so `videoRef.current` was null, the stream was never attached, and nothing ever played. The camera was genuinely open the whole time, which is why the indicator was on.
- **Fix:** the stream is attached in an effect keyed on the camera state, which runs after the commit — the only point at which the element is guaranteed to exist. `play()` is also deferred to `loadedmetadata`, since iOS rejects it before then and rejects silently, which looks identical to the same bug.
- **Verified** by driving the flow in a real browser: stream attached, `readyState` 4, not paused, 1280x720.

### R-043 — Advice age threshold lowered to 10
- **Change requested by the owner.** Previously anyone under 18 was refused, which turned away a teenager with acne — one of the most common shoppers there is.
- **Also fixed on the way:** `isUnder18` matched "13".."17" as bare substrings of whatever string it was handed, so an age band like "18-24" refused. It now parses the number and compares it to the threshold, and still refuses on words like "toddler" and "infant" whatever number sits beside them.
- **Configurable** via `ADVISOR_MIN_AGE`, because the right line is a legal and commercial judgement that differs by market rather than a fact about skin.

### R-044 — After a photo, the microphone never reopened and the session reset
- **Symptom:** shared a photo, the advisor asked about allergies, speaking recorded nothing, the mic went off — and tapping it again started the interview over from the greeting.
- **Cause 1 — `listen()` never re-armed the loop.** `stop()` clears `continueRef`, and `startListening` never set it back. Tapping the mic after stopping opened one recognition session with no restart behind it: the browser ends one at the first pause, `onend` saw the flag was false, and the microphone went quiet mid-answer. Asking to listen is asking to keep listening, so it is set there now.
- **Cause 2 — the photo hand-back inherited that dead flag.** A shopper taps the orb to stop talking before reaching for the camera, which clears `continueRef`; the review then spoke its next question into a microphone it had never reopened. Taking a photo in voice mode now means the conversation continues.
- **Cause 3, and the reset — an empty photo result wiped the whole consultation.** With no observations, `mainConcern` was set to `""`. An empty utterance with empty slots is *precisely* how the API is told a session is starting, so it replied with the greeting and returned `slots: {}` — every answer already given, gone. The concern is now left alone when a photo adds nothing, and a photo that adds nothing to an empty session says so instead of posting.
- **Verified** in a real browser with the vision endpoint stubbed to return nothing: the transcript grew from 2 turns to 4 and the original concern survived, where it previously reset to the greeting.

### R-045 — The photo review couldn't say "that's a keyboard"
- **Symptom:** a shared face photo came back "I couldn't read that clearly. Try better light and hold steady." And by design, ANY non-skin photo — a keyboard, a pet, a screenshot — got the same line, which is untrue and is exactly how shoppers testing the assistant decide the whole thing is fake.
- **Cause 1:** the image was sent with `detail: "low"`, which downsamples to ~512px — genuinely too coarse to read redness, texture or blemishes. The model then honestly reported it could not see.
- **Cause 2:** the prompt's only failure mode was `usable: false`. It had no way to say what the photo actually showed, no way to say "this is skin but I can't place it", and no way to name the body part it saw.
- **Fix:** `detail: "auto"`, and the model now classifies the subject first. A non-skin photo is named for what it is ("That looks like a computer keyboard to me — and I'm only qualified to look at skin!"); skin it can't place asks "whereabouts is this?"; a placed body part feeds the `bodyArea` slot, so a photo of a hand routes to body products rather than a face routine. "Too dark or blurry" is reserved for photos that are actually too dark or blurry.
- **Verified** by driving all three outcomes through the real client in a browser.

### R-046 — Arabic existed everywhere except the door in
- **Question asked:** does it support Arabic for voice and chat?
- **What was already true:** authored Arabic copy for every line the advisor says, Arabic parsing for skin types, pregnancy, allergies and hair concerns, per-utterance script detection (typed Arabic always got an Arabic answer), Gulf-Arabic TTS delivery, RTL layout, and 83 pre-cached Arabic audio lines.
- **The gap:** voice. Speech recognition transcribes in the language it was told to listen in, and it started in `en-US` — an English recogniser mangles spoken Arabic into Latin junk, so the script detection downstream never saw Arabic at all. `/live-consultation-1` has a page-level toggle; the embeddable `/advisor` — the surface merchants frame — had no way to switch.
- **Fix:** an EN/عربي toggle on the widget itself. It flips the UI and RTL, retargets the recogniser (restarting a live session in the new locale), and the existing prewarm effect re-runs for the Arabic lines. Verified in a browser: toggle → RTL + Arabic UI; typed Arabic → Arabic reply through the real API; a fresh load still starts English.

### R-047 — Saying "no" into a listening orb went nowhere, forever
- **Symptom:** the pregnancy question was asked, the orb showed listening, the shopper said "no" repeatedly, and nothing ever happened. No "You" turn appeared at all.
- **Cause 1 — iOS never finalises short answers.** A turn was only sent when the recogniser flagged a result `isFinal`, and iOS Safari routinely ends recognition — above all on one-word answers like "no" — without ever flagging one. The word arrived as an interim, `onend` threw it away and silently restarted the mic. Hearing the interim also set `heard = true`, which reset the give-up counter, so the loop could not even time out.
- **Cause 2 — a failed audio load started listening twice.** A media failure fires both the element's `onerror` and the rejection of `play()`; each ran the browser-voice fallback, so `listen()` started twice and the second session aborted the first mid-answer, discarding whatever it had heard.
- **Fix:** when recognition ends with words heard and nothing finalised, the words ARE the answer — the last interim is sent. And `speak()` is single-exit, so the fallback can only fire once.
- **Verified** in a real browser against a faked iOS-style recogniser that only ever emits interims: both interim-only utterances became turns and the conversation advanced. Harness note: this Chromium exposes a native unprefixed `SpeechRecognition`, so the fake must override both constructors.

### R-048 — Long breaths between sentences, and no way to argue back
- **Symptom (pauses):** the advisor started speaking promptly, then took long pauses between sentences.
- **Cause:** each sentence's audio was requested by the `<audio>` element when its turn came. The prewarm warmed the *fetch* cache — but Safari's media loader bypasses the fetch cache, so on the device that matters most every sentence still paid a full round trip (and a TTS synthesis on a cold edge).
- **Fix:** `speakSequence` fetches every part's audio up front, in parallel, as blobs; playback starts from memory in the same frame. `speak()` accepts a preloaded object URL.
- **Symptom (debate):** "why that one?" and "I don't like it" bounced off the tangent classifier.
- **Fix:** `readFollowup` reads a challenge. "Why" is answered with the pick's actual reasoning and timing; a dislike swaps the product for the next-best that clears the same checks, names the change out loud, and the rejection persists (`dislikedIds`) so no later rebuild brings it back. A swap with no target asks which; a step with no alternative says so honestly instead of pretending.
- **Note:** a `\b` typed into a Python heredoc became a literal backspace byte, so the first version of the followup regexes matched nothing — and un-bounded, "whatever" contains "hate". Caught by running the classifier before wiring it.

### R-049 — The photo look now sounds like a person who looked
- **What was wrong:** the observation line was a machine reading a comma list ("From the photo I can see slight oiliness, visible texture, uneven-looking tone.") — and on voice it was never spoken at all: the shopper heard silence, then a question, as if the photo had gone nowhere. The not-skin and which-part branches added to the vision endpoint earlier had no client handling either.
- **Fix:** `describePhoto` weaves located observations into speech — "Right — I've had a proper look. I can see shine across the forehead and nose and small clustered bumps on the chin. Nothing there that worries me, and it gives me a much better picture to work from." — spoken aloud in voice mode before the next question, in both languages (the vision model is asked for located, Arabic-when-Arabic phrases). A photo of a keyboard is told it looks like a keyboard and asked for skin; skin the model can't place asks "whereabouts is this?". A photo of a hand now routes the routine to body products via the bodyArea slot.
- **And the handoff:** when a photo was involved, the routine ends with the dermatologist's escape hatch, cacheable like every fixed line: "And since I've actually seen it — give this six weeks of consistent use. If what I saw hasn't visibly shifted by then, that's when I'd want a dermatologist's eyes on it rather than mine."
- **Verified** in a real browser: look line spoken/shown, six-week note on the result, keyboard called a keyboard.
