import { normalize } from "../shared/tree.ts";
import { sanitizeNodes } from "../shared/sanitize.ts";
import type { DesignNode } from "../shared/types.ts";
import { dataUrlToBlob, uploadImage } from "./assets.ts";
import { supabase } from "./lib/supabase.ts";

/** Dashboard-side project operations. Row level security scopes all of them to the user. */

export interface ProjectRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  document: { nodes: DesignNode[] };
}

/** Postgres error from the project rules trigger → a code the UI translates. */
function fail(error: { message: string }): never {
  const code = /project_limit_reached|document_too_large|invalid_document/.exec(error.message)?.[0];
  throw new Error(code ?? error.message);
}

export async function listProjects(): Promise<ProjectRow[]> {
  // At most a handful of projects per account, so documents come along for previews.
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, created_at, updated_at, document")
    .order("updated_at", { ascending: false });
  if (error) fail(error);
  return (data ?? []).map((p) => ({ ...p, document: { nodes: sanitizeNodes(p.document?.nodes) } }));
}

export async function createProject(name: string, nodes: DesignNode[] = []): Promise<string> {
  const { data, error } = await supabase
    .from("projects")
    .insert({ name: name.trim().slice(0, 120) || "Untitled", document: { nodes } })
    .select("id")
    .single();
  if (error) fail(error);
  return data.id;
}

export async function renameProject(id: string, name: string) {
  const { error } = await supabase.from("projects").update({ name: name.trim().slice(0, 120) || "Untitled" }).eq("id", id);
  if (error) fail(error);
}

export async function deleteProject(id: string) {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) fail(error);
}

export async function duplicateProject(project: ProjectRow, suffix: string) {
  return createProject(`${project.name} ${suffix}`, project.document.nodes);
}

/** Creates a project from a JSON file (Project Ars export or a plain { nodes }). */
export async function importProjectFile(file: File): Promise<string> {
  let doc: { name?: unknown; nodes?: unknown };
  try {
    doc = JSON.parse(await file.text());
  } catch {
    throw new Error("invalid_file");
  }
  const raw = Array.isArray(doc) ? doc : doc?.nodes;
  if (!Array.isArray(raw)) throw new Error("invalid_file");
  // Upload embedded images first, then validate everything.
  const uploads = new Map<string, Promise<string>>();
  for (const n of raw as { src?: unknown }[]) {
    if (typeof n?.src === "string" && n.src.startsWith("data:image/") && !uploads.has(n.src)) {
      uploads.set(n.src, uploadImage(dataUrlToBlob(n.src)).then((u) => u.src));
    }
  }
  const resolved = new Map<string, string>();
  for (const [data, p] of uploads) resolved.set(data, await p);
  const nodes = normalize(
    sanitizeNodes((raw as { src?: string }[]).map((n) => (n?.src && resolved.has(n.src) ? { ...n, src: resolved.get(n.src) } : n))),
  );
  const name = typeof doc.name === "string" ? doc.name : file.name.replace(/(\.ars)?\.json$/i, "");
  return createProject(name, nodes);
}

/** The document the old single-user version kept in this browser, if any. */
const LEGACY_KEY = "projectars:doc";

export function legacyDraft(): { name: string; nodes: unknown[] } | null {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    const doc = raw ? JSON.parse(raw) : null;
    return Array.isArray(doc?.nodes) && doc.nodes.length ? { name: doc.docName || "Untitled", nodes: doc.nodes } : null;
  } catch {
    return null;
  }
}

export async function importLegacyDraft(): Promise<string | null> {
  const draft = legacyDraft();
  if (!draft) return null;
  const id = await createProject(draft.name, normalize(sanitizeNodes(draft.nodes)));
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // storage unavailable
  }
  return id;
}

export function dismissLegacyDraft() {
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // storage unavailable
  }
}
