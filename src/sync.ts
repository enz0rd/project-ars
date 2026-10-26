import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";
import { normalize } from "../shared/tree.ts";
import { sanitizeNodes } from "../shared/sanitize.ts";
import type { LiveEvent } from "../shared/types.ts";
import { useAuth } from "./auth.ts";
import { t } from "./i18n/index.ts";
import { supabase } from "./lib/supabase.ts";
import { useEditor } from "./store.ts";
import { useUi } from "./ui.ts";

/**
 * Binds the editor to a project row: loads it, autosaves (compare-and-swap on
 * `version`), applies live edits that MCP clients make (Realtime broadcast on the
 * private channel "project:<id>") and tells MCP which project is open.
 */
export type SaveStatus = "loading" | "saved" | "dirty" | "saving" | "error" | "missing";

interface SyncState {
  status: SaveStatus;
  /** Realtime channel joined: MCP edits will show up live. */
  live: boolean;
}

export const useSync = create<SyncState>(() => ({ status: "loading", live: false }));

const SAVE_DELAY = 800;

let current: {
  id: string;
  version: number;
  channel: RealtimeChannel;
  unsubscribe: () => void;
  saveTimer?: ReturnType<typeof setTimeout>;
  nameTimer?: ReturnType<typeof setTimeout>;
  selectionTimer?: ReturnType<typeof setTimeout>;
  /** Suppresses autosave while applying the server's own changes. */
  applyingRemote: boolean;
  saving?: Promise<void>;
} | null = null;

export async function openProject(id: string) {
  await closeProject();
  useSync.setState({ status: "loading", live: false });
  const row = await fetchProject(id);
  if (!row) return useSync.setState({ status: "missing" });

  useEditor.setState({
    projectId: id,
    docName: row.name,
    nodes: normalize(sanitizeNodes(row.document?.nodes)),
    selection: [],
    past: [],
    future: [],
    tool: "select",
  });

  const channel = supabase.channel(`project:${id}`, { config: { private: true } });
  const state = {
    id,
    version: row.version,
    channel,
    applyingRemote: false,
    unsubscribe: () => {},
  };
  current = state;

  // Private channels authorize with the user's token (see the realtime policy in the migration).
  const token = useAuth.getState().session?.access_token;
  if (token) await supabase.realtime.setAuth(token);
  channel
    .on("broadcast", { event: "live" }, ({ payload }) => onLive(payload as LiveEvent))
    .subscribe((status) => useSync.setState({ live: status === "SUBSCRIBED" }));

  const unsubStore = useEditor.subscribe((s, prev) => {
    if (!current || current.applyingRemote) return;
    if (s.nodes !== prev.nodes) scheduleSave();
    if (s.docName !== prev.docName) scheduleRename(s.docName);
    if (s.selection !== prev.selection) scheduleSelection(s.selection);
  });
  window.addEventListener("focus", markActive);
  window.addEventListener("beforeunload", warnUnsaved);
  state.unsubscribe = () => {
    unsubStore();
    window.removeEventListener("focus", markActive);
    window.removeEventListener("beforeunload", warnUnsaved);
  };

  useSync.setState({ status: "saved" });
  markActive();
}

export async function closeProject() {
  const state = current;
  if (!state) return;
  clearTimeout(state.nameTimer);
  clearTimeout(state.selectionTimer);
  if (state.saveTimer) {
    clearTimeout(state.saveTimer);
    await save();
  }
  await state.saving;
  state.unsubscribe();
  await supabase.removeChannel(state.channel);
  current = null;
  useEditor.setState({ projectId: null, nodes: [], selection: [], past: [], future: [] });
}

async function fetchProject(id: string) {
  const { data } = await supabase.from("projects").select("name, document, version").eq("id", id).maybeSingle();
  return data as { name: string; document: { nodes: unknown }; version: number } | null;
}

function scheduleSave() {
  if (!current) return;
  useSync.setState({ status: "dirty" });
  clearTimeout(current.saveTimer);
  current.saveTimer = setTimeout(() => void save(), SAVE_DELAY);
}

async function save(retry = true): Promise<void> {
  const state = current;
  if (!state) return;
  state.saveTimer = undefined;
  await state.saving;
  const run = (async () => {
    useSync.setState({ status: "saving" });
    const { nodes } = useEditor.getState();
    const { data, error } = await supabase.rpc("save_project", {
      p_id: state.id,
      p_document: { nodes },
      p_base_version: state.version,
    });
    if (error) {
      useSync.setState({ status: "error" });
      useUi.getState().showToast(t("sync.saveFailed"));
      return;
    }
    if (typeof data === "number") {
      state.version = data;
      if (!state.saveTimer) useSync.setState({ status: "saved" });
      return;
    }
    // Someone (an MCP client) saved in between. Their ops are on the way over
    // Realtime; give them a moment, then try again on top of them.
    if (retry) {
      await new Promise((r) => setTimeout(r, 1000));
      state.saving = undefined;
      return save(false);
    }
    await reload(t("sync.conflict"));
  })();
  state.saving = run;
  await run;
}

async function reload(message?: string) {
  const state = current;
  if (!state) return;
  const row = await fetchProject(state.id);
  if (!row) return useSync.setState({ status: "missing" });
  state.applyingRemote = true;
  useEditor.getState().checkpoint();
  useEditor.setState({ nodes: normalize(sanitizeNodes(row.document?.nodes)), docName: row.name });
  state.version = row.version;
  state.applyingRemote = false;
  useSync.setState({ status: "saved" });
  if (message) useUi.getState().showToast(message);
}

function onLive(event: LiveEvent) {
  const state = current;
  if (!state) return;
  if (event.type === "select") return useEditor.getState().select(event.ids);
  if (event.version <= state.version) return;
  if (event.type === "reload" || event.version !== state.version + 1) return void reload();
  // Each MCP tool call is one undo step. Local unsaved changes stay and get saved on top.
  state.applyingRemote = true;
  const editor = useEditor.getState();
  editor.checkpoint();
  editor.applyOps(event.ops);
  state.version = event.version;
  state.applyingRemote = false;
  if (useSync.getState().status === "dirty") scheduleSave();
}

function scheduleRename(name: string) {
  if (!current) return;
  clearTimeout(current.nameTimer);
  const id = current.id;
  current.nameTimer = setTimeout(() => {
    void supabase.from("projects").update({ name: name.trim().slice(0, 120) || "Untitled" }).eq("id", id);
  }, SAVE_DELAY);
}

/** Lets MCP clients see what is selected ("change this"). */
function scheduleSelection(ids: string[]) {
  if (!current) return;
  clearTimeout(current.selectionTimer);
  current.selectionTimer = setTimeout(() => {
    const uid = useAuth.getState().session?.user.id;
    if (uid) void supabase.from("profiles").update({ active_selection: ids.slice(0, 500) }).eq("id", uid);
  }, 500);
}

/** This project becomes the default target of MCP tools. */
function markActive() {
  const uid = useAuth.getState().session?.user.id;
  if (!uid || !current) return;
  void supabase
    .from("profiles")
    .update({ active_project_id: current.id, active_at: new Date().toISOString() })
    .eq("id", uid);
}

function warnUnsaved(e: BeforeUnloadEvent) {
  const status = useSync.getState().status;
  if (status === "dirty" || status === "saving") e.preventDefault();
}
