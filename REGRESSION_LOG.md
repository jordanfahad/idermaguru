# Regression Log

A running list of bugs found in DermaGuru, so they are not reintroduced. Append
to the top of the current section every time a bug is found — including bugs
found and fixed inside the same change, because those are the ones most likely
to come back.

Each entry records the symptom a shopper would see, the root cause, and the test
that now guards it. An entry without a guarding test is a bug waiting to return.

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
