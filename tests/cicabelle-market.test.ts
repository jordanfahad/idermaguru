import { describe, expect, it } from "vitest";
import { blockedInMarket, formatMarketPrice, localProductUrl, resolveMarket } from "@/lib/cicabelle-market";

describe("Cicabelle market for the advisor", () => {
  it("prefers the app's explicit country, then the visitor's network country, else the UAE", () => {
    expect(resolveMarket("sa", "AE")).toBe("SA");
    expect(resolveMarket("AE", "KW")).toBe("AE");
    expect(resolveMarket(undefined, "KW")).toBe("KW");
    expect(resolveMarket(null, "SA")).toBe("SA");
    expect(resolveMarket("FR", "US")).toBe("AE");
    expect(resolveMarket(undefined, null)).toBe("AE");
  });

  it("blocks the no-ship list only outside the UAE", () => {
    const url = "https://cicabelle.com/products/la-roche-posay-effaclar-duo-spf30-with-niacinamide-40ml";
    expect(blockedInMarket("SA", url)).toBe(true);
    expect(blockedInMarket("KW", "la-roche-posay-effaclar-duo-spf30-with-niacinamide-40ml")).toBe(true);
    expect(blockedInMarket("AE", url)).toBe(false);
    expect(blockedInMarket("SA", "https://cicabelle.com/products/cerave-sa-smoothing-cleanser-236-ml")).toBe(false);
  });

  it("links the shopper's own store, keeping the UAE link unchanged", () => {
    const url = "https://cicabelle.com/products/cerave-sa-smoothing-cleanser-236-ml";
    expect(localProductUrl(url, "SA", "en")).toBe("https://cicabelle.com/en-sa/products/cerave-sa-smoothing-cleanser-236-ml");
    expect(localProductUrl(url, "KW", "ar")).toBe("https://cicabelle.com/ar-kw/products/cerave-sa-smoothing-cleanser-236-ml");
    expect(localProductUrl(url, "AE", "ar")).toBe(url);
  });

  it("formats prices like the app: SAR as Shopify gives it, Kuwait in KWD to the fils", () => {
    expect(formatMarketPrice(83, "SAR", "SA", "en")).toBe("SAR 83");
    expect(formatMarketPrice(100.8, "SAR", "SA", "en")).toBe("SAR 100.80");
    expect(formatMarketPrice(83, "SAR", "SA", "ar")).toBe("⁦83 ر.س⁩");
    // Same rule as the app's formatMarketMoney: AED 48.30 × 0.0853, rounded half up to the fils.
    expect(formatMarketPrice(48.3, "AED", "KW", "en")).toBe("KWD 4.120");
    expect(formatMarketPrice(48.3, "AED", "KW", "en")).not.toContain("AED");
  });
});
