interface Props {
  name: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'brand' | 'dark';
  title?: string;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Avatar({ name, size = 'md', variant = 'brand', title }: Props) {
  const cls = ['ac-avatar'];
  if (size === 'sm') cls.push('sm');
  if (size === 'lg') cls.push('lg');
  if (variant === 'dark') cls.push('dark');
  return (
    <span className={cls.join(' ')} title={title ?? name}>
      {initials(name)}
    </span>
  );
}
