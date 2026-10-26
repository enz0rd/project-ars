# Security

## Reporting a vulnerability

Please don't open a public issue. Use GitHub's **Report a vulnerability** (private security
advisory) on this repository, with steps to reproduce. We aim to answer within a week.

## How Project Ars protects accounts and keys

### Accounts and sessions

- Authentication is Supabase Auth (email + password, optionally GitHub OAuth) with the PKCE flow.
  Email confirmation should stay **on** (see [docs/DEPLOY.md](docs/DEPLOY.md)); password reset
  answers the same way whether or not an address has an account.
- Every API route checks the session token with the Auth server on each request
  (`server/auth.ts`), so signed-out or deleted users are refused immediately.
- Deleting an account (typed confirmation) removes its images from Storage and the user, which
  cascades to projects, keys, tokens and settings.

### Data isolation

- Every table has **row level security**. Browsers use the publishable (anon) key and only ever
  see their own rows; `supabase/tests/policies.sql` checks this for projects, profiles, images and
  the live channel.
- Tables holding secrets (`user_secrets`, `mcp_tokens`, `mcp_servers`, `rate_limits`) have **no**
  client policies: only the API, with the Supabase secret key, reaches them.
- The secret key (`sb_secret_…`) lives only in server environment variables; it can be rotated
  in the Supabase dashboard without downtime by creating a new one before deleting the old. Server queries that use it
  always filter by the authenticated user id.
- Images go to a private Storage bucket, one folder per user (enforced by storage policies), and
  are shown through short-lived signed URLs.
- Live edits from agents travel over **private** Realtime channels (`project:<id>`) that only the
  project's owner may join; browsers can't broadcast on them.

### AI provider keys (bring your own key)

- Keys are encrypted by the API with **AES-256-GCM** (`server/crypto.ts`) using
  `ARS_ENCRYPTION_KEY`, a random IV per value, and the **owner's user id as associated data** — a
  ciphertext copied into another account's row fails to decrypt.
- Keys are write-only: the UI only ever receives "configured" and the last 4 characters.
- OpenAI-compatible base URLs must be `https` and resolve to public addresses (no credentials in
  the URL, no redirects), because the server sends the user's key there. Requests are also
  DNS-validated again at connect time to block private/link-local rebinding targets.
- Key checks and settings changes are rate limited per user.

### Agents (MCP)

- Each agent uses a **personal access token** (`ars_` + 32 random bytes). Only its SHA-256 hash is
  stored; the token is shown once. Tokens can be revoked and show when they were last used.
  At most 10 active tokens per account.
- Tokens are accepted only on `/mcp`, and session tokens are not accepted there — the two kinds of
  credentials can't be swapped.
- MCP tools act only on the token owner's projects. Writes are validated
  (`shared/sanitize.ts`) and saved with a compare-and-swap on the project version.
- `import_image` downloads only from public `https` URLs, re-checking every redirect and each
  outgoing DNS resolution against private and link-local ranges (cloud metadata included), with a
  size cap and a timeout. Reading files from the server's disk is off unless
  `ARS_ALLOW_LOCAL_FILES=1` (single-user local installs).

### Limits and abuse

- 5 projects per account and 5 MB per document, enforced by a database trigger (with a per-user
  lock, so parallel requests can't exceed it).
- Per-user rate limits (Postgres-backed, so they hold across serverless instances): assistant
  requests, key tests, token creation and MCP calls.
- Request bodies are capped (4 MB), images at 10 MB, with an allow-list of image types.

### Browser hardening

- Strict Content Security Policy (scripts only from the app's origin; network only to the app and
  its Supabase project), `frame-ancestors 'none'`, HSTS, `nosniff`, a strict referrer policy and
  a restrictive permissions policy (`scripts/build-vercel.mjs`).
- Imported or stored documents are coerced into typed values before they are rendered or turned
  into SVG, so a crafted file can't inject markup.
- API responses are `Cache-Control: no-store`.

## Known limitations

- Images are stored by content hash and shared between a user's projects, so deleting a project
  doesn't delete its images (deleting the account does).
- The session lives in `localStorage` (Supabase's default for SPAs): an XSS would expose it, which
  is why the CSP and input validation above matter.
- Rotating `ARS_ENCRYPTION_KEY` isn't automated yet: the `v1:` prefix on ciphertexts is there to
  allow a future key version; until then, a new key makes saved provider keys unreadable and users
  must enter them again.
