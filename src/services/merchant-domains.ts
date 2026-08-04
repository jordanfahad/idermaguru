import { getPrisma } from "@/server/db";
import { tenantSlugForHost as envTenantSlugForHost, normaliseHost } from "@/lib/advisor-hosts";
import {
  addProjectDomain,
  dnsInstructionFor,
  getDomainConfig,
  removeProjectDomain,
  vercelConfig,
  type DnsInstruction,
} from "@/lib/vercel-domains";

export type ConnectedDomain = {
  host: string;
  status: "PENDING" | "VERIFIED";
  verifiedAt: Date | null;
  dns: DnsInstruction;
};

/**
 * A hostname is only a hostname. Rejected on shape before it reaches Vercel or
 * the database: the value came from a text box, it becomes a unique key, and it
 * is later compared against a request's Host header.
 */
export function asHost(value: string | null | undefined): string | null {
  // Scheme and path come off BEFORE normalising. normaliseHost cuts at the
  // first colon to drop a port, which on "https://host/path" would cut at the
  // scheme's colon and leave "https".
  const host = normaliseHost(
    (value ?? "")
      .trim()
      // People paste URLs into domain boxes. Take the host out rather than
      // refusing, which reads as the product being broken.
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .replace(/\/.*$/, ""),
  );
  if (!host || host.length > 253) return null;
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(host)) return null;
  return host;
}

/**
 * Host → tenant slug, database first.
 *
 * ADVISOR_HOSTS still wins where it names a host. It is set by whoever operates
 * the deployment rather than by a merchant typing in a console, so it is the
 * stronger claim of the two, and it stays the way to pin a host without a
 * database. Everything else comes from MerchantDomain.
 *
 * Only VERIFIED rows resolve. A pending row is a hostname somebody typed; until
 * DNS points here, treating it as authoritative would let one merchant claim a
 * host they do not control and answer on it the moment they did.
 *
 * Node-only — reads Prisma. The middleware cannot call this (it runs on the
 * Edge); it keeps using the environment list, which is why the guard there is
 * "does this look like an advisor host" rather than "whose is it".
 */
const CACHE_TTL_MS = 30_000;
const hostCache = new Map<string, { at: number; slug: string | null }>();

export function invalidateDomainCache(host?: string) {
  if (host) hostCache.delete(normaliseHost(host));
  else hostCache.clear();
}

export async function tenantSlugForRequestHost(host: string | null | undefined): Promise<string | null> {
  const name = normaliseHost(host);
  if (!name) return null;

  const pinned = envTenantSlugForHost(name);
  if (pinned) return pinned;

  const cached = hostCache.get(name);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.slug;

  const prisma = getPrisma();
  if (!prisma) return null;

  try {
    const row = await prisma.merchantDomain.findFirst({
      where: { host: name, status: "VERIFIED" },
      select: { tenant: { select: { slug: true } } },
    });
    const slug = row?.tenant.slug ?? null;
    hostCache.set(name, { at: Date.now(), slug });
    return slug;
  } catch {
    // A database that cannot answer must not silently become "no merchant
    // owns this host" for the length of a cache window.
    return null;
  }
}

export async function listDomainsForTenant(tenantId: string): Promise<ConnectedDomain[]> {
  const prisma = getPrisma();
  if (!prisma) return [];

  try {
    const rows = await prisma.merchantDomain.findMany({
      where: { tenantId },
      orderBy: { createdAt: "asc" },
      select: { host: true, status: true, verifiedAt: true },
    });
    return rows.map((row) => ({ ...row, dns: dnsInstructionFor(row.host) }));
  } catch {
    return [];
  }
}

export type ConnectOutcome =
  | { ok: true; domain: ConnectedDomain }
  | { ok: false; error: string };

/**
 * Connect a hostname to a merchant: register it with Vercel, then record it.
 *
 * Vercel is called first. If it refuses — most often because another project
 * already holds the domain — there should be no row claiming a host we cannot
 * actually serve.
 */
export async function connectDomain(tenantId: string, rawHost: string): Promise<ConnectOutcome> {
  const host = asHost(rawHost);
  if (!host) return { ok: false, error: "That does not look like a domain name." };

  const prisma = getPrisma();
  if (!prisma) return { ok: false, error: "No database is configured." };

  const taken = await prisma.merchantDomain.findUnique({ where: { host }, select: { tenantId: true } });
  if (taken && taken.tenantId !== tenantId) {
    // Deliberately does not say who has it.
    return { ok: false, error: "That domain is already connected to another store." };
  }

  const added = await addProjectDomain(host);
  if (!added.ok && added.reason !== "conflict") {
    if (added.reason === "unconfigured") {
      return { ok: false, error: "Domain connection is not set up yet. Ask an administrator to add VERCEL_API_TOKEN." };
    }
    return { ok: false, error: added.message };
  }
  // A conflict when we already hold the row is just a repeat of a finished
  // step, so it falls through to the upsert and re-shows the DNS record.

  const row = await prisma.merchantDomain.upsert({
    where: { host },
    create: { host, tenantId },
    update: {},
    select: { host: true, status: true, verifiedAt: true },
  });

  invalidateDomainCache(host);
  return { ok: true, domain: { ...row, dns: dnsInstructionFor(host) } };
}

/**
 * Ask Vercel whether the merchant's DNS has landed, and record the answer.
 *
 * Called when the console is opened and by its poll. Verification is one-way on
 * purpose: a domain that has been live does not get marked pending again by a
 * transient DNS lookup, which would take a working advisor off a storefront.
 */
export async function refreshDomain(tenantId: string, rawHost: string): Promise<ConnectedDomain | null> {
  const host = asHost(rawHost);
  if (!host) return null;

  const prisma = getPrisma();
  if (!prisma) return null;

  const existing = await prisma.merchantDomain.findFirst({
    where: { host, tenantId },
    select: { host: true, status: true, verifiedAt: true },
  });
  if (!existing) return null;
  if (existing.status === "VERIFIED") return { ...existing, dns: dnsInstructionFor(host) };

  const config = await getDomainConfig(host);
  if (!config.ok || config.data.misconfigured) {
    return { ...existing, dns: dnsInstructionFor(host) };
  }

  const row = await prisma.merchantDomain.update({
    where: { host },
    data: { status: "VERIFIED", verifiedAt: new Date() },
    select: { host: true, status: true, verifiedAt: true },
  });
  invalidateDomainCache(host);
  return { ...row, dns: dnsInstructionFor(host) };
}

export async function disconnectDomain(tenantId: string, rawHost: string): Promise<boolean> {
  const host = asHost(rawHost);
  if (!host) return false;

  const prisma = getPrisma();
  if (!prisma) return false;

  const owned = await prisma.merchantDomain.findFirst({ where: { host, tenantId }, select: { id: true } });
  if (!owned) return false;

  await removeProjectDomain(host);
  await prisma.merchantDomain.delete({ where: { host } });
  invalidateDomainCache(host);
  return true;
}

/** Whether the console should offer this at all, or explain it is not set up. */
export function domainConnectionAvailable(): boolean {
  return vercelConfig() !== null;
}
