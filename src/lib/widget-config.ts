import { CUSTOMER_DISCLAIMER } from "@/domain/skincare";

/**
 * Public, PII-free tenant configuration the embeddable widget fetches on load.
 * Brand visual tokens (color, radius, font, locale, rtl) are supplied by the
 * merchant via the embed script's data-* attributes; this payload carries only
 * the safe server-owned values: the display name and the safety disclaimer.
 */
export type PublicWidgetConfig = {
  tenant: string;
  name: string;
  disclaimer: string;
  found: boolean;
};

export function buildWidgetConfig(input: {
  slug: string;
  name?: string | null;
  disclosureText?: string | null;
  found: boolean;
}): PublicWidgetConfig {
  return {
    tenant: input.slug,
    name: input.name?.trim() || "Skincare Advisor",
    disclaimer: input.disclosureText?.trim() || CUSTOMER_DISCLAIMER,
    found: input.found,
  };
}
