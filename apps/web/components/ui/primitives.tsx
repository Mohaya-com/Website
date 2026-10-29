import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import type { ButtonHTMLAttributes, ComponentProps, HTMLAttributes, ReactNode } from 'react';

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ');
}

type Variant = 'primary' | 'accent' | 'secondary' | 'danger' | 'ghost' | 'success';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-navy-900 text-white hover:bg-navy-800 active:bg-navy-950 shadow-sm',
  accent: 'bg-teal-600 text-white hover:bg-teal-700 active:bg-teal-800 shadow-sm',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-sm',
  secondary: 'bg-white text-navy-900 border border-line-strong hover:bg-navy-50 active:bg-navy-100',
  danger: 'bg-red-700 text-white hover:bg-red-800 active:bg-red-900 shadow-sm',
  ghost: 'text-navy-800 hover:bg-navy-50 active:bg-navy-100',
};

const SIZES: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-[15px] gap-2 rounded-xl',
  lg: 'h-13 px-6 text-base gap-2.5 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

export function buttonClasses(variant: Variant = 'primary', size: Size = 'md', block?: boolean, className?: string): string {
  return cn(
    'inline-flex select-none items-center justify-center font-semibold transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-55 disabled:active:scale-100',
    VARIANTS[variant],
    SIZES[size],
    block && 'w-full',
    className,
  );
}

/** A link styled as a button (never nest a <button> inside a link). */
export function ButtonLink({ variant, size, block, icon, className, children, ...rest }: ComponentProps<typeof Link> & { variant?: Variant; size?: Size; block?: boolean; icon?: ReactNode }) {
  return (
    <Link className={buttonClasses(variant, size, block, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

export function Button({ variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses(variant, size, block, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-[1.15em] animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return (
    <section className={cn('rounded-card border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, subtitle, icon, actions, className }: { title: ReactNode; subtitle?: ReactNode; icon?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4', className)}>
      <div className="flex min-w-0 items-start gap-3">
        {icon && <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-navy-50 text-navy-700">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink">{title}</h2>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export type Tone = 'neutral' | 'navy' | 'teal' | 'green' | 'amber' | 'red' | 'orange' | 'blue' | 'slate';

const TONES: Record<Tone, string> = {
  neutral: 'bg-gray-100 text-gray-700 ring-gray-200',
  navy: 'bg-navy-50 text-navy-800 ring-navy-100',
  teal: 'bg-teal-50 text-teal-800 ring-teal-100',
  green: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  red: 'bg-red-50 text-red-800 ring-red-200',
  orange: 'bg-orange-50 text-orange-800 ring-orange-200',
  blue: 'bg-blue-50 text-blue-800 ring-blue-200',
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
};

export function Badge({ tone = 'neutral', icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center gap-2 text-muted">
      <Loader2 className={cn('size-5 animate-spin', className)} aria-hidden />
      {label && <span className="text-sm">{label}</span>}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('skeleton rounded-lg', className)} />;
}

export function Divider({ className }: { className?: string }) {
  return <hr className={cn('border-line', className)} />;
}

/** Label/value pair used in detail views. */
export function DetailItem({ label, value, className, mono }: { label: ReactNode; value: ReactNode; className?: string; mono?: boolean }) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-[15px] font-semibold text-ink', mono && 'ltr-nums')}>{value ?? '—'}</dd>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-fade-in">
      <div className="min-w-0">
        {back}
        <h1 className="text-2xl font-extrabold tracking-tight text-navy-900 sm:text-[28px]">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
