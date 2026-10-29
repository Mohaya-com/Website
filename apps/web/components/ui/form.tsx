'use client';

import { AlertCircle, Check } from 'lucide-react';
import { useId, type ComponentProps, type ReactNode } from 'react';
import { useI18n } from '@/lib/i18n';
import { cn } from './primitives';

const baseControl =
  'rounded-xl border bg-white px-3.5 text-[15px] text-ink placeholder:text-slate-400 transition-[border-color,box-shadow] focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-100 disabled:bg-slate-50 disabled:text-muted';

/** Full width unless the caller sets an explicit width (avoids conflicting w-* utilities). */
const control = (className?: string) => cn(baseControl, /(^|\s)w-/.test(className ?? '') ? '' : 'w-full');

export interface FieldProps {
  label: ReactNode;
  /** Translation key or plain text error. */
  error?: string | null;
  hint?: ReactNode;
  required?: boolean;
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode;
  className?: string;
  optional?: boolean;
}

/** Label + control + hint + inline error, wired with accessible ids. */
export function Field({ label, error, hint, required, optional, children, className }: FieldProps) {
  const { t } = useI18n();
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  const message = error ? (t.has(error) ? t.dynamic(error) : error) : null;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {required && (
          <span className="text-red-700" aria-hidden>
            {' '}
            *
          </span>
        )}
        {optional && <span className="ms-1 text-xs font-normal text-muted">({t('common.optional')})</span>}
      </label>
      {children({ id, 'aria-invalid': Boolean(error), 'aria-describedby': describedBy })}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted">
          {hint}
        </p>
      )}
      {message && (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-sm font-medium text-red-700 animate-fade-in">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {message}
        </p>
      )}
    </div>
  );
}

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control(className), 'h-12', props['aria-invalid'] ? 'border-red-500' : 'border-line-strong', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control(className), 'min-h-24 py-3', props['aria-invalid'] ? 'border-red-500' : 'border-line-strong', className)} {...props} />;
}

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={cn(control(className), 'h-12 cursor-pointer appearance-auto pe-3', props['aria-invalid'] ? 'border-red-500' : 'border-line-strong', className)} {...props}>
      {children}
    </select>
  );
}

export function Checkbox({ checked, onChange, label, description, id: idProp, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; id?: string; disabled?: boolean }) {
  const generated = useId();
  const id = idProp ?? generated;
  return (
    <label
      htmlFor={id}
      className={cn(
        'flex min-h-12 cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition-colors',
        checked ? 'border-teal-500 bg-teal-50' : 'border-line-strong bg-white hover:bg-slate-50',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center">
        <input id={id} type="checkbox" className="peer absolute inset-0 cursor-pointer opacity-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
        <span className={cn('grid size-6 place-items-center rounded-md border-2 transition-colors peer-focus-visible:ring-4 peer-focus-visible:ring-teal-100', checked ? 'border-teal-600 bg-teal-600 text-white' : 'border-slate-400 bg-white')}>
          {checked && <Check className="size-4" strokeWidth={3} aria-hidden />}
        </span>
      </span>
      <span>
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Switch({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-[15px] font-semibold text-ink">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn('relative h-7 w-12 shrink-0 rounded-full transition-colors', checked ? 'bg-teal-600' : 'bg-slate-300')}
      >
        <span className={cn('absolute top-1 size-5 rounded-full bg-white shadow transition-[inset-inline-start]', checked ? 'start-6' : 'start-1')} />
      </button>
    </div>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
}

/** Accessible radio group rendered as a segmented control. */
export function Segmented<T extends string>({ value, onChange, options, label, className, size = 'md' }: { value: T; onChange: (v: T) => void; options: SegmentOption<T>[]; label: string; className?: string; size?: 'md' | 'lg' }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex w-full rounded-xl bg-slate-100 p-1', className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-2 rounded-lg px-3 font-semibold transition-all',
              size === 'lg' ? 'h-12 text-base' : 'h-10 text-sm',
              active ? 'bg-white text-navy-900 shadow-sm ring-1 ring-line' : 'text-muted hover:text-ink',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Large selectable cards (e.g. visit reasons). */
export function ChoiceCards<T extends string>({ value, onChange, options, label, columns = 'grid-cols-2 sm:grid-cols-3' }: { value: T | null; onChange: (v: T) => void; options: SegmentOption<T>[]; label: string; columns?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('grid gap-2.5', columns)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex min-h-14 items-center gap-3 rounded-xl border p-3 text-start font-semibold transition-all',
              active ? 'border-teal-500 bg-teal-50 text-teal-800 ring-2 ring-teal-100' : 'border-line-strong bg-white text-ink hover:border-navy-200 hover:bg-navy-50',
            )}
          >
            {o.icon && <span className={cn('grid size-9 shrink-0 place-items-center rounded-lg', active ? 'bg-teal-600 text-white' : 'bg-navy-50 text-navy-700')}>{o.icon}</span>}
            <span className="text-[15px]">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
