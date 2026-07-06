import { afterEach, describe, expect, it, vi } from "vitest";

const findUniqueSession = vi.fn();
const findUniqueEvent = vi.fn();

// Stub the Prisma accessor so the resolver logic can be tested without a DB.
vi.mock("@/server/db", () => ({
  getPrisma: () => ({
    userSession: { findUnique: findUniqueSession },
    event: { findUnique: findUniqueEvent },
  }),
}));

import { resolveConversionTenantId, resolveEventTenantId } from "@/services/tenant-scope";

afterEach(() => {
  findUniqueSession.mockReset();
  findUniqueEvent.mockReset();
});

describe("event tenant is derived from the session, never the client", () => {
  it("uses the session's tenant and ignores an attacker-supplied tenantId", async () => {
    findUniqueSession.mockResolvedValue({ tenantId: "tenant_real" });
    expect(await resolveEventTenantId("sess_1", "tenant_attacker")).toBe("tenant_real");
    expect(findUniqueSession).toHaveBeenCalledWith({
      where: { id: "sess_1" },
      select: { tenantId: true },
    });
  });

  it("returns null for an unknown session so the route rejects the write", async () => {
    findUniqueSession.mockResolvedValue(null);
    expect(await resolveEventTenantId("sess_missing", "tenant_attacker")).toBeNull();
  });

  it("requires a session id even when a tenantId is supplied", async () => {
    expect(await resolveEventTenantId(undefined, "tenant_attacker")).toBeNull();
    expect(findUniqueSession).not.toHaveBeenCalled();
  });
});

describe("conversion tenant resolution", () => {
  it("prefers the session's tenant", async () => {
    findUniqueSession.mockResolvedValue({ tenantId: "tenant_real" });
    expect(await resolveConversionTenantId("sess_1", "evt_click", "tenant_attacker")).toBe("tenant_real");
    expect(findUniqueEvent).not.toHaveBeenCalled();
  });

  it("falls back to the referenced click event's tenant when there is no session", async () => {
    findUniqueSession.mockResolvedValue(null);
    findUniqueEvent.mockResolvedValue({ tenantId: "tenant_from_click" });
    expect(await resolveConversionTenantId(null, "evt_click", "tenant_attacker")).toBe("tenant_from_click");
  });

  it("rejects a conversion that references neither a session nor a click", async () => {
    expect(await resolveConversionTenantId(null, null, "tenant_attacker")).toBeNull();
    expect(findUniqueEvent).not.toHaveBeenCalled();
  });
});
