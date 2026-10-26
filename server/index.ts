import "dotenv/config";
import { app } from "./app.ts";

// Local development. On Vercel the same app runs as a function (scripts/build-vercel.mjs).
const port = Number(process.env.PORT ?? 8787);
app.listen(port, "127.0.0.1", () => console.log(`API on http://127.0.0.1:${port}`));
