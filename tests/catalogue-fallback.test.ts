import { describe, expect, it, vi } from "vitest";
import { seedTenant } from "@/data/seed-catalog";

/**
 * What a deployment with no database is allowed to serve.
 *
 * `getTenantBySlug` returned the built-in demo tenant for EVERY slug when
 * Prisma was unavailable, so a deployment with DATABASE_URL unset resolved
 * "cicabelle" to the demo tenant and then served the twelve seed products from
 * it. A real shop's advisor would have recommended generic demo stock it does
 * not sell — plausibly, in a full routine, with nothing logged and nothing on
 * screen to say the catalogue was not the merchant's.
 *
 * It was reachable before and it is reachable more easily now: the advisor
 * finally resolves a tenant, so a merchant slug is finally being asked for.
 */

vi.mock("@/server/db", () => ({
  getPrisma: () => null,
}));

const { getTenantBySlug, listTenantProducts } = await import("@/services/catalog");

describe("with no database configured", () => {
  it("still answers for the demo tenant under its own slug", () => {
    // The demo has to keep working — it is what runs locally and on a preview
    // deploy with no database attached.
    expect(getTenantBySlug(seedTenant.slug)).resolves.toMatchObject({ id: seedTenant.id });
  });

  it("resolves a merchant slug to no tenant rather than to the demo one", async () => {
    expect(await getTenantBySlug("cicabelle")).toBeNull();
  });

  it("serves a merchant no products rather than somebody else's", async () => {
    // An advisor with an empty catalogue can be honest. An advisor holding
    // twelve products that belong to nobody in particular cannot.
    expect(await listTenantProducts("cicabelle")).toEqual([]);
  });

  it("still serves the demo catalogue for the demo tenant", async () => {
    const products = await listTenantProducts(seedTenant.slug);
    expect(products.length).toBeGreaterThan(0);
    expect(products.every((product) => product.tenantId === seedTenant.id)).toBe(true);
  });
});
