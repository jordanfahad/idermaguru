export type LiveConsultationVendor = {
  name: string;
  domain: string;
  share: number;
  accent: string;
};

export type LiveConsultationProduct = {
  id: string;
  vendor: string;
  name: string;
  category: string;
  imageUrl: string;
  price: string;
  url: string;
  routineSlot: string;
  why: string;
  safety: string;
  trust: string;
  bundleTag?: string;
  priority?: number;
  keywords?: string[];
  beforePrice?: string;
  afterPrice?: string;
  variantId?: string;
  inventorySize?: number;
  discoveryOnly?: boolean;
};

export type LiveConsultationConfig = {
  id: string;
  slug: string;
  title: string;
  subtitle: string;
  primaryVendor: string;
  vendors: LiveConsultationVendor[];
  products: LiveConsultationProduct[];
};

export const liveConsultationOne: LiveConsultationConfig = {
  id: "1",
  slug: "live-consultation-1",
  title: "Consult our AI skin advisor for your best OTC skincare routine and product matches.",
  subtitle:
    "A curated, merchant-controlled OTC skincare consultation page for routine bundles, slow-moving product pushes, and partner traffic routing.",
  primaryVendor: "Cicabelle",
  vendors: [
    { name: "Cicabelle", domain: "cicabelle.com", share: 100, accent: "#ff5f7a" },
    { name: "Sephora", domain: "sephora.com", share: 0, accent: "#111111" },
    { name: "Amazon.ae", domain: "amazon.ae", share: 0, accent: "#ffb100" },
    { name: "Lookfantastic UAE", domain: "lookfantastic.ae", share: 0, accent: "#00a894" },
  ],
  products: [
    {
      id: "cica-sa-cleanser",
      vendor: "Cicabelle",
      name: "CeraVe SA Smoothing Cleanser 236 ml",
      category: "Cleanser",
      imageUrl: "https://cicabelle.com/cdn/shop/files/77991_1_1.jpg?v=1720613416&width=1080",
      price: "AED 65",
      beforePrice: "AED 82",
      afterPrice: "AED 65",
      url: "https://cicabelle.com/products/cerave-sa-smoothing-cleanser-236-ml",
      routineSlot: "1. Cleanse",
      why: "A gentle rinse-off option for oily skin, blackheads, texture, and rough-feeling skin when acids are suitable.",
      safety: "Avoid if allergic to salicylic acid or if the barrier is burning or severely irritated.",
      trust: "Selected from the approved product catalog with brand-authenticity checks.",
      bundleTag: "Blackhead routine",
      priority: 95,
      keywords: ["blackheads", "oily", "pores", "texture", "salicylic", "cleanser"],
    },
    {
      id: "cica-axis-y-dark-spot",
      vendor: "Cicabelle",
      name: "Axis-Y Dark Spot Correcting Glow Serum 50ml",
      category: "Serum",
      imageUrl: "https://cicabelle.com/cdn/shop/files/Axis-1.jpg?v=1719905021&width=1080",
      price: "AED 69",
      beforePrice: "AED 79",
      afterPrice: "AED 69",
      url: "https://cicabelle.com/products/axis-y-dark-spot-correcting-glow-serum-50ml",
      routineSlot: "2. Tone support",
      why: "A niacinamide-led serum slot for dullness, uneven-looking tone, and post-blemish marks when there are no red flags.",
      safety: "Introduce slowly and do not combine with too many new actives at once.",
      trust: "Selected from the approved product catalog with brand-authenticity checks.",
      bundleTag: "Glow routine",
      priority: 92,
      keywords: ["dark spots", "dull", "glow", "uneven", "tone", "niacinamide", "hyperpigmentation"],
    },
    {
      id: "cica-cerave-lotion",
      vendor: "Cicabelle",
      name: "CeraVe Moisturising Lotion 236 ml",
      category: "Moisturizer",
      imageUrl: "https://cicabelle.com/cdn/shop/files/11798696-1265145763656570.webp?v=1720515822&width=1080",
      price: "AED 85",
      beforePrice: "AED 99",
      afterPrice: "AED 85",
      url: "https://cicabelle.com/products/cerave-lait-hydratant-moisturising-lotion-236-ml",
      routineSlot: "3. Moisturize",
      why: "A barrier-support moisturizer for dry, tight, or sensitive-feeling skin that needs a simple comfort step.",
      safety: "Patch test first. Stop use if severe stinging, swelling, or rash occurs.",
      trust: "Selected from the approved product catalog with brand-authenticity checks.",
      bundleTag: "Barrier support",
      priority: 90,
      keywords: ["dry", "sensitive", "barrier", "moisturizer", "ceramide", "hydration"],
    },
    {
      id: "cica-effaclar-mat",
      vendor: "Cicabelle",
      name: "La Roche-Posay Effaclar Mat Moisturizer 40ml",
      category: "Moisturizer",
      imageUrl: "https://cicabelle.com/cdn/shop/files/11091826-5394684952065356.webp?v=1714412244&width=1080",
      price: "AED 60",
      beforePrice: "AED 80",
      afterPrice: "AED 60",
      url: "https://cicabelle.com/products/la-roche-posay-effaclar-mat-mattifying-moisturizer-for-oily-skin-40ml",
      routineSlot: "3. Oil-control moisture",
      why: "A lightweight moisturizer for oily or shiny skin that needs hydration without a heavy finish.",
      safety: "May not suit very sensitive or fragrance-reactive skin; patch test before daily use.",
      trust: "Selected from the approved product catalog with brand-authenticity checks.",
      bundleTag: "Oily skin",
      priority: 88,
      keywords: ["oily", "shine", "pores", "moisturizer", "matte", "lightweight"],
    },
    {
      id: "cica-beauty-joseon-spf",
      vendor: "Cicabelle",
      name: "Beauty of Joseon Relief Sun Rice + Probiotics SPF50+",
      category: "Sunscreen",
      imageUrl: "https://cicabelle.com/cdn/shop/files/1_1da2fe71-5513-47b0-8bd5-90de9ad702f7.jpg?v=1726113547&width=1080",
      price: "AED 70",
      beforePrice: "AED 85",
      afterPrice: "AED 70",
      url: "https://cicabelle.com/products/beauty-of-joseon-relief-sun-rice-probiotics-50ml-spf50-pa",
      routineSlot: "4. Protect",
      why: "A daily SPF step is non-negotiable for acne marks, dark spots, texture routines, and preventing visible tone setbacks.",
      safety: "Use every morning as directed and reapply during sun exposure. Avoid the eye area if it stings.",
      trust: "Selected from the approved product catalog with brand-authenticity checks.",
      bundleTag: "Daily SPF",
      priority: 91,
      keywords: ["sunscreen", "spf", "dark spots", "acne marks", "dull", "protect", "morning"],
    },
    {
      id: "cica-paulas-bha",
      vendor: "Cicabelle",
      name: "Paula's Choice 2% BHA Liquid Exfoliant 118ml",
      category: "Exfoliant",
      imageUrl: "https://cicabelle.com/cdn/shop/files/p-1.jpg?v=1735534543&width=1080",
      price: "AED 121",
      beforePrice: "AED 145",
      afterPrice: "AED 121",
      url: "https://cicabelle.com/products/paulas-choice-skin-perfecting-2-bha-liquid-exfoliant-118ml-blackhead-pore-solution",
      routineSlot: "4. Optional exfoliant",
      why: "A targeted optional step for blackheads, pores, and visible texture when the skin is not highly sensitive.",
      safety: "Use slowly. Avoid if allergic to salicylic acid, pregnant/breastfeeding without clinician guidance, or barrier-damaged.",
      trust: "Selected from the approved product catalog with brand-authenticity checks.",
      bundleTag: "Pore support",
      priority: 76,
      keywords: ["blackheads", "pores", "texture", "bha", "salicylic", "exfoliant"],
    },
    {
      id: "cica-vichy-mineral-89",
      vendor: "Cicabelle",
      name: "Vichy Mineral 89 Hyaluronic Acid Booster Serum 50ml",
      category: "Hydrating serum",
      imageUrl: "https://images.unsplash.com/photo-1596755389378-c31d21fd1273?auto=format&fit=crop&w=700&q=80",
      price: "Partner price",
      url: "https://cicabelle.com/products/vichy-mineral-89-hyaluronic-acid-booster-serum-50ml",
      routineSlot: "2. Hydrate",
      why: "A simple hydration layer for dry, dull, or tight-feeling skin without jumping straight into stronger actives.",
      safety: "Patch test and layer under moisturizer; stop if irritation develops.",
      trust: "Selected from the approved product catalog with brand-authenticity checks.",
      bundleTag: "Hydration",
      priority: 82,
      keywords: ["dry", "dehydrated", "hydration", "dull", "hyaluronic", "serum"],
    },
    {
      id: "sephora-spf-mineral",
      vendor: "Sephora",
      name: "Daily Mineral SPF Routine Finish",
      category: "Sunscreen",
      imageUrl: "https://images.unsplash.com/photo-1570172619644-dfd03ed5d881?auto=format&fit=crop&w=700&q=80",
      price: "Partner price",
      url: "https://www.sephora.com/product/mineral-sunscreen",
      routineSlot: "3. Protect",
      why: "A broad morning protection slot that makes every brightening or texture routine more sensible.",
      safety: "Use as directed on the label and reapply during sun exposure.",
      trust: "Selected from an approved retail catalog after suitability checks.",
      priority: 70,
      keywords: ["sunscreen", "spf", "dark spots", "dull", "protect"],
    },
    {
      id: "lookfantastic-hydration",
      vendor: "Lookfantastic UAE",
      name: "Hydration Layering Kit",
      category: "Hydration",
      imageUrl: "https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?auto=format&fit=crop&w=700&q=80",
      price: "Partner price",
      url: "https://www.lookfantastic.ae/hydration-layering-kit",
      routineSlot: "4. Optional hydration",
      why: "Adds a light, visual upsell for shoppers who want a dewy finish without prescription-style claims.",
      safety: "Skip if the user reports allergy to listed ingredients.",
      trust: "Partner marketplace slot controlled by super-admin weight settings.",
      priority: 65,
      keywords: ["hydration", "dry", "dewy", "barrier"],
    },
    {
      id: "amazon-basic-patches",
      vendor: "Amazon.ae",
      name: "Hydrocolloid Spot Patch Add-on",
      category: "Add-on",
      imageUrl: "https://images.unsplash.com/photo-1596462502278-27bfdc403348?auto=format&fit=crop&w=700&q=80",
      price: "Partner price",
      url: "https://www.amazon.ae/hydrocolloid-spot-patches",
      routineSlot: "5. Optional spot support",
      why: "A low-cost basket add-on for mild occasional blemishes without suggesting antibiotics or prescriptions.",
      safety: "Do not use on infected, painful, or open wounds; seek care for severe symptoms.",
      trust: "Selected from an approved retail catalog after suitability checks.",
      priority: 60,
      keywords: ["blemish", "spot", "acne", "pimple", "add-on"],
    },
  ],
};

export const liveConsultations = [liveConsultationOne];

export function selectWeightedLiveProducts(config: LiveConsultationConfig, totalSlots = 6) {
  const activeVendors = config.vendors.filter((vendor) => vendor.share > 0);
  const slots = Math.min(totalSlots, config.products.length);
  const quotas = activeVendors.map((vendor) => {
    const exact = (vendor.share / 100) * slots;
    return {
      vendor: vendor.name,
      count: Math.floor(exact),
      remainder: exact - Math.floor(exact),
      share: vendor.share,
    };
  });
  let assigned = quotas.reduce((sum, quota) => sum + quota.count, 0);
  quotas
    .sort((a, b) => b.remainder - a.remainder)
    .forEach((quota) => {
      if (assigned < slots) {
        quota.count += 1;
        assigned += 1;
      }
    });

  return quotas
    .sort((a, b) => b.share - a.share)
    .flatMap((quota) =>
      config.products
        .filter((product) => product.vendor === quota.vendor)
        .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        .slice(0, quota.count),
    );
}

export function dedicatedProductUrl(product: Pick<LiveConsultationProduct, "name" | "url" | "vendor">) {
  try {
    const url = new URL(product.url);
    const isHomepage = url.pathname === "/" || url.pathname === "";
    if (!isHomepage) return product.url;
    const slug = slugify(product.name);
    if (/cicabelle/i.test(product.vendor) || /cicabelle/i.test(url.hostname)) {
      return `https://cicabelle.com/products/${slug}`;
    }
    if (/sephora/i.test(product.vendor) || /sephora/i.test(url.hostname)) {
      return `https://www.sephora.com/product/${slug}`;
    }
    if (/lookfantastic/i.test(product.vendor) || /lookfantastic/i.test(url.hostname)) {
      return `https://www.lookfantastic.ae/${slug}`;
    }
    if (/amazon/i.test(product.vendor) || /amazon/i.test(url.hostname)) {
      return `https://www.amazon.ae/s?k=${encodeURIComponent(product.name)}`;
    }
    return product.url;
  } catch {
    return product.url;
  }
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
