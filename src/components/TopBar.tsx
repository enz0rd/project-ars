import { Cloud, CloudOff, FileJson, Keyboard, LoaderCircle, Moon, Radio, Settings, Shapes, Share2, Sun, ImageDown } from "lucide-react";
import { exportFigma, exportPng, exportSvg } from "../actions.ts";
import { download } from "../export.ts";
import { useT } from "../i18n/index.ts";
import { linkProps } from "../router.ts";
import { useSettings } from "../settings.ts";
import { useEditor } from "../store.ts";
import { useSync } from "../sync.ts";
import { useUi } from "../ui.ts";
import { ArsMark } from "./Brand.tsx";
import { MenuButton } from "./Menu.tsx";

export function TopBar() {
  const t = useT();
  const docName = useEditor((s) => s.docName);
  const setDocName = useEditor((s) => s.setDocName);
  const hasSelection = useEditor((s) => s.selection.length > 0);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const setShortcutsOpen = useUi((s) => s.setShortcutsOpen);
  const openSettings = useSettings((s) => s.setOpen);
  const status = useSync((s) => s.status);
  const live = useSync((s) => s.live);
  const scope = hasSelection ? t("export.selection") : t("export.all");

  return (
    <header className="topbar">
      <div className="topbar-left">
        <a className="home-link" title={t("nav.projects")} {...linkProps("/")}>
          <ArsMark size={26} />
        </a>
        <a className="crumb" {...linkProps("/")}>
          {t("nav.projects")}
        </a>
        <span className="crumb-sep">/</span>
        <input
          className="doc-name"
          value={docName}
          onChange={(e) => setDocName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          aria-label={t("editor.projectName")}
          maxLength={120}
        />
        <SaveStatus status={status} />
      </div>

      <div className="topbar-right">
        <span className={`live-pill ${live ? "on" : ""}`} title={live ? t("editor.liveOn") : t("editor.liveOff")}>
          <Radio size={12} />
          {live ? t("editor.live") : t("editor.offline")}
        </span>
        <button className="icon-btn" title={t("editor.shortcuts")} onClick={() => setShortcutsOpen(true)}>
          <Keyboard size={16} />
        </button>
        <button
          className="icon-btn"
          title={theme === "dark" ? t("editor.lightTheme") : t("editor.darkTheme")}
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="icon-btn" title={t("settings.title")} onClick={() => openSettings(true)}>
          <Settings size={16} />
        </button>
        <MenuButton
          className="btn primary"
          align="right"
          items={[
            { label: `PNG 1x (${scope})`, icon: <ImageDown size={14} />, onSelect: () => exportPng(1) },
            { label: `PNG 2x (${scope})`, icon: <ImageDown size={14} />, onSelect: () => exportPng(2) },
            { label: `SVG (${scope})`, icon: <ImageDown size={14} />, onSelect: exportSvg },
            { label: `${t("export.figma")} (${scope})`, icon: <Shapes size={14} />, onSelect: exportFigma },
            { separator: true },
            { label: t("export.json"), icon: <FileJson size={14} />, onSelect: saveJson },
          ]}
        >
          <Share2 size={14} /> {t("export.button")}
        </MenuButton>
      </div>
    </header>
  );
}

function SaveStatus({ status }: { status: string }) {
  const t = useT();
  if (status === "saving" || status === "dirty")
    return (
      <span className="save-status">
        <LoaderCircle size={13} className="spin" /> {t("sync.saving")}
      </span>
    );
  if (status === "error")
    return (
      <span className="save-status err">
        <CloudOff size={13} /> {t("sync.notSaved")}
      </span>
    );
  return (
    <span className="save-status">
      <Cloud size={13} /> {t("sync.saved")}
    </span>
  );
}

function saveJson() {
  const { docName, nodes } = useEditor.getState();
  download(
    new Blob([JSON.stringify({ format: "ars", version: 1, name: docName, nodes }, null, 2)], { type: "application/json" }),
    `${docName || "design"}.ars.json`,
  );
}
