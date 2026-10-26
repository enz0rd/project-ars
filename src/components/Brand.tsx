/** Project Ars mark: an open "A" drawn as a pen stroke, with a node where the stroke turns. */
export function ArsMark({ size = 28 }: { size?: number }) {
  return (
    <svg className="ars-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" className="ars-mark-bg" />
      <path d="M9 23 L16 8 L23 23" className="ars-mark-stroke" />
      <path d="M12.2 17.5 H19.8" className="ars-mark-stroke thin" />
      <circle cx="16" cy="8" r="2.4" className="ars-mark-node" />
    </svg>
  );
}

export const SLOGAN = "Design without boundaries";

export function ArsLogo({ withSlogan = false }: { withSlogan?: boolean }) {
  return (
    <span className="ars-logo">
      <ArsMark />
      <span className="ars-logo-text">
        <span className="ars-name">
          Project <b>Ars</b>
        </span>
        {withSlogan && <span className="ars-slogan">{SLOGAN}</span>}
      </span>
    </span>
  );
}
