// Packages the app for Vercel with the Build Output API (v3):
//   .vercel/output/static            the Vite build (dist/)
//   .vercel/output/functions/api.func the Express API + MCP endpoint, bundled with esbuild
//   .vercel/output/config.json       routing and security headers
// Run after `vite build` (see the "vercel-build" script).
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile } from "node:fs/promises";

const out = ".vercel/output";
await rm(out, { recursive: true, force: true });
await mkdir(`${out}/functions/api.func`, { recursive: true });
await cp("dist", `${out}/static`, { recursive: true });

await build({
  entryPoints: ["server/vercel.ts"],
  outfile: `${out}/functions/api.func/index.mjs`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  minify: true,
  sourcemap: "linked",
  // Some dependencies are CommonJS and call require().
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "warning",
});

await writeFile(
  `${out}/functions/api.func/.vc-config.json`,
  JSON.stringify({
    runtime: "nodejs22.x",
    handler: "index.mjs",
    launcherType: "Nodejs",
    shouldAddHelpers: false,
    supportsResponseStreaming: true,
    // Assistant runs stream for a while; MCP calls are short.
    maxDuration: 300,
  }),
);

// The browser may only talk to this origin and the project's Supabase.
const supabase = new URL(process.env.VITE_SUPABASE_URL ?? "https://invalid.supabase.co");
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  `img-src 'self' data: blob: ${supabase.origin}`,
  `connect-src 'self' ${supabase.origin} wss://${supabase.host}`,
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = {
  "Content-Security-Policy": csp,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "Cross-Origin-Opener-Policy": "same-origin",
};

await writeFile(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: "/(.*)", headers: securityHeaders, continue: true },
        { src: "/assets/(.*)", headers: { "Cache-Control": "public, max-age=31536000, immutable" }, continue: true },
        { src: "/api/(.*)", dest: "/api" },
        { src: "/mcp", dest: "/api" },
        { handle: "filesystem" },
        // Client-side routes (/login, /p/<id>…) all serve the app.
        { src: "/(.*)", dest: "/index.html" },
      ],
    },
    null,
    2,
  ),
);
console.log("Vercel output ready in .vercel/output");
