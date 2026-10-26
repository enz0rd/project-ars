import { FileJson, FolderOpen, ImageDown, Keyboard, Moon, Settings, Share2, Sparkles, Sun } from "lucide-react";
import { exportPng, exportSvg } from "../actions.ts";
import { download } from "../export.ts";
import { useSettings } from "../settings.ts";
import { useEditor } from "../store.ts";
import { useUi } from "../ui.ts";
import { MenuButton } from "./Menu.tsx";

export function TopBar() {
  const docName = useEditor((s) => s.docName);
  const setDocName = useEditor((s) => s.setDocName);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);
  const openSettings = useSettings((s) => s.setOpen);
  const live = useSettings((s) => s.live);
  const hasSelection = useEditor((s) => s.selection.length > 0);

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="logo" title="Figma Claude">
          <Sparkles size={16} />
        </div>
        <MenuButton
          className="btn ghost"
          title="Arquivo"
          items={[
            { label: "Abrir JSON…", icon: <FolderOpen size={14} />, onSelect: openJson },
            { label: "Salvar como JSON", icon: <FileJson size={14} />, onSelect: saveJson },
          ]}
        >
          Arquivo
        </MenuButton>
        <span className="crumb-sep">/</span>
        <input
          className="doc-name"
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-label="Nome do documento"
        />
      </div>

      <div className="topbar-right">
        <span
          className={`live-pill ${live.target ? "on" : ""}`}
          title={
            !live.connected
              ? "Desconectado do servidor"
              : live.target
                ? "O Claude Code (MCP) lê e edita esta aba"
                : "Outra aba está ativa para o MCP — edite algo aqui para usar esta"
          }
        >
          <span className="dot" />
          {!live.connected ? "Offline" : live.target ? "MCP nesta aba" : "MCP em outra aba"}
        </span>
        <button className="icon-btn" title="Atalhos (?)" onClick={() => setShortcutsOpen(true)}>
          <Keyboard size={16} />
        </button>
        <button
          className="icon-btn"
          title={theme === "dark" ? "Tema claro" : "Tema escuro"}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="icon-btn" title="Configurações" onClick={() => openSettings(true)}>
          <Settings size={16} />
        </button>
        <MenuButton
          className="btn primary"
          align="right"
          items={[
            { label: `PNG 1x ${hasSelection ? "(seleção)" : "(tudo)"}`, icon: <ImageDown size={14} />, onSelect: () => exportPng(1) },
            { label: `PNG 2x ${hasSelection ? "(seleção)" : "(tudo)"}`, icon: <ImageDown size={14} />, onSelect: () => exportPng(2) },
            { label: `SVG ${hasSelection ? "(seleção)" : "(tudo)"}`, icon: <ImageDown size={14} />, onSelect: exportSvg },
            { separator: true },
            { label: "Documento JSON", icon: <FileJson size={14} />, onSelect: saveJson },
          ]}
        >
          <Share2 size={14} /> Exportar
        </MenuButton>
      </div>
    </header>
  );
}

function saveJson() {
  const { docName, nodes } = useEditor.getState();
  download(new Blob([JSON.stringify({ name: docName, nodes }, null, 2)], { type: "application/json" }), `${docName || "design"}.json`);
}

function openJson() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const doc = JSON.parse(await file.text());
      if (!Array.isArray(doc.nodes)) throw new Error("missing nodes");
      useEditor.getState().replaceNodes(doc.nodes);
      if (doc.name) useEditor.getState().setDocName(doc.name);
      useUi.getState().showToast("Documento aberto");
    } catch {
      useUi.getState().showToast("Arquivo inválido");
    }
  };
  input.click();
}
