import { describe, expect, it } from "vitest";
import { buildWidgetConfig } from "../src/lib/widget-config";
import { CUSTOMER_DISCLAIMER } from "../src/domain/skincare";

describe("buildWidgetConfig", () => {
  it("returns the tenant name and disclosure when present", () => {
    const config = buildWidgetConfig({
      slug: "cicabelle",
      name: "Cicabelle",
      disclosureText: "Educational beauty guidance — not medical advice.",
      found: true,
    });
    expect(config).toEqual({
      tenant: "cicabelle",
      name: "Cicabelle",
      disclaimer: "Educational beauty guidance — not medical advice.",
      found: true,
    });
  });

  it("falls back to a generic name and the standard disclaimer", () => {
    const config = buildWidgetConfig({ slug: "unknown", name: "  ", disclosureText: null, found: false });
    expect(config.name).toBe("Skincare Advisor");
    expect(config.disclaimer).toBe(CUSTOMER_DISCLAIMER);
    expect(config.found).toBe(false);
  });

  it("trims whitespace around provided values", () => {
    const config = buildWidgetConfig({ slug: "x", name: "  Glow Co  ", disclosureText: "  Be gentle.  ", found: true });
    expect(config.name).toBe("Glow Co");
    expect(config.disclaimer).toBe("Be gentle.");
  });
});
