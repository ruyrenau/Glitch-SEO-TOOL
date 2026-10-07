'use client';

import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { apiSend, fmt, fmtDate } from '@/lib/api';
import type { Site } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, inputCls } from './ui';

export function SitesView({ sites, reload, select }: { sites: Site[]; reload: () => Promise<void>; select: (id: string) => void }) {
  const [open, setOpen] = useState(sites.length === 0);
  const [form, setForm] = useState({ name: '', canonicalUrl: '', environment: 'production' as Site['environment'] });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const domain = new URL(form.canonicalUrl).hostname;
      const site = await apiSend<Site>('POST', '/api/v1/sites', { ...form, domain });
      await reload();
      select(site.id);
      setOpen(false);
      setForm({ name: '', canonicalUrl: '', environment: 'production' });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const archive = async (s: Site) => {
    if (!window.confirm(`¿Archivar "${s.name}"? Sus datos se conservan y puedes restaurarlo desde la API.`)) return;
    try {
      await apiSend('POST', `/api/v1/sites/${s.id}/archive`);
      await reload();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="space-y-6">
      <Card
        title="Sitios del workspace"
        actions={
          <Button onClick={() => setOpen(o => !o)} aria-expanded={open}>
            <Plus className="w-3.5 h-3.5" aria-hidden /> Registrar sitio
          </Button>
        }
      >
        {open && (
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-6 p-4 rounded-xl bg-slate-50 dark:bg-slate-900/50">
            <label className="text-xs font-semibold space-y-1">
              <span>Nombre</span>
              <input required maxLength={120} className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="text-xs font-semibold space-y-1">
              <span>URL canónica</span>
              <input required type="url" placeholder="https://www.ejemplo.com" className={inputCls} value={form.canonicalUrl} onChange={e => setForm({ ...form, canonicalUrl: e.target.value })} />
            </label>
            <label className="text-xs font-semibold space-y-1">
              <span>Entorno</span>
              <select className={inputCls} value={form.environment} onChange={e => setForm({ ...form, environment: e.target.value as Site['environment'] })}>
                <option value="production">Producción</option>
                <option value="staging">Staging</option>
                <option value="development">Desarrollo</option>
              </select>
            </label>
            <div className="flex items-end">
              <Button type="submit" disabled={busy}>{busy ? 'Guardando…' : 'Guardar sitio'}</Button>
            </div>
            <div className="md:col-span-4"><ErrorBox error={error} /></div>
          </form>
        )}

        {sites.length === 0 ? (
          <Empty>No hay sitios. Registra uno o ejecuta <code className="font-mono">pnpm demo:seed</code>.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Sitios registrados</caption>
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th scope="col" className="py-2">Nombre</th>
                  <th scope="col">Dominio</th>
                  <th scope="col">Entorno</th>
                  <th scope="col" className="text-right">Logs</th>
                  <th scope="col" className="text-right">URLs sitemap</th>
                  <th scope="col">Último log</th>
                  <th scope="col" className="text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sites.map(s => (
                  <tr key={s.id}>
                    <td className="py-2.5 font-semibold">{s.name}</td>
                    <td className="font-mono text-slate-500">{s.domain}</td>
                    <td>
                      <Badge tone={s.environment === 'production' ? 'good' : 'warn'}>{s.environment.toUpperCase()}</Badge>
                    </td>
                    <td className="text-right tabular-nums">{fmt(s._count.logImports)}</td>
                    <td className="text-right tabular-nums">{fmt(s._count.sitemapUrls)}</td>
                    <td className="text-slate-500">{fmtDate(s.lastLogImportAt)}</td>
                    <td className="text-right space-x-2 whitespace-nowrap">
                      <Button variant="secondary" onClick={() => select(s.id)}>Seleccionar</Button>
                      <Button variant="secondary" onClick={() => archive(s)}>Archivar</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!open && <div className="mt-3"><ErrorBox error={error} /></div>}
      </Card>
    </div>
  );
}
