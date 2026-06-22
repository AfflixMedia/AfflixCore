/* Clickable KPI/filter pill used on the client portal Brands & Programs tables. */
interface Props {
  label: string;
  value: number | string;
  tone?: 'green' | 'grey' | 'orange';
  active?: boolean;
  onClick?: () => void;
}

export default function FilterPill({ label, value, tone, active, onClick }: Props) {
  return (
    <div
      className={`pct-pill ${active ? 'is-active' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={onClick}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); } }}
    >
      <span className="pct-pill-l">{label}</span>
      <span className={`pct-pill-v ${tone || ''}`}>{value}</span>
    </div>
  );
}
