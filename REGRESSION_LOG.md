# Regression Log

A running list of bugs found in DermaGuru, so they are not reintroduced. Append
to the top of the current section every time a bug is found — including bugs
found and fixed inside the same change, because those are the ones most likely
to come back.

Each entry records the symptom a shopper would see, the root cause, and the test
that now guards it. An entry without a guarding test is a bug waiting to return.

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
