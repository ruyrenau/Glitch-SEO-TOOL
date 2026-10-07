'use client';

import React from 'react';
import { AlertTriangle, Construction, Inbox } from 'lucide-react';
import { fmt } from '@/lib/api';

export function Card({ title, actions, children, className = '' }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`min-w-0 p-5 rounded-2xl border bg-white border-slate-200 dark:bg-[#151824] dark:border-slate-800 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap gap-2 justify-between items-start mb-4">
          {title && <h2 className="font-bold text-sm">{title}</h2>}
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Kpi({ label, value, hint, tone = 'default' }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' | 'brand' }) {
  const color = { default: '', good: 'text-emerald-600 dark:text-emerald-400', warn: 'text-amber-600 dark:text-amber-400', bad: 'text-rose-600 dark:text-rose-400', brand: 'text-indigo-600 dark:text-indigo-400' }[tone];
  return (
    <div className="p-4 rounded-xl border bg-slate-50 border-slate-200 dark:bg-slate-900/60 dark:border-slate-800">
      <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
      <div className={`text-2xl font-black mt-1 tabular-nums break-words ${color}`}>{value}</div>
      {hint && <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{hint}</div>}
    </div>
  );
}

/** Horizontal bars with the value printed as text, so meaning never depends on color alone. */
export function BarList({ items, max, label, mono = false }: { items: Array<{ name: string; value: number }>; max?: number; label: string; mono?: boolean }) {
  if (!items.length) return <Empty>Sin datos.</Empty>;
  const top = max ?? Math.max(...items.map(i => i.value));
  return (
    <ul className="space-y-2" aria-label={label}>
      {items.map(i => (
        <li key={i.name}>
          <div className="flex justify-between gap-3 text-xs mb-1">
            <span className={`truncate ${mono ? 'font-mono text-[11px]' : 'font-medium'}`} title={i.name}>{i.name}</span>
            <span className="text-slate-500 dark:text-slate-400 tabular-nums shrink-0">{fmt(i.value)}</span>
          </div>
          <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5" aria-hidden>
            <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${top ? Math.max(1, (i.value / top) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Simple column chart; each column has an accessible label and a tooltip. */
export function Columns({ data, label }: { data: Array<{ key: string; value: number; label?: string }>; label: string }) {
  const max = Math.max(1, ...data.map(d => d.value));
  return (
    <div role="img" aria-label={label} className="flex items-end gap-[3px] h-32">
      {data.map(d => (
        <div key={d.key} className="flex-1 flex flex-col items-center justify-end h-full group" title={`${d.label ?? d.key}: ${fmt(d.value)}`}>
          <div className="w-full bg-indigo-500/80 group-hover:bg-indigo-600 rounded-t" style={{ height: `${(d.value / max) * 100}%`, minHeight: d.value ? 2 : 0 }} />
        </div>
      ))}
    </div>
  );
}

export function UrlTable({ rows, empty, caption }: { rows: Array<{ path: string; hits: number }>; empty: string; caption: string }) {
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto max-h-80 overflow-y-auto">
      <table className="w-full text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-white dark:bg-[#151824]">
          <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
            <th scope="col" className="py-2 font-semibold">URL</th>
            <th scope="col" className="py-2 font-semibold text-right">Hits de bots</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map(r => (
            <tr key={r.path}>
              <td className="py-1.5 font-mono text-[11px] break-all pr-3">{r.path}</td>
              <td className="py-1.5 text-right tabular-nums font-semibold">{fmt(r.hits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 p-4 rounded-xl border border-dashed border-slate-300 dark:border-slate-700">
      <Inbox className="w-4 h-4 shrink-0" aria-hidden /> <span>{children}</span>
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  const offline = /fetch|network/i.test(msg);
  return (
    <div role="alert" className="flex gap-2 p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs text-rose-700 dark:text-rose-300">
      <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden />
      <span>{offline ? 'No se pudo contactar la API. ¿Está corriendo en el puerto 4000? (pnpm dev)' : msg}</span>
    </div>
  );
}

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse" aria-busy="true" aria-label="Cargando">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-8 rounded-lg bg-slate-100 dark:bg-slate-800" />
      ))}
    </div>
  );
}

export function Badge({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'good' | 'warn' | 'bad' | 'demo' }) {
  const cls = {
    default: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
    good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
    warn: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    bad: 'bg-rose-500/10 text-rose-700 dark:text-rose-400',
    demo: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300'
  }[tone];
  return <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${cls}`}>{children}</span>;
}

export function Button({ children, variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) {
  const cls = {
    primary: 'bg-indigo-600 hover:bg-indigo-700 text-white',
    secondary: 'bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 dark:text-slate-100 dark:border-slate-700',
    danger: 'bg-rose-600 hover:bg-rose-700 text-white'
  }[variant];
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${cls} ${props.className ?? ''}`}
    >
      {children}
    </button>
  );
}

/** Shown for modules that have no backend yet: no fake numbers. */
export function Roadmap({ title, status, items }: { title: string; status: string; items: string[] }) {
  return (
    <Card>
      <div className="flex items-start gap-3">
        <Construction className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" aria-hidden />
        <div className="space-y-2">
          <h2 className="font-bold text-sm">{title}</h2>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            <Badge tone="warn">PENDIENTE</Badge> {status}
          </p>
          <ul className="list-disc ml-5 text-xs text-slate-600 dark:text-slate-400 space-y-1">
            {items.map(i => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

export const inputCls =
  'w-full p-2 text-xs rounded-lg border bg-slate-50 border-slate-200 dark:bg-slate-900 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500';
