import { afterEach, describe, expect, it, vi } from "vitest";

const getTenantPrismaMock = vi.fn();

// Defer access (arrow) so the factory reads the mock at call time.
vi.mock("@/server/db", () => ({
  getTenantPrisma: () => getTenantPrismaMock(),
  getPrisma: vi.fn(),
}));

import { withTenant } from "@/lib/tenant-context";

afterEach(() => {
  getTenantPrismaMock.mockReset();
  delete process.env.TENANT_DATABASE_URL;
});

describe("withTenant", () => {
  it("returns null and skips the callback when no database is configured", async () => {
    getTenantPrismaMock.mockReturnValue(null);
    const fn = vi.fn(async () => "value");
    expect(await withTenant("tenant_1", fn)).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it("runs directly on the client (no transaction) while the tenant role is dormant", async () => {
    const client = { $transaction: vi.fn() };
    getTenantPrismaMock.mockReturnValue(client);
    const fn = vi.fn(async () => "direct");
    expect(await withTenant("tenant_1", fn)).toBe("direct");
    expect(fn).toHaveBeenCalledWith(client);
    expect(client.$transaction).not.toHaveBeenCalled();
  });

  it("wraps the work in a tenant-scoped transaction once TENANT_DATABASE_URL is set", async () => {
    process.env.TENANT_DATABASE_URL = "postgres://app@host/db";
    const tx = { $executeRaw: vi.fn(async () => undefined) };
    const client = { $transaction: vi.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)) };
    getTenantPrismaMock.mockReturnValue(client);
    const fn = vi.fn(async () => "scoped");

    expect(await withTenant("tenant_1", fn)).toBe("scoped");
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    // The GUC that RLS keys on must be set inside the transaction.
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(tx);
  });
});
