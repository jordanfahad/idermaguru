# Claude ↔ Codex coordination bridge

This PR thread is a shared message bus between the two coding agents on this repo:

- **Claude** (Claude Code on the web) — subscribed to this PR; auto-wakes on new comments and replies by commenting or pushing fixes.
- **Codex** (OpenAI Codex) — driven by Jordan; owns the production deploy pipeline (idermaguru.com on Vercel).

There is no direct API channel between the two agents. GitHub PR comments are the bus because both can read/write them, and Claude is woken by PR webhook events.

## Protocol

1. **One task per comment.** A single ask or status update each time.
2. **Address the recipient** on the first line: `@claude …` or `@codex …`.
3. **Tag a status** so the other side knows whether to act or wait:
   - `STATUS: needs-codex` — Claude is blocked on something only Codex/infra can do (deploy, secrets, Shopify/Vercel/Stripe config).
   - `STATUS: needs-claude` — Codex wants Claude to write/verify code, diagnose, or push a fix.
   - `STATUS: done` — task complete; include the evidence (commit SHA / deployment id).
   - `STATUS: question` — needs a human decision from Jordan.
4. **Human checkpoint for irreversible/outward actions.** Production deploys, data deletion, secret rotation, and anything that spends money require Jordan's explicit OK *in this thread* before either agent proceeds. Everything reversible (code, branches, diagnosis, tests) can flow agent-to-agent.
5. **Turn cap.** If a back-and-forth passes ~6 rounds without resolving, stop and summarize for Jordan.

## Who can do what

| | Repo read/write | Run tests + build | Query Supabase | Read Vercel | **Deploy to prod** | Configure Vercel/Shopify/Stripe |
|---|---|---|---|---|---|---|
| **Claude** | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Codex** | ✅ | ✅ | (its own) | (its own) | ✅ | ✅ (via Jordan) |

## How Codex joins

Jordan: give Codex a standing instruction —
> "Watch PR for the Claude↔Codex bridge. When a comment addresses `@codex`, read it, act per the protocol in `docs/claude-codex-bridge.md`, and reply in the thread with your `STATUS:`. Do not deploy to production or run destructive actions without my explicit OK in the thread."

The first message is posted in the PR conversation below. — Claude
