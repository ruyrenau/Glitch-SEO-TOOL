'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { API_URL, apiGet, apiSend } from '@/lib/api';

interface Report { id: string; token: string; title: string; sections: string[]; createdAt: string; expiresAt: string | null; revokedAt: string | null; views: number }

const date = (d: string) => new Date(d).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });

/** Client reports: freeze the chosen sections into a page that can be shared by link or downloaded as PDF. */
export function ReportsView({ siteId }: { siteId: string }) {
  const [sections, setSections] = useState<Record<string, string>>({});
  const [chosen, setChosen] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [expires, setExpires] = useState<string>('90');
  const [reports, setReports] = useState<Report[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pdf, setPdf] = useState<string | null>(null);

  const load = useCallback(() => apiGet<Report[]>(`/api/v1/sites/${siteId}/reports`).then(setReports).catch(() => setReports([])), [siteId]);
  useEffect(() => {
    apiGet<Record<string, string>>('/api/v1/reports/sections').then(s => {
      setSections(s);
      setChosen(Object.keys(s));
    }).catch(() => undefined);
    load();
  }, [load]);

  const link = (r: Report) => `${window.location.origin}/r/${r.token}`;
  const live = (r: Report) => !r.revokedAt && (!r.expiresAt || new Date(r.expiresAt) > new Date());

  async function create() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiSend<Report>('POST', `/api/v1/sites/${siteId}/reports`, { title, sections: chosen, expiresDays: expires === 'never' ? null : Number(expires) });
      setMsg('Reporte creado. Copia el enlace o descarga el PDF.');
      setTitle('');
      await load();
      void r;
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy(r: Report) {
    await navigator.clipboard?.writeText(link(r)).catch(() => undefined);
    setMsg('Enlace copiado.');
  }
  async function revoke(r: Report) {
    if (!confirm('¿Retirar este reporte? El enlace dejará de funcionar para el cliente.')) return;
    await apiSend('DELETE', `/api/v1/reports/${r.id}`).catch(e => setMsg((e as Error).message));
    await load();
  }
  async function download(r: Report) {
    setPdf(r.id);
    setMsg(null);
    try {
      const res = await fetch(`${API_URL}/api/v1/reports/${r.id}/pdf`, { credentials: 'include' });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.error?.message ?? 'No se pudo generar el PDF.');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = `${r.title}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setPdf(null);
    }
  }

  return (
    <div className="space-y-6">
      <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
        <div>
          <h2 className="font-bold">Nuevo reporte para el cliente</h2>
          <p className="text-xs text-slate-500">Se guarda una foto de los datos de hoy: el cliente ve exactamente lo que revisaste, sin login. Las respuestas pegadas de IA y los datos internos no se incluyen.</p>
        </div>
        <label className="block text-xs font-semibold">Título
          <input aria-label="Título del reporte" value={title} onChange={e => setTitle(e.target.value)} placeholder="Reporte SEO — octubre" className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm font-normal" />
        </label>
        <fieldset className="grid sm:grid-cols-2 gap-2">
          <legend className="text-xs font-semibold mb-1">Secciones</legend>
          {Object.entries(sections).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={chosen.includes(k)} onChange={e => setChosen(c => (e.target.checked ? [...c, k] : c.filter(x => x !== k)))} />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold">El enlace caduca
            <select aria-label="Caducidad" value={expires} onChange={e => setExpires(e.target.value)} className="mt-1 block px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-transparent text-sm font-normal">
              <option value="30">En 30 días</option>
              <option value="90">En 90 días</option>
              <option value="365">En un año</option>
              <option value="never">Nunca</option>
            </select>
          </label>
          <button disabled={busy || !chosen.length} onClick={create} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold disabled:opacity-50">{busy ? 'Creando…' : 'Crear reporte'}</button>
        </div>
        {msg && <p role="status" className="text-sm">{msg}</p>}
      </section>

      <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <h2 className="font-bold">Reportes creados</h2>
        {!reports.length ? <p className="text-sm text-slate-500">Todavía no hay reportes.</p> : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-800">
            {reports.map(r => (
              <li key={r.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm">{r.title}</div>
                  <div className="text-xs text-slate-500">
                    {date(r.createdAt)} · {r.views} {r.views === 1 ? 'vista' : 'vistas'} · {r.revokedAt ? 'Retirado' : r.expiresAt ? (live(r) ? `Caduca el ${date(r.expiresAt)}` : 'Caducado') : 'Sin caducidad'}
                  </div>
                </div>
                {live(r) && (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <a href={`/r/${r.token}`} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700">Ver</a>
                    <button onClick={() => copy(r)} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700">Copiar enlace</button>
                    <button onClick={() => download(r)} disabled={pdf === r.id} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700">{pdf === r.id ? 'Generando PDF…' : 'Descargar PDF'}</button>
                    <button onClick={() => revoke(r)} className="px-3 py-1.5 rounded-lg border border-rose-300 text-rose-700">Retirar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
