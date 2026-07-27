# Regression Log

A running list of bugs found in DermaGuru, so they are not reintroduced. Append
to the top of the current section every time a bug is found — including bugs
found and fixed inside the same change, because those are the ones most likely
to come back.

Each entry records the symptom a shopper would see, the root cause, and the test
that now guards it. An entry without a guarding test is a bug waiting to return.

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
