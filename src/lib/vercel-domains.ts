/**
 * The bit of Vercel's API that lets a merchant connect a domain without ever
 * seeing Vercel.
 *
 * A merchant types "advisor.theirshop.com" into our console; we register it
 * against our project with OUR token, and hand back the one DNS record they
 * have to add themselves. That last step cannot be automated by anyone —
 * only the domain's owner can write a record at their registrar, which is why
 * Shopify, Webflow and every platform-on-Vercel has the same step. What we can
 * remove is the Vercel account, the project settings page, and the guessing.
 *
 * Every function returns a result object rather than throwing. A missing token
 * is an ordinary state of the world here — the feature is unconfigured until
 * someone sets one — and the console needs to say so rather than show a stack
 * trace.
 */

const API = "https://api.vercel.com";

export type VercelConfig = { token: string; projectId: string; teamId?: string };

export type VercelResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unconfigured" | "conflict" | "invalid" | "error"; message: string };

/**
 * Read at call time. Returns null when the integration has not been set up,
 * which is not an error — see the module comment.
 */
export function vercelConfig(): VercelConfig | null {
  const token = process.env.VERCEL_API_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  if (!token || !projectId) return null;
  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  return { token, projectId, ...(teamId ? { teamId } : {}) };
}

function withTeam(path: string, config: VercelConfig): string {
  return config.teamId ? `${path}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(config.teamId)}` : path;
}

async function call<T>(
  path: string,
  init: RequestInit & { config: VercelConfig },
): Promise<VercelResult<T>> {
  const { config, ...request } = init;
  try {
    const response = await fetch(`${API}${withTeam(path, config)}`, {
      ...request,
      headers: {
        authorization: `Bearer ${config.token}`,
        "content-type": "application/json",
        ...(request.headers ?? {}),
      },
      // Domain state is the thing being asked about; a cached answer is a wrong
      // answer the moment a merchant adds their record.
      cache: "no-store",
    });

    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: string; message?: string };
    } & T;

    if (response.ok) return { ok: true, data: body };

    const code = body.error?.code ?? "";
    const message = body.error?.message ?? `Vercel returned ${response.status}.`;
    // "already exists" is the ordinary result of connecting a domain twice, and
    // of connecting one that another project already holds. The console says
    // different things about those, so it must not see both as "error".
    if (response.status === 409 || code === "domain_already_in_use") {
      return { ok: false, reason: "conflict", message };
    }
    if (response.status === 400) return { ok: false, reason: "invalid", message };
    return { ok: false, reason: "error", message };
  } catch (cause) {
    return { ok: false, reason: "error", message: cause instanceof Error ? cause.message : "Vercel unreachable." };
  }
}

export type AddedDomain = { name: string; verified: boolean };

/** Register a hostname against our project so Vercel will serve and certify it. */
export async function addProjectDomain(host: string): Promise<VercelResult<AddedDomain>> {
  const config = vercelConfig();
  if (!config) return { ok: false, reason: "unconfigured", message: "Vercel domain API is not configured." };

  return call<AddedDomain>(`/v10/projects/${encodeURIComponent(config.projectId)}/domains`, {
    method: "POST",
    body: JSON.stringify({ name: host }),
    config,
  });
}

export async function removeProjectDomain(host: string): Promise<VercelResult<unknown>> {
  const config = vercelConfig();
  if (!config) return { ok: false, reason: "unconfigured", message: "Vercel domain API is not configured." };

  return call(`/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(host)}`, {
    method: "DELETE",
    config,
  });
}

export type DomainConfig = { misconfigured: boolean };

/**
 * Whether the merchant's DNS actually points here yet.
 *
 * `misconfigured: true` is the normal state between connecting a domain and the
 * merchant adding their record, so it is a step in the flow rather than a
 * failure to report.
 */
export async function getDomainConfig(host: string): Promise<VercelResult<DomainConfig>> {
  const config = vercelConfig();
  if (!config) return { ok: false, reason: "unconfigured", message: "Vercel domain API is not configured." };

  return call<DomainConfig>(`/v6/domains/${encodeURIComponent(host)}/config`, { method: "GET", config });
}

/**
 * The record to show the merchant.
 *
 * A subdomain gets a CNAME; an apex domain cannot have one (RFC 1034) and gets
 * the A record instead. Telling a merchant to CNAME their apex is the single
 * most common way this flow wastes an afternoon — some registrars accept it and
 * then break the domain's mail.
 */
export type DnsInstruction = { type: "CNAME" | "A"; name: string; value: string };

export function dnsInstructionFor(host: string): DnsInstruction {
  const labels = host.split(".").filter(Boolean);
  // Treat exactly two labels as an apex ("cicabelle.com"). This is wrong for
  // multi-part suffixes like "co.uk", where the apex has three; those merchants
  // get told to add a CNAME on what is really their apex. Worth a public-suffix
  // list if that ever comes up — not worth the dependency before it does.
  const isApex = labels.length <= 2;
  return isApex
    ? { type: "A", name: "@", value: "76.76.21.21" }
    : { type: "CNAME", name: labels[0], value: "cname.vercel-dns.com" };
}
