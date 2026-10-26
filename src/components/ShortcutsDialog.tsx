import { X } from "lucide-react";
import { useUi } from "../ui.ts";

export const SHORTCUTS: [string, [string, string][]][] = [
  [
    "Ferramentas",
    [
      ["V", "Mover"],
      ["H / Espaço", "Mão (pan)"],
      ["F", "Frame"],
      ["R", "Retângulo"],
      ["O", "Elipse"],
      ["T", "Texto"],
    ],
  ],
  [
    "Edição",
    [
      ["Ctrl+Z / Ctrl+Shift+Z", "Desfazer / refazer"],
      ["Ctrl+C / X / V", "Copiar / recortar / colar"],
      ["Ctrl+D", "Duplicar"],
      ["Alt + arrastar", "Duplicar arrastando"],
      ["Del", "Excluir"],
      ["Setas (Shift = 10px)", "Mover seleção"],
      ["Ctrl + arrastar", "Mover sem guias"],
      ["Shift + arrastar", "Travar eixo / proporção"],
    ],
  ],
  [
    "Organizar",
    [
      ["Ctrl+] / Ctrl+[", "Avançar / recuar"],
      ["Ctrl+Shift+] / [", "Frente / trás"],
      ["Alt+A / Alt+D", "Alinhar esquerda / direita"],
      ["Alt+W / Alt+S", "Alinhar topo / base"],
      ["Alt+H / Alt+V", "Centralizar horizontal / vertical"],
      ["Ctrl+Shift+H / L", "Ocultar / bloquear"],
    ],
  ],
  [
    "Visualização",
    [
      ["Ctrl + scroll", "Zoom"],
      ["Shift+1", "Ajustar à tela"],
      ["Shift+2", "Zoom na seleção"],
      ["Shift+0", "100%"],
      ["Ctrl+K", "Perguntar ao Claude"],
      ["?", "Esta lista"],
    ],
  ],
];

export function ShortcutsDialog() {
  const open = useUi((s) => s.shortcutsOpen);
  const setOpen = useUi((s) => s.setShortcutsOpen);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="modal wide" role="dialog" aria-labelledby="shortcuts-title" onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
        <header className="modal-header">
          <h2 id="shortcuts-title">Atalhos de teclado</h2>
          <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Fechar" autoFocus>
            <X size={16} />
          </button>
        </header>
        <div className="modal-body shortcuts">
          {SHORTCUTS.map(([group, rows]) => (
            <section key={group}>
              <h3>{group}</h3>
              {rows.map(([keys, label]) => (
                <div key={keys} className="shortcut-row">
                  <span>{label}</span>
                  <kbd>{keys}</kbd>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
