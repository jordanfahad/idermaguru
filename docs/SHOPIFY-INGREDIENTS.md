# Ingredients: filling them in Shopify

The advisor reads an ingredient list per product from a Shopify metafield. This
is how to create it and fill it in bulk.

It is worth doing for a reason that is not the obvious one. See
[Why this matters more than it looks](#why-this-matters-more-than-it-looks).

---

## 1. Create the metafield definition

**Settings → Custom data → Products → Add definition**

| | |
|---|---|
| Name | `Ingredients` |
| Namespace and key | **`custom.ingredients`** |
| Type | **Multi-line text** |

The namespace and key are what the sync looks for. `custom.ingredients` exactly
— a different namespace is a different field and will not be read.

**Multi-line text** is the recommended type, but *List of single line text* and
*Rich text* are both read correctly too, so a definition already created as one
of those does not need redoing.

The one type that will **not** work is a reference — *Metaobject*, *Product*,
*File*. Those store object ids rather than words, and the sync shows nothing
rather than showing a shopper `gid://shopify/Metaobject/123`. If ingredients are
already built as a metaobject library, say so and we will add the extra lookup.

## 2. Fill it in bulk

**Create the definition first, then export.** Once it exists, Shopify includes a
column for it in the product CSV with the exact header it expects back on
import. Let Shopify generate that header rather than typing it from a guide —
including this one.

1. **Products → Export → All products, CSV for Excel**
2. Fill the ingredients column
3. **Products → Import**, tick *Overwrite existing products*

At a few hundred rows the CSV round-trip is fine. **Matrixify** is the app most
merchants use if it starts to hurt.

## 3. Re-sync

The catalogue only changes when the sync runs. Trigger it from the merchant
dashboard, or `POST /api/shopify/sync`.

---

## What to put in the field

The INCI list as printed on the carton, separated by commas:

```
Aqua, Glycerin, Niacinamide, Zinc PCA, Pentylene Glycol, Tocopherol
```

Semicolons and line breaks work as separators too, so a paste out of a
spreadsheet or a rich-text field survives. Duplicates are dropped, HTML is
stripped, and the list is capped at 80 ingredients of 80 characters each — one
runaway cell should not be re-read on every catalogue load.

A product with no value syncs exactly as it does today. There is no penalty for
filling in some and not others.

---

## If the list is already in the description

Most catalogues already have the INCI list sitting in the product description
under a heading. When the metafield is empty, the sync reads it from there:

```
Ingredients: Aqua, Glycerin, Niacinamide, Butylene Glycol, Panthenol

How to use: apply two pumps morning and evening.
```

It stops at the next heading, so *How to use* does not end up in the list.

This is a fallback, not a substitute — **the metafield always wins.** And it is
deliberately hard to satisfy, because the failure it guards against is showing a
shopper marketing copy under the word Ingredients. Both of these must hold:

- at least five entries — a "key ingredients" highlight reel is not what is in
  the bottle
- at least one thing that appears in nearly every cosmetic formula (aqua,
  glycerin, phenoxyethanol, tocopherol and so on)

A run of claims — *cruelty free, vegan, paraben free, sulfate free* — is long
enough and still gets rejected, because none of it is an ingredient.

---

## Why this matters more than it looks

The visible reason is the **"What's in it?"** chip on the product panel, which
only appears for products where we hold something to show.

That is not the important one.

Every safety derivation in the sync — active ingredients, pregnancy status,
whether something is gentle enough for sensitive skin — is matched against the
product's **text**. Until this field existed, that text was a marketing title
and a description.

So a retinol cream sold as *"Overnight Renewal Treatment"* had:

| | without ingredients | with them |
|---|---|---|
| actives | *(none found)* | `retinol` |
| pregnancy status | `UNKNOWN` | **`AVOID`** |
| avoid list | *(empty)* | `pregnancy` |

`UNKNOWN` passes a filter that `AVOID` stops. That product could be recommended
to someone who has said they are pregnant, because nothing in its name or its
marketing copy ever said what was in it.

**This means accuracy matters more than coverage.** A wrong ingredient list is
worse than a missing one — it feeds the pregnancy and allergy gates, and a gate
fed bad data is worse than a gate that knows it is uninformed. Better to leave a
product blank than to guess at it.

---

## What the sync does with it

REST's `products.json` returns no metafields, so the sync fetches them
separately through GraphQL — `nodes` answers for 250 products per request, so
a 444-product catalogue costs two calls rather than 444 against a two-per-second
limit.

A shop with no `custom.ingredients` definition gets nothing back and syncs
unchanged. A failed metafield query is swallowed rather than raised: a sync that
dropped an entire catalogue because a nice-to-have field could not be read would
be trading an advisor for a chip.
