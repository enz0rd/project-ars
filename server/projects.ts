import { sanitizeNodes } from "../shared/sanitize.ts";
import { normalize } from "../shared/tree.ts";
import { applyOp, type DesignNode, type DocOp } from "../shared/types.ts";
import type { DocTarget } from "./docTools.ts";
import { broadcast } from "./realtime.ts";
import { UserError } from "./errors.ts";
import { db, must, rows } from "./supabase.ts";

/** Server-side access to a user's projects, for MCP tools. Every query is scoped to the owner. */

export async function listProjects(userId: string) {
  const [projects, profile] = await Promise.all([
    db().from("projects").select("id, name, updated_at").eq("owner_id", userId).order("updated_at", { ascending: false }),
    db().from("profiles").select("active_project_id").eq("id", userId).maybeSingle(),
  ]);
  const active = profile.data?.active_project_id;
  return rows(projects).map((p) => ({ ...p, active: p.id === active }));
}

/** The given project, or the one the user had open most recently. */
export async function resolveProject(userId: string, projectId?: string): Promise<string> {
  if (projectId) return projectId;
  const profile = must(await db().from("profiles").select("active_project_id").eq("id", userId).maybeSingle());
  if (profile?.active_project_id) return profile.active_project_id;
  const latest = rows(
    await db().from("projects").select("id").eq("owner_id", userId).order("updated_at", { ascending: false }).limit(1),
  );
  if (!latest.length) throw new UserError("You have no projects yet. Create one in the dashboard first.");
  return latest[0].id;
}

export async function setActiveProject(userId: string, projectId: string) {
  await loadProject(userId, projectId);
  must(await db().from("profiles").update({ active_project_id: projectId }).eq("id", userId));
}

export async function loadProject(userId: string, projectId: string) {
  const row = must(
    await db()
      .from("projects")
      .select("id, name, document, version")
      .eq("id", projectId)
      .eq("owner_id", userId)
      .maybeSingle(),
  );
  if (!row) throw new UserError(`Project ${projectId} not found`);
  return row as { id: string; name: string; document: { nodes: DesignNode[] }; version: number };
}

export async function activeSelection(userId: string): Promise<string[]> {
  const row = must(await db().from("profiles").select("active_selection").eq("id", userId).maybeSingle());
  return Array.isArray(row?.active_selection) ? row.active_selection : [];
}

/**
 * Runs `fn` against a project's document, then saves the ops it made and streams
 * them to the open editors. Saving compares-and-swaps on the version; if the
 * editor saved in between, the ops are replayed on the newer document.
 */
export async function withProject<T>(
  userId: string,
  projectId: string | undefined,
  fn: (doc: DocTarget, project: { id: string; name: string }) => T | Promise<T>,
): Promise<T> {
  const id = await resolveProject(userId, projectId);
  const project = await loadProject(userId, id);
  let nodes = sanitizeNodes(project.document.nodes);
  const ops: DocOp[] = [];
  const doc: DocTarget = {
    nodes: () => nodes,
    apply: (batch) => {
      ops.push(...batch);
      nodes = normalize(batch.reduce(applyOp, nodes));
    },
  };
  const result = await fn(doc, project);
  if (ops.length) await commit(userId, project, ops);
  return result;
}

async function commit(userId: string, start: { id: string; version: number; document: { nodes: DesignNode[] } }, ops: DocOp[]) {
  let current = start;
  for (let attempt = 0; attempt < 4; attempt++) {
    // Agents write here: validate like any untrusted input.
    const nodes = normalize(sanitizeNodes(ops.reduce(applyOp, sanitizeNodes(current.document.nodes))));
    const { data, error } = await db()
      .from("projects")
      .update({ document: { ...current.document, nodes }, version: current.version + 1 })
      .eq("id", current.id)
      .eq("owner_id", userId)
      .eq("version", current.version)
      .select("version")
      .maybeSingle();
    if (error) throw new UserError(error.message);
    if (data) {
      await broadcast(current.id, { type: "ops", version: data.version, ops });
      return;
    }
    current = await loadProject(userId, current.id);
  }
  throw new UserError("The project is being edited too quickly; try again.");
}
