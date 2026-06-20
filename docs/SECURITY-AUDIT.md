# Tenant Isolation — Security Audit & Hardening

Scope: multi-tenant data isolation across the API surface (`src/app/api/**`,
`src/services/**`, `src/lib/**`). Question: *can one tenant read or write another
tenant's data?*

## Finding (before this work)

Isolation was **not** enforced by Row-Level Security. The RLS policies in
`supabase/migrations/002_tenant_rls_and_pgvector.sql` are correct but **dormant**:

- Prisma (`getPrisma`) connects as the table **owner**, which bypasses RLS
  (002 enables but does not `FORCE` it).
- The Supabase path (`getSupabaseAdmin`) uses the **service-role key**, which
  also bypasses RLS.
- `withTenantContext` — the only thing that sets the `app.current_tenant_id`
  GUC the policies key on — had **zero call sites**.

So isolation rested entirely on application code, and that layer had holes
(tenant taken from client-supplied input; several endpoints unauthenticated).

### Verified vulnerabilities

| Sev | Endpoint | Issue |
| --- | --- | --- |
| Critical | `GET /api/session/export` | Full session PII (consents, IP hashes, intake, images) returned for any `sessionId`, no auth/tenant check. |
| Critical | `/api/admin/*` (data plane) | No auth — enumerate tenants, read/modify any tenant's catalog, sessions, analytics. |
| Critical | `POST /api/admin/auth/login` | `merchant` role minted a valid session with **no password check**. |
| High | `POST /api/events/*`, `/api/upload-image` | Wrote analytics under a **client-supplied `tenantId`** — forge events/revenue into any tenant. |
| High | `POST /api/session/delete`, `DELETE /api/upload-image/[id]` | Mutated rows by id with no ownership check. |
| Med | `src/lib/admin-auth.ts` | Session secret fell back to a public constant if env unset — forgeable cookies. |

## Layer A — application-level fixes (shipped in this change)

- **Admin plane:** `requireSuperAdmin()` (`src/lib/admin-guard.ts`) gates every
  `/api/admin/*` data route. Login is super_admin-only (the passwordless
  `merchant` branch is removed). The HMAC secret now fails closed in production
  (`src/lib/hmac.ts`) instead of using a constant.
- **Shopper PII:** `chat/start` issues an HMAC **session token**
  (`src/lib/session-token.ts`); `session/export`, `session/delete`, and
  `upload-image/[id]` DELETE require it (`x-session-token` header or `?token=`).
- **Event/conversion forgery:** tenant is derived from the session server-side
  (`src/services/tenant-scope.ts`), not from the request body. Events require a
  valid `sessionId`; conversions fall back to the referenced click event.
- **Recommendations/intake:** reject when a supplied `sessionId` does not belong
  to the named tenant.

Tests: `tests/session-token.test.ts`, `tests/tenant-isolation.test.ts`,
`tests/admin-session.test.ts`.

## Layer B — RLS activation (shipped; activation is the remaining manual step)

Defense in depth so a future missed `WHERE tenantId` cannot leak across tenants.

- `supabase/migrations/003_app_role_and_rls_activation.sql` creates the non-owner
  `dermaguru_app` role (subject to the 002 policies).
- `getTenantPrisma()` (`src/server/db.ts`) connects as that role when
  `TENANT_DATABASE_URL` is set, else falls back to the owner client.
- The query funnel is in place: tenant-**scoped** reads/writes go through
  `withTenant(tenantId, …)` (`src/lib/tenant-context.ts`) — catalog products,
  analytics/events, sessions, recommendations, intake, image uploads, and
  conversions. While `TENANT_DATABASE_URL` is unset this runs directly on the
  owner (no behaviour change); once set, each call runs in a transaction that
  sets `app.current_tenant_id`, so RLS scopes it.
- Tenant **resolution** stays on the owner client (`getTenantBySlug`,
  `getSessionTenantId`, the conversion click lookup, the image-id lookup), and
  the `/api/admin/*` super-admin plane stays on the owner by design — a role
  subject to RLS cannot see across tenants to resolve an id it does not yet know.

Remaining manual step (out of band): activate the role — `alter role
dermaguru_app with login password …`, set `TENANT_DATABASE_URL`, then verify
cross-tenant denial against a live database. Steps are in the migration header.

## Residual / follow-ups

- Per-merchant `MerchantUser` accounts bound to a tenant (admin is super_admin
  only until then).
- Activate the `dermaguru_app` role (password + `TENANT_DATABASE_URL`) and verify
  cross-tenant denial against a live database.
- `POST /api/billing/portal` trusts a client `customerId` (outside the Postgres
  isolation scope, but should bind to the authenticated merchant).
