# Project Ars

**Design without boundaries.**

Project Ars is an open-source vector design editor with a built-in AI assistant. Draw artboards,
shapes, text and images; let the assistant build or refine layouts on the canvas; and connect the
agents you already use — Claude Code, Cursor, Codex, Gemini CLI, any MCP client — so they can read
and edit your designs live.

- **Editor**: artboards, rectangles, ellipses, text and images; groups and nesting; smart guides and
  snapping; align/distribute; undo/redo; PNG, SVG and project-file export; light and dark themes.
- **Assistant**: bring your own key — Claude (Anthropic) or any OpenAI-compatible API (OpenAI,
  OpenRouter, Gemini, Groq, Mistral…). Edits stream onto the canvas and undo as one step.
- **Agents over MCP**: a Streamable HTTP endpoint at `/mcp`, authenticated with personal access
  tokens. Edits made by agents are saved and appear live in the open editor.
- **Accounts**: email/password sign-up (optionally GitHub), a dashboard of your projects, and up to
  **5 projects per account**.
- **Languages**: English, Português (Brasil) and Español.
- **Figma interop**: export a `.figma.json` and rebuild it as native layers with the plugin in
  [`figma-plugin/`](figma-plugin).

## Stack

| Piece | Where |
| --- | --- |
| React + Vite single-page app | `src/` |
| API (Express) and MCP endpoint, one Vercel function | `server/` |
| Postgres, Auth, Storage and Realtime | Supabase (`supabase/migrations/`) |
| Document model shared by both sides | `shared/` |

```
src/pages/         sign-in, dashboard, editor
src/sync.ts        loads/saves the open project, applies live edits from agents (Realtime)
src/assets.ts      images in Supabase Storage (signed URLs)
src/i18n/          translations (en is the reference; TypeScript enforces the same keys everywhere)
server/app.ts      routes: /api/me/* settings, /api/ai assistant stream, /mcp
server/auth.ts     Supabase session check, MCP access tokens, rate limiting
server/crypto.ts   AES-256-GCM for stored keys, token hashing
server/ai.ts       the assistant (Anthropic tool runner or OpenAI-compatible tool loop)
server/mcp.ts      MCP tools, scoped to the token owner's projects
shared/tree.ts     layer hierarchy (groups, artboards, auto-organize)
shared/sanitize.ts validation of untrusted documents
scripts/build-vercel.mjs  Vercel Build Output (static app + function + headers)
```

## Run it locally

Requirements: Node 22+, Docker (or Podman) for a local Supabase.

```bash
npm install
npx supabase init            # once; keeps supabase/migrations
npx supabase start           # prints the local URL and keys
npx supabase db reset        # applies the migrations
cp .env.example .env         # fill in the URL, publishable key, secret key and ARS_ENCRYPTION_KEY
npm run dev                  # app on http://localhost:5173, API on :8787
```

Local Supabase sends auth emails to Inbucket (the URL is printed by `supabase start`).

Tests:

```bash
npm test          # crypto, SSRF guard, document validation, layer model
npm run test:db   # migrations + row level security + project limit, on a throwaway Postgres
```

## Deploy

Vercel (app + API) and Supabase (database, auth, storage, realtime): see
[docs/DEPLOY.md](docs/DEPLOY.md).

## Connect an agent

In the app, open **Settings → Agents (MCP)**, create a token and copy the snippet for your tool.
For Claude Code:

```bash
claude mcp add --transport http ars https://YOUR-DEPLOYMENT/mcp --header "Authorization: Bearer ars_…"
```

Tools: `list_projects`, `open_project`, `get_document`, `create_nodes`, `update_nodes`,
`delete_nodes`, `reorder_node`, `group_nodes`, `ungroup_nodes`, `organize_layers`, `import_image`,
`select_nodes`. They act on the project you have open (or `project_id`).

## Security

Keys, tokens, row level security and the threat model are described in [SECURITY.md](SECURITY.md).
Please report vulnerabilities privately, as explained there.

## License

[MIT](LICENSE)
