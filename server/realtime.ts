import type { LiveEvent } from "../shared/types.ts";
import { env } from "./env.ts";

/** Above this, an ops message is replaced by a "reload" hint (Realtime caps payload size). */
const MAX_PAYLOAD = 200_000;

/**
 * Sends an event to the editors that have the project open, over the private
 * Realtime channel "project:<id>" (only the owner may join it; see the migration).
 */
export async function broadcast(projectId: string, event: LiveEvent) {
  let payload: LiveEvent = event;
  if (event.type === "ops" && JSON.stringify(event).length > MAX_PAYLOAD) payload = { type: "reload", version: event.version };
  const res = await fetch(`${env.supabaseUrl}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: env.serviceRoleKey,
      Authorization: `Bearer ${env.serviceRoleKey}`,
    },
    body: JSON.stringify({ messages: [{ topic: `project:${projectId}`, event: "live", payload, private: true }] }),
  });
  if (!res.ok) console.error("realtime broadcast failed", res.status, await res.text().catch(() => ""));
}
