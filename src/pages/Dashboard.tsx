import { Copy, Download, Ellipsis, FileUp, FolderPlus, Pencil, Settings, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { displayUrls } from "../assets.ts";
import { ArsLogo, SLOGAN } from "../components/Brand.tsx";
import { LanguageSelect } from "../components/LanguageSelect.tsx";
import { MenuButton } from "../components/Menu.tsx";
import { SettingsModal } from "../components/SettingsModal.tsx";
import { Toast } from "../components/Toast.tsx";
import { download, toSvg } from "../export.ts";
import { errorMessage, tc, useI18n, useT } from "../i18n/index.ts";
import { MAX_PROJECTS } from "../limits.ts";
import {
  createProject,
  deleteProject,
  dismissLegacyDraft,
  duplicateProject,
  importLegacyDraft,
  importProjectFile,
  legacyDraft,
  listProjects,
  renameProject,
  type ProjectRow,
} from "../projects.ts";
import { linkProps, navigate } from "../router.ts";
import { useSettings } from "../settings.ts";
import { useUi } from "../ui.ts";

export function Dashboard() {
  const t = useT();
  const locale = useI18n((s) => s.locale);
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState(legacyDraft);
  const openSettings = useSettings((s) => s.setOpen);
  const fileRef = useRef<HTMLInputElement>(null);
  const full = (projects?.length ?? 0) >= MAX_PROJECTS;

  const load = () =>
    listProjects()
      .then(setProjects)
      .catch((err) => setError(errorMessage((err as Error).message)));

  useEffect(() => {
    void load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const message = errorMessage((err as Error).message);
      setError(message);
      useUi.getState().showToast(message);
    } finally {
      setBusy(false);
    }
  };

  const create = () => run(async () => navigate(`/p/${await createProject(t("dashboard.untitled"))}`));

  return (
    <div className="dashboard">
      <header className="dash-header">
        <ArsLogo withSlogan />
        <div className="row">
          <LanguageSelect />
          <button className="icon-btn" title={t("settings.title")} onClick={() => openSettings(true)}>
            <Settings size={16} />
          </button>
        </div>
      </header>

      <main className="dash-main">
        <section className="dash-hero">
          <div>
            <h1>{t("dashboard.title")}</h1>
            <p className="muted">{SLOGAN}</p>
          </div>
          <div className="row">
            <span className={`usage ${full ? "full" : ""}`} title={t("dashboard.limitHint", { n: MAX_PROJECTS })}>
              <span className="usage-bar">
                <i style={{ width: `${((projects?.length ?? 0) / MAX_PROJECTS) * 100}%` }} />
              </span>
              {t("dashboard.usage", { used: projects?.length ?? 0, max: MAX_PROJECTS })}
            </span>
            <button className="btn subtle" disabled={busy || full} onClick={() => fileRef.current?.click()} title={t("dashboard.importHint")}>
              <FileUp size={14} /> {t("dashboard.import")}
            </button>
            <button className="btn primary" disabled={busy || full || !projects} onClick={create}>
              <FolderPlus size={14} /> {t("dashboard.new")}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) run(async () => navigate(`/p/${await importProjectFile(file)}`));
              }}
            />
          </div>
        </section>

        {full && <div className="status warn">{t("dashboard.limitReached", { n: MAX_PROJECTS })}</div>}
        {error && <div className="status err">{error}</div>}

        {draft && (
          <div className="draft-banner">
            <Upload size={16} />
            <div>
              <strong>{t("dashboard.draftTitle")}</strong>
              <span>{t("dashboard.draftText", { name: draft.name })}</span>
            </div>
            <button
              className="btn primary sm"
              disabled={busy || full}
              onClick={() =>
                run(async () => {
                  const id = await importLegacyDraft();
                  setDraft(null);
                  if (id) navigate(`/p/${id}`);
                })
              }
            >
              {t("dashboard.draftImport")}
            </button>
            <button
              className="btn ghost sm"
              onClick={() => {
                dismissLegacyDraft();
                setDraft(null);
              }}
            >
              {t("dashboard.draftDiscard")}
            </button>
          </div>
        )}

        {!projects ? (
          <div className="project-grid">
            {[0, 1, 2].map((i) => (
              <div key={i} className="project-card skeleton" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="dash-empty">
            <h2>{t("dashboard.emptyTitle")}</h2>
            <p className="muted">{t("dashboard.emptyText")}</p>
            <button className="btn primary" disabled={busy} onClick={create}>
              <FolderPlus size={14} /> {t("dashboard.new")}
            </button>
          </div>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <article key={p.id} className="project-card">
                <a className="project-thumb" {...linkProps(`/p/${p.id}`)} aria-label={p.name}>
                  <ProjectPreview project={p} />
                </a>
                <div className="project-meta">
                  {renaming === p.id ? (
                    <input
                      autoFocus
                      className="input sm"
                      defaultValue={p.name}
                      maxLength={120}
                      onFocus={(e) => e.currentTarget.select()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        if (e.key === "Escape") setRenaming(null);
                      }}
                      onBlur={(e) => {
                        const name = e.target.value.trim();
                        setRenaming(null);
                        if (name && name !== p.name) run(async () => (await renameProject(p.id, name), await load()));
                      }}
                    />
                  ) : (
                    <a className="project-name" {...linkProps(`/p/${p.id}`)}>
                      {p.name}
                    </a>
                  )}
                  <span className="muted small">
                    {t("dashboard.edited", { when: relativeTime(p.updated_at, locale) })} · {tc("dashboard.layers", p.document.nodes.length)}
                  </span>
                </div>
                <MenuButton
                  className="icon-btn sm project-menu"
                  align="right"
                  title={t("dashboard.actions")}
                  items={[
                    { label: t("dashboard.rename"), icon: <Pencil size={14} />, onSelect: () => setRenaming(p.id) },
                    {
                      label: t("menu.duplicate"),
                      icon: <Copy size={14} />,
                      disabled: full,
                      onSelect: () => run(async () => (await duplicateProject(p, t("dashboard.copySuffix")), await load())),
                    },
                    {
                      label: t("export.json"),
                      icon: <Download size={14} />,
                      onSelect: () =>
                        download(
                          new Blob([JSON.stringify({ format: "ars", version: 1, name: p.name, nodes: p.document.nodes })], {
                            type: "application/json",
                          }),
                          `${p.name}.ars.json`,
                        ),
                    },
                    { separator: true },
                    {
                      label: t("menu.delete"),
                      icon: <Trash2 size={14} />,
                      danger: true,
                      onSelect: () =>
                        confirm(t("dashboard.deleteConfirm", { name: p.name })) && run(async () => (await deleteProject(p.id), await load())),
                    },
                  ]}
                >
                  <Ellipsis size={16} />
                </MenuButton>
              </article>
            ))}
            {!full && (
              <button className="project-card new" disabled={busy} onClick={create}>
                <FolderPlus size={22} />
                <span>{t("dashboard.new")}</span>
                <small className="muted">{tc("dashboard.remaining", MAX_PROJECTS - projects.length)}</small>
              </button>
            )}
          </div>
        )}
      </main>
      <SettingsModal />
      <Toast />
    </div>
  );
}

/** A static picture of the document, drawn from its own SVG export. */
function ProjectPreview({ project }: { project: ProjectRow }) {
  const nodes = project.document.nodes;
  const [images, setImages] = useState<Map<string, string>>(new Map());
  const srcs = useMemo(() => nodes.flatMap((n) => (n.src ? [n.src] : [])), [nodes]);

  useEffect(() => {
    if (srcs.length) void displayUrls(srcs).then(setImages);
  }, [srcs]);

  // Nodes were sanitized on load (shared/sanitize.ts), so the markup is safe to inline.
  const svg = useMemo(() => toSvg(nodes, images, nodes)?.svg, [nodes, images]);
  if (!svg) return <div className="thumb-empty" />;
  return <div className="thumb-svg" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function relativeTime(iso: string, locale: string) {
  const diff = (Date.parse(iso) - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
  ];
  for (let i = 0; i < steps.length; i++) {
    const [limit] = steps[i];
    if (Math.abs(diff) < limit) {
      const unit = i === 0 ? 1 : steps[i - 1][0];
      return rtf.format(Math.round(diff / unit), steps[i][1]);
    }
  }
  return rtf.format(Math.round(diff / 31557600), "year");
}
