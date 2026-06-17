import { products, type Product } from "@/lib/products";

export type Recommendation = {
  title: string;
  slug: string;
  concern: string;
  skinType: string;
  summary: string;
  routine: {
    step: string;
    timing: string;
    productId: string;
    note: string;
    product?: {
      id: string;
      name: string;
      category: string;
      imageUrl?: string;
      url: string;
      beforePrice?: string;
      afterPrice?: string;
      price?: string;
    };
  }[];
  avoid: string[];
  seoTitle: string;
  seoDescription: string;
  createdAt: string;
};

const emergencyWords = [
  "infection",
  "bleeding",
  "burn",
  "severe pain",
  "swollen eye",
  "spreading rash",
  "fever",
  "mole changed",
];

export function needsMedicalCare(concern: string) {
  const lower = concern.toLowerCase();
  return emergencyWords.some((word) => lower.includes(word));
}

export function selectProducts(concern: string, skinType: string) {
  const terms = concern
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const scored = products.map((product) => {
    const tagScore = product.concernTags.reduce(
      (score, tag) =>
        score + (terms.some((term) => tag.includes(term) || term.includes(tag)) ? 3 : 0),
      0,
    );
    const nameScore = terms.some((term) => product.name.toLowerCase().includes(term))
      ? 2
      : 0;
    const skinScore = product.skinTypes.includes(skinType.toLowerCase()) ? 2 : 0;

    return { product, score: tagScore + nameScore + skinScore };
  });

  const picks = scored
    .sort((a, b) => b.score - a.score)
    .map(({ product }) => product);

  return ensureRoutineCoverage(picks);
}

function ensureRoutineCoverage(picks: Product[]) {
  const bySlot = new Map<Product["routineSlot"], Product>();

  for (const product of picks) {
    if (!bySlot.has(product.routineSlot)) {
      bySlot.set(product.routineSlot, product);
    }
  }

  const basics = ["cleanse", "treat", "hydrate", "protect"] as const;
  for (const slot of basics) {
    if (!bySlot.has(slot)) {
      const fallback = products.find((product) => product.routineSlot === slot);
      if (fallback) bySlot.set(slot, fallback);
    }
  }

  return basics
    .map((slot) => bySlot.get(slot))
    .filter((product): product is Product => Boolean(product));
}

export function slugify(value: string) {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 70);

  return cleaned || "skin-routine";
}

export function createFallbackRecommendation(input: {
  concern: string;
  skinType: string;
  goals: string[];
}): Recommendation {
  const picks = selectProducts(input.concern, input.skinType);
  const concernSlug = slugify(`${input.skinType} skin ${input.concern}`);

  return {
    title: `Your ${input.skinType} skin glow plan`,
    slug: `${concernSlug}-${Date.now().toString(36)}`,
    concern: input.concern,
    skinType: input.skinType,
    summary:
      "Here is a cosmetic-only routine matched to your concern using OTC products from the approved AI Derma Guru catalog.",
    routine: picks.map((product, index) => ({
      step: `${index + 1}. ${labelForSlot(product.routineSlot)}`,
      timing: timingForSlot(product.routineSlot),
      productId: product.id,
      note: product.why,
    })),
    avoid: [
      "Do not start multiple strong actives on the same night.",
      "Patch test new products and stop if irritation appears.",
      "See a licensed clinician for pain, infection signs, fast-spreading rashes, or changing moles.",
    ],
    seoTitle: `Best AI Derma Guru routine for ${input.concern}`,
    seoDescription: `A cosmetic OTC skincare routine for ${input.concern}, matched to ${input.skinType} skin with approved product links.`,
    createdAt: new Date().toISOString(),
  };
}

function labelForSlot(slot: Product["routineSlot"]) {
  const labels = {
    cleanse: "Gentle cleanse",
    treat: "Targeted serum",
    hydrate: "Barrier support",
    protect: "Daily SPF",
    weekly: "Weekly polish",
  };

  return labels[slot];
}

function timingForSlot(slot: Product["routineSlot"]) {
  const timings = {
    cleanse: "AM and PM",
    treat: "PM first, then AM if tolerated",
    hydrate: "AM and PM",
    protect: "Every morning",
    weekly: "1-2 nights per week",
  };

  return timings[slot];
}
