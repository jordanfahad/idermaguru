/**
 * Runtime feature flags.
 *
 * Public consultation snapshots publish shopper-entered concern text as
 * world-readable, SEO-indexed pages at /recommendations/<slug>. That is a
 * privacy exposure (PDPL/GDPR) when the concern text is not consented and
 * PII-scrubbed, so the feature is DISABLED by default. Re-enable only once
 * snapshots are consent-gated and scrubbed.
 */
export const SNAPSHOT_SLUG_PREFIX = "live-consultation-result-";

export function publicSnapshotsEnabled(): boolean {
  return process.env.PUBLIC_SNAPSHOTS_ENABLED === "true";
}

export function isSnapshotSlug(slug: string): boolean {
  return slug.startsWith(SNAPSHOT_SLUG_PREFIX);
}
