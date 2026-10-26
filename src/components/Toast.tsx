import { useUi } from "../ui.ts";

export function Toast() {
  const toast = useUi((s) => s.toast);
  if (!toast) return null;
  return (
    <div key={toast.id} className="toast" role="status">
      {toast.text}
    </div>
  );
}
