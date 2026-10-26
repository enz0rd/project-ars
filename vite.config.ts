import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // Local API (npm run dev:api). In production both live on the same Vercel deployment.
    proxy: { "/api": "http://127.0.0.1:8787", "/mcp": "http://127.0.0.1:8787" },
  },
});
