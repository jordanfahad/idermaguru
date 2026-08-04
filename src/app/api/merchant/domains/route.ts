import { NextResponse } from "next/server";
import { seedTenant } from "@/data/seed-catalog";
import { getConsoleAccess } from "@/lib/merchant-access";
import { getTenantBySlug } from "@/services/catalog";
import {
  connectDomain,
  disconnectDomain,
  domainConnectionAvailable,
  listDomainsForTenant,
  refreshDomain,
} from "@/services/merchant-domains";

/**
 * The merchant console's domain plane.
 *
 * Deliberately NOT in ADVISOR_API_PREFIXES (src/proxy.ts): this is console
 * machinery and has no business answering on a merchant's advisor subdomain,
 * where it would 404 as everything else outside the advisor does.
 *
 * Every handler resolves the tenant from the SESSION, never from the request.
 * A domain is a claim on a hostname; letting the body say which store it was
 * for would let any signed-in merchant point a domain at somebody else's
 * catalogue.
 */
export const dynamic = "force-dynamic";

async function tenantIdForCaller() {
  const access = await getConsoleAccess();
  if (!access) return null;
  if (access.tenantSlug) {
    const tenant = await getTenantBySlug(access.tenantSlug);
    return tenant?.id ?? null;
  }
  // Staff are not bound to a store, so they administer the default one — the
  // same rule the dashboard itself applies.
  return seedTenant.id;
}

export async function GET() {
  const tenantId = await tenantIdForCaller();
  if (!tenantId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const domains = await listDomainsForTenant(tenantId);
  // Ask Vercel about anything still pending, so opening the page is enough to
  // move a domain to live once the merchant's record has landed.
  const refreshed = await Promise.all(
    domains.map(async (domain) =>
      domain.status === "PENDING" ? ((await refreshDomain(tenantId, domain.host)) ?? domain) : domain,
    ),
  );

  return NextResponse.json({ domains: refreshed, available: domainConnectionAvailable() });
}

export async function POST(request: Request) {
  const tenantId = await tenantIdForCaller();
  if (!tenantId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { host?: unknown };
  if (typeof body.host !== "string") {
    return NextResponse.json({ error: "A domain is required." }, { status: 400 });
  }

  const outcome = await connectDomain(tenantId, body.host);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 400 });

  return NextResponse.json({ domain: outcome.domain });
}

export async function DELETE(request: Request) {
  const tenantId = await tenantIdForCaller();
  if (!tenantId) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const host = new URL(request.url).searchParams.get("host");
  if (!host) return NextResponse.json({ error: "A domain is required." }, { status: 400 });

  const removed = await disconnectDomain(tenantId, host);
  if (!removed) return NextResponse.json({ error: "That domain is not connected to this store." }, { status: 404 });

  return NextResponse.json({ removed: true });
}
