/**
 * Which merchant a request belongs to, decided by the hostname it arrived on.
 *
 * `ADVISOR_HOSTS` is a comma-separated list, one entry per hostname, in either
 * of two forms:
 *
 *   advisor.cicabelle.com=cicabelle    the host serves exactly this merchant
 *   advisor.cicabelle.com              an advisor host with no merchant pinned
 *
 * The second form is what the variable held before tenants could be resolved at
 * all, so it still parses — it just resolves to no slug and the caller falls
 * back to whatever the embed asked for.
 *
 * Why a hostname and not an attribute: on a host that appears here the answer
 * cannot be edited by whoever is looking at the page. `data-tenant` lives in
 * the storefront's HTML and a shopper can change it in devtools; a request's
 * Host header is the deployment's own routing. So where both are available the
 * host wins, and a merchant who wants the guarantee points a subdomain at us.
 *
 * Kept free of imports on purpose: `src/proxy.ts` is middleware and runs on the
 * Edge runtime, where Prisma and most of `node:` are unavailable. This is
 * string handling and nothing else.
 */

export type AdvisorHostEntry = {
  host: string;
  /** The merchant this host serves, or null when the entry only names a host. */
  tenantSlug: string | null;
};

/** Lowercased, port removed — "ADVISOR.Shop.com:443" and "advisor.shop.com" are one host. */
export function normaliseHost(host: string | null | undefined): string {
  return (host ?? "").toLowerCase().split(":")[0].trim();
}

/**
 * Read at call time rather than at module load: the Edge runtime and the test
 * suite both set this variable after the module graph has been evaluated.
 */
export function advisorHostEntries(): AdvisorHostEntry[] {
  return (process.env.ADVISOR_HOSTS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separator = entry.indexOf("=");
      const host = normaliseHost(separator === -1 ? entry : entry.slice(0, separator));
      const slug = separator === -1 ? "" : entry.slice(separator + 1).trim().toLowerCase();
      return { host, tenantSlug: slug || null };
    })
    .filter((entry) => entry.host.length > 0);
}

/**
 * A hostname that exists to serve one merchant's advisor and nothing else.
 *
 * With `ADVISOR_HOSTS` set the list is exhaustive. Without it, anything under
 * `advisor.` is treated as one — which keeps a merchant's subdomain guarded by
 * default rather than serving them our marketing site and admin login because
 * an environment variable was forgotten.
 */
export function isAdvisorHost(host: string | null | undefined): boolean {
  const name = normaliseHost(host);
  if (!name) return false;
  const configured = advisorHostEntries();
  return configured.length ? configured.some((entry) => entry.host === name) : name.startsWith("advisor.");
}

/**
 * The merchant pinned to this hostname, or null if none is.
 *
 * Null is not a failure — it is the ordinary answer for `idermaguru.com`, where
 * one deployment serves every merchant's bubble and the embed has to say which
 * one it is.
 */
export function tenantSlugForHost(host: string | null | undefined): string | null {
  const name = normaliseHost(host);
  if (!name) return null;
  return advisorHostEntries().find((entry) => entry.host === name)?.tenantSlug ?? null;
}
