# Deploying Project Ars (Vercel + Supabase)

The app (static files), the API and the MCP endpoint deploy together to **Vercel**; the database,
authentication, image storage and live updates are **Supabase**.

```
browser ──► Vercel: static app (dist/)
        ──► Vercel function: /api/*, /mcp  ──► Supabase Postgres / Auth / Storage (secret key)
        ──► Supabase Auth, Postgres (RLS), Storage, Realtime (anon key + user session)
agents  ──► /mcp (personal access token)  ──► Realtime broadcast ──► open editor
```

## 1. Supabase

1. Create a project at [supabase.com](https://supabase.com). Pick the region closest to your users;
   you'll put the Vercel function in the same region.
2. Apply the schema:
   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase db push          # runs supabase/migrations
   ```
   This creates the tables, row level security policies, the 5-project limit, the private
   `assets` bucket and the Realtime authorization policy.
3. **Authentication → Sign In / Providers → Email**
   - Confirm email: **on**.
   - Minimum password length: **8** (the app asks for 8; raise both together if you want more).
   - Leaked password protection: **on** (available on paid plans).
   - Optional: enable **GitHub** and set `VITE_AUTH_GITHUB=true` on Vercel.
   - Optional but recommended for public sign-ups: CAPTCHA protection (Turnstile or hCaptcha).
     The app doesn't send a CAPTCHA token yet, so turning this on requires adding the widget to
     `src/pages/AuthPage.tsx` first.
4. **Authentication → URL Configuration**
   - Site URL: `https://<your-domain>`
   - Redirect URLs: `https://<your-domain>/` and `https://<your-domain>/reset`
     (add `http://localhost:5173/**` only on a development project).
5. **Authentication → Emails**: set up a custom SMTP provider for production; the built-in sender
   is heavily rate limited.
   - You can also customize **Confirm signup** in the Supabase dashboard template editor.
   - For local CLI-based development, this repository already wires
     `supabase/templates/confirmation.html` via `supabase/config.toml`.
6. **Realtime → Settings**: turn off **Allow public access**, so only private (authorized)
   channels exist.
7. **Project Settings → API Keys**: copy the project URL, the **publishable** key
   (`sb_publishable_…`) and create a **secret** key (`sb_secret_…`) for the API.

## 2. Encryption key

Generate once and store it in your password manager:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Losing it makes saved provider keys unreadable (users re-enter them); leaking it, together with a
database dump, exposes them.

## 3. Vercel

1. Import the repository in Vercel. `vercel.json` already sets the build
   (`npm run vercel-build`, which writes `.vercel/output` with the Build Output API).
2. **Settings → Environment Variables** (Production, and Preview if you use it):

   | Variable | Value | Exposed to the browser |
   | --- | --- | --- |
   | `VITE_SUPABASE_URL` | project URL | yes |
   | `VITE_SUPABASE_ANON_KEY` | publishable key (`sb_publishable_…`) | yes |
   | `SUPABASE_URL` | project URL | no |
   | `SUPABASE_SECRET_KEY` | secret key (`sb_secret_…`) | **no — never prefix with `VITE_`** |
   | `ARS_ENCRYPTION_KEY` | from step 2 | no |
   | `VITE_AUTH_GITHUB` | `true` (optional) | yes |
   | `VITE_REPO_URL` | your repository URL (optional) | yes |
   | `CLAUDE_MODEL`, `CLAUDE_EFFORT` | optional overrides | no |

   `VITE_*` values are baked in at build time: redeploy after changing them.
   The Vercel build fails fast if `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY`
   is missing (or if `VITE_SUPABASE_URL` is non-HTTPS outside localhost).
3. **Settings → Functions**: set the function region to match Supabase, and keep Fluid compute on
   (assistant replies stream for up to 300 s).
4. **Settings → Deployment Protection**: if Preview deployments use the production Supabase
   project, protect them (or give previews their own Supabase project).
5. Deploy, then add your domain.

Never set `ARS_ALLOW_LOCAL_FILES` on Vercel.

## 4. After the first deploy

- Sign up, confirm the email, create a project, and check the editor shows **Saved**.
- Settings → AI provider: save a key and press **Test**.
- Settings → Agents: create a token, connect Claude Code (snippet in the app), ask it to
  `list_projects` and to add a rectangle — the editor should show it live (**Live** badge).
- Response headers on `/` should include `Content-Security-Policy` and
  `Strict-Transport-Security`.
- Try a 6th project: the dashboard should refuse it.

## Google Search Console

1. Add `https://projectars.enz0rd.com` as a property in Google Search Console.
2. Verify ownership (recommended: DNS TXT record in the `enz0rd.com` zone).
3. Submit `https://projectars.enz0rd.com/sitemap.xml`.
4. Use URL Inspection for `https://projectars.enz0rd.com/` and click **Request indexing**.

This repository already includes:
- canonical, robots and social meta tags in `index.html`;
- `public/robots.txt` with sitemap location;
- `public/sitemap.xml` containing the landing page URL.

## Changing the project limit

The real limit is in the database (`public.max_projects_per_account()` in the migration); add a new
migration that replaces that function. Update `MAX_PROJECTS` in `src/limits.ts` too — it only
drives the UI.
