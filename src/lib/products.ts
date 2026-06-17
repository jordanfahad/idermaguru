export type Product = {
  id: string;
  name: string;
  brand: string;
  price: string;
  concernTags: string[];
  skinTypes: string[];
  routineSlot: "cleanse" | "treat" | "hydrate" | "protect" | "weekly";
  why: string;
  url: string;
};

export const products: Product[] = [
  {
    id: "beauty-of-joseon-relief-sun",
    name: "Beauty of Joseon Relief Sun Rice + Probiotics SPF50+",
    brand: "Beauty of Joseon",
    price: "AED 70",
    concernTags: ["spf", "dark spots", "glow", "anti-aging", "sensitive"],
    skinTypes: ["dry", "normal", "combination", "sensitive"],
    routineSlot: "protect",
    why: "A daily sunscreen pick for glow routines and dark-spot prevention.",
    url: "https://aiderma.guru/products/beauty-of-joseon-relief-sun-rice-probiotics",
  },
  {
    id: "dr-althea-345-relief-cream",
    name: "Dr. Althea 345 Relief Cream",
    brand: "Dr. Althea",
    price: "AED 69",
    concernTags: ["redness", "blemishes", "barrier", "sensitive", "calm"],
    skinTypes: ["dry", "normal", "combination", "sensitive"],
    routineSlot: "hydrate",
    why: "A soothing moisturizer for barrier support when skin feels reactive.",
    url: "https://aiderma.guru/products/dr-althea-345-relief-cream",
  },
  {
    id: "purito-bamboo-panthenol-cleanser",
    name: "Purito Seoul Mighty Bamboo Panthenol Cleanser",
    brand: "Purito Seoul",
    price: "AED 80",
    concernTags: ["cleanser", "barrier", "dryness", "sensitive", "redness"],
    skinTypes: ["dry", "normal", "combination", "sensitive"],
    routineSlot: "cleanse",
    why: "A gentle cleanser for routines that should avoid over-stripping.",
    url: "https://aiderma.guru/products/purito-seoul-mighty-bamboo-panthenol-cleanser",
  },
  {
    id: "la-roche-niacinamide-10",
    name: "La Roche Posay Niacinamide 10 Serum",
    brand: "La Roche-Posay",
    price: "AED 97",
    concernTags: ["dark spots", "pores", "redness", "uneven tone", "glow"],
    skinTypes: ["dry", "normal", "combination", "oily", "sensitive"],
    routineSlot: "treat",
    why: "A pigment and tone support serum for uneven-looking skin.",
    url: "https://aiderma.guru/products/la-roche-posay-niacinamide-10-serum",
  },
  {
    id: "ordinary-glycolic-7",
    name: "The Ordinary Glycolic Acid 7% Toning Solution",
    brand: "The Ordinary",
    price: "AED 55",
    concernTags: ["texture", "dullness", "bumps", "exfoliation", "uneven tone"],
    skinTypes: ["normal", "combination", "oily"],
    routineSlot: "weekly",
    why: "A once-or-twice weekly exfoliating step for visible texture and dullness.",
    url: "https://aiderma.guru/products/glycolic-acid-7-toning-solution",
  },
  {
    id: "bioderma-sebium-hydra",
    name: "Bioderma Sebium Hydra",
    brand: "Bioderma",
    price: "AED 85",
    concernTags: ["acne", "dryness", "barrier", "oiliness", "comfort"],
    skinTypes: ["combination", "oily", "sensitive"],
    routineSlot: "hydrate",
    why: "A comfort moisturizer for blemish-prone skin that still feels dry.",
    url: "https://aiderma.guru/products/bioderma-sebium-hydra",
  },
  {
    id: "axis-y-dark-spot",
    name: "Axis-Y Dark Spot Correcting Glow Serum",
    brand: "Axis-Y",
    price: "AED 69",
    concernTags: ["dark spots", "glow", "uneven tone", "post-acne", "dullness"],
    skinTypes: ["dry", "normal", "combination", "oily"],
    routineSlot: "treat",
    why: "A glow serum pick for post-blemish marks and uneven-looking tone.",
    url: "https://aiderma.guru/products/axis-y-dark-spot-correcting-glow-serum",
  },
  {
    id: "cerave-moisturizing-cream",
    name: "CeraVe Moisturizing Cream",
    brand: "CeraVe",
    price: "AED 75",
    concernTags: ["dryness", "barrier", "sensitive", "flaky", "comfort"],
    skinTypes: ["dry", "normal", "sensitive"],
    routineSlot: "hydrate",
    why: "A simple ceramide-rich moisturizer for dry or compromised-feeling skin.",
    url: "https://aiderma.guru/products/cerave-moisturizing-cream",
  },
];

export function getProductById(id: string) {
  return products.find((product) => product.id === id);
}

export function buildTrackedProductUrl(product: Product, slug?: string) {
  const params = new URLSearchParams({
    product: product.id,
  });

  if (slug) {
    params.set("recommendation", slug);
  }

  return `/api/out/${product.id}?${params.toString()}`;
}
