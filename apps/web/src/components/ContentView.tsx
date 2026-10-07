'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Eye, RotateCcw, Send, X } from 'lucide-react';
import { ApiRequestError, apiGet, apiSend, fmtDate } from '@/lib/api';
import type { DryRun, DiffLine, GeneratedPage } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';
import { DatasetsPanel } from './DatasetsPanel';

const STATUS: Record<GeneratedPage['status'], { label: string; tone: 'good' | 'warn' | 'bad' | 'default' }> = {
  BLOCKED: { label: 'Bloqueada', tone: 'bad' },
  NEEDS_REVIEW: { label: 'Requiere revisión', tone: 'warn' },
  READY_FOR_APPROVAL: { label: 'Lista para aprobar', tone: 'default' },
  APPROVED: { label: 'Aprobada', tone: 'good' },
  SENT_AS_DRAFT: { label: 'Borrador en WordPress', tone: 'good' },
  PUBLISHED: { label: 'Publicada', tone: 'good' },
  FAILED: { label: 'Fallida', tone: 'bad' },
  ARCHIVED: { label: 'Archivada', tone: 'default' }
};

const DEFAULT = {
  titleTemplate: 'Auditoría SEO técnica en {{city}}',
  metaTemplate: 'Auditoría SEO técnica en {{city}}: logs, rastreo, indexación y datos estructurados.',
  slugTemplate: 'auditoria-seo-{{city}}',
  bodyTemplate: [
    '<h1>Auditoría SEO técnica en {{city}}</h1>',
    '<p>{{description}} para empresas de {{city}} que necesitan entender por qué sus páginas no se rastrean o no se indexan como esperan.</p>',
    '<h2>Qué revisamos</h2>',
    '<ul><li>Logs del servidor: qué URLs visita Googlebot, cuáles ignora y cuántas respuestas 404, 500 o redirecciones recibe.</li>',
    '<li>Rastreo e indexación: robots.txt, sitemaps, canonicals, etiquetas noindex y páginas huérfanas.</li>',
    '<li>Actividad de bots de IA como GPTBot, ClaudeBot y PerplexityBot, y visitas que llegan desde asistentes.</li>',
    '<li>Datos estructurados JSON-LD y su coherencia con el contenido visible.</li></ul>',
    '<h2>Entregables</h2>',
    '<p>Un reporte priorizado por severidad, con evidencia por URL, recomendaciones concretas y una sesión para resolver dudas con tu equipo de desarrollo.</p>',
    '<p>Precio desde {{price}} MXN. El alcance final depende del tamaño del sitio y del acceso a los logs.</p>'
  ].join('\n'),
  data: 'city=Puebla\ndescription=Auditoría y corrección técnica para tiendas, despachos y restaurantes del centro histórico, con foco en velocidad móvil, fichas locales y catálogos que hoy casi no reciben visitas de Googlebot\nprice=15000'
};

function parseData(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function Diff({ lines }: { lines: DiffLine[] }) {
  if (!lines.some(l => l.op !== 'same')) return <p className="text-xs text-slate-500">El contenido no cambia.</p>;
  return (
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all rounded bg-slate-50 dark:bg-slate-900 p-2 max-h-72 overflow-auto" aria-label="Diferencias de contenido">
      {lines.map((l, i) => (
        <div key={i} className={l.op === 'add' ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300' : l.op === 'remove' ? 'bg-rose-500/15 text-rose-800 dark:text-rose-300 line-through' : 'text-slate-500'}>
          {l.op === 'add' ? '+ ' : l.op === 'remove' ? '− ' : '  '}
          {l.text}
        </div>
      ))}
    </pre>
  );
}

export function ContentView({ siteId, go }: { siteId: string; go: (nav: string) => void }) {
  const [form, setForm] = useState(DEFAULT);
  const [pages, setPages] = useState<GeneratedPage[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reviewer, setReviewer] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [dry, setDry] = useState<Record<string, DryRun>>({});
  const [conflict, setConflict] = useState<Record<string, { lastWrite: string; remoteModified: string; diff: DryRun['diff'] }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | GeneratedPage['status']>('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);
  const set = (k: keyof typeof DEFAULT) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  const load = useCallback(async () => {
    try {
      setPages(await apiGet<GeneratedPage[]>(`/api/v1/sites/${siteId}/generated-pages`));
    } catch (err) {
      setError(err);
    }
  }, [siteId]);
  useEffect(() => {
    load();
    apiGet<{ connection: { status: string } | null }>(`/api/v1/sites/${siteId}/wordpress`).then(r => setConnected(r.connection?.status === 'ok')).catch(() => setConnected(false));
    try {
      setReviewer(localStorage.getItem('glitch-reviewer') ?? '');
    } catch {
      /* ignore */
    }
  }, [load, siteId]);

  const run = async (id: string, fn: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  };

  const generate = (e: React.FormEvent) => {
    e.preventDefault();
    run('generate', async () => {
      const page = await apiSend<GeneratedPage>('POST', `/api/v1/sites/${siteId}/generated-pages`, {
        titleTemplate: form.titleTemplate,
        bodyTemplate: form.bodyTemplate,
        metaTemplate: form.metaTemplate,
        slugTemplate: form.slugTemplate,
        data: parseData(form.data)
      });
      await load();
      setOpen(page.id);
    });
  };

  const review = (p: GeneratedPage, decision: 'approved' | 'rejected') =>
    run(p.id, async () => {
      if (!reviewer.trim()) throw new Error('Escribe tu nombre como revisor antes de aprobar o rechazar.');
      try {
        localStorage.setItem('glitch-reviewer', reviewer);
      } catch {
        /* ignore */
      }
      await apiSend('POST', `/api/v1/generated-pages/${p.id}/review`, { decision, reviewer });
      await load();
    });

  const dryRun = (p: GeneratedPage) => run(p.id, async () => setDry({ ...dry, [p.id]: await apiSend<DryRun>('POST', `/api/v1/generated-pages/${p.id}/wordpress/dry-run`, {}) }));

  const push = (p: GeneratedPage, overwrite = false) =>
    run(p.id, async () => {
      if (overwrite && !window.confirm('Esto sobrescribe los cambios hechos en WordPress. Se guarda una copia del contenido remoto para poder restaurarlo. ¿Continuar?')) return;
      try {
        const r = await apiSend<{ result: string; editLink: string }>(
          'POST',
          `/api/v1/generated-pages/${p.id}/wordpress/push`,
          overwrite ? { overwriteRemoteChanges: true } : {}
        );
        setConflict(c => ({ ...c, [p.id]: undefined as never }));
        await load();
        window.alert(r.result === 'created' ? 'Borrador creado en WordPress.' : 'Borrador actualizado en WordPress.');
      } catch (err) {
        if (err instanceof ApiRequestError && err.code === 'REMOTE_CHANGED') {
          const d = await apiSend<DryRun>('POST', `/api/v1/generated-pages/${p.id}/wordpress/dry-run`, {});
          setConflict(c => ({ ...c, [p.id]: { lastWrite: '', remoteModified: d.remote?.modified_gmt ?? '', diff: d.diff } }));
          return;
        }
        throw err;
      }
    });

  const rollback = (pubId: string, pageId: string) =>
    run(pageId, async () => {
      if (!window.confirm('¿Restaurar en WordPress el contenido que había antes de este envío?')) return;
      await apiSend('POST', `/api/v1/wordpress/publications/${pubId}/rollback`, { confirm: true });
      await load();
    });

  const visible = (pages ?? []).filter(p => !statusFilter || p.status === statusFilter);
  const toggle = (id: string) => setChecked(c => {
    const n = new Set(c);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const bulk = (kind: 'approved' | 'rejected' | 'push') =>
    run('bulk', async () => {
      const ids = [...checked];
      if (!ids.length) return;
      setBulkMsg(null);
      if (kind !== 'push' && !reviewer.trim()) throw new Error('Escribe tu nombre como revisor antes de aprobar o rechazar.');
      if (kind === 'push' && !window.confirm(`¿Enviar ${ids.length} página(s) aprobadas a WordPress como borrador? Las no aprobadas y las que tengan conflictos se omiten.`)) return;
      const r = kind === 'push'
        ? await apiSend<{ results: Array<{ ok: boolean; error?: string }> }>('POST', '/api/v1/generated-pages/bulk-push', { ids })
        : await apiSend<{ results: Array<{ ok: boolean; error?: string }> }>('POST', '/api/v1/generated-pages/bulk-review', { ids, decision: kind, reviewer });
      const ok = r.results.filter(x => x.ok).length;
      const errors = [...new Set(r.results.filter(x => !x.ok).map(x => x.error))];
      const verb = kind === 'push' ? 'Enviadas como borrador' : kind === 'approved' ? 'Aprobadas' : 'Rechazadas';
      setBulkMsg(`${verb}: ${ok} de ${ids.length}.${errors.length ? ` Omitidas: ${errors.join(', ')}.` : ''}`);
      setChecked(new Set());
      await load();
    });

  return (
    <div className="space-y-6">
      <DatasetsPanel siteId={siteId} onGenerated={load} />

      <details className="rounded-2xl border bg-white border-slate-200 dark:bg-[#151824] dark:border-slate-800 p-5">
      <summary className="cursor-pointer font-bold text-sm">Página individual (sin dataset)</summary>
      <div className="mt-4">
        <form onSubmit={generate} className="grid grid-cols-1 lg:grid-cols-2 gap-4 text-xs">
          <div className="space-y-3">
            {(['titleTemplate', 'metaTemplate', 'slugTemplate'] as const).map(k => (
              <label key={k} className="block font-semibold space-y-1">
                <span>{{ titleTemplate: 'Título', metaTemplate: 'Meta description', slugTemplate: 'Slug' }[k]}</span>
                <input className={`${inputCls} font-mono`} value={form[k]} onChange={set(k)} />
              </label>
            ))}
            <label className="block font-semibold space-y-1">
              <span>Datos de la fila (una variable por línea: nombre=valor)</span>
              <textarea rows={4} className={`${inputCls} font-mono`} value={form.data} onChange={set('data')} />
            </label>
          </div>
          <div className="space-y-3">
            <label className="block font-semibold space-y-1">
              <span>Cuerpo (HTML con variables {'{{nombre}}'}; sin JavaScript)</span>
              <textarea rows={9} className={`${inputCls} font-mono`} value={form.bodyTemplate} onChange={set('bodyTemplate')} />
            </label>
            <Button type="submit" disabled={busy === 'generate'}>Generar y evaluar calidad</Button>
            <p className="text-[11px] text-slate-500">Cada página pasa por quality gates (longitudes, slug, contenido escaso, variables sin datos) y se compara con las demás páginas del sitio para detectar duplicados.</p>
          </div>
        </form>
      </div>
      </details>

      <ErrorBox error={error} />

      <Card
        title="Páginas generadas"
        actions={
          <>
            <select aria-label="Filtrar por estado" className={inputCls} value={statusFilter} onChange={e => { setStatusFilter(e.target.value as typeof statusFilter); setChecked(new Set()); }}>
              <option value="">Todos los estados</option>
              {Object.entries(STATUS).filter(([k]) => k !== 'PUBLISHED' && k !== 'FAILED').map(([k, v]) => <option key={k} value={k}>{v.label} ({(pages ?? []).filter(p => p.status === k).length})</option>)}
            </select>
            <label className="text-xs flex items-center gap-2">
              <span>Revisor:</span>
              <input className={`${inputCls} w-40`} placeholder="Tu nombre" value={reviewer} onChange={e => setReviewer(e.target.value)} />
            </label>
          </>
        }
      >
        {bulkMsg && <p role="status" className="mb-3 text-xs text-indigo-700 dark:text-indigo-300">{bulkMsg}</p>}
        {visible.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={checked.size > 0 && checked.size === visible.length} onChange={e => setChecked(e.target.checked ? new Set(visible.map(p => p.id)) : new Set())} />
              Seleccionar {visible.length} visibles
            </label>
            <span className="text-slate-500">{checked.size} seleccionadas</span>
            <Button variant="secondary" disabled={!checked.size || busy === 'bulk'} onClick={() => bulk('approved')}>Aprobar seleccionadas</Button>
            <Button variant="secondary" disabled={!checked.size || busy === 'bulk'} onClick={() => bulk('rejected')}>Rechazar seleccionadas</Button>
            {connected && <Button disabled={!checked.size || busy === 'bulk'} onClick={() => bulk('push')}>Enviar seleccionadas como borrador</Button>}
          </div>
        )}
        {connected === false && (
          <p className="text-xs text-amber-700 dark:text-amber-400 mb-3">
            Este sitio no tiene una conexión de WordPress verificada. <button className="underline font-semibold" onClick={() => go('wordpress')}>Configurarla</button>
          </p>
        )}
        {!pages ? (
          <Skeleton rows={4} />
        ) : !pages.length ? (
          <Empty>Aún no hay páginas. Importa un CSV o genera una página individual arriba.</Empty>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {visible.map(p => {
              const expanded = open === p.id;
              const st = STATUS[p.status];
              const lastUpdate = p.publications.find(x => x.action === 'update' && x.result === 'success');
              const d = dry[p.id];
              const c = conflict[p.id];
              const canSend = p.status === 'APPROVED' || p.status === 'SENT_AS_DRAFT';
              return (
                <li key={p.id} className="py-3 space-y-3">
                  <div className="flex flex-col md:flex-row md:items-center gap-2 justify-between">
                    <input type="checkbox" className="shrink-0 self-start mt-1" aria-label={`Seleccionar ${p.title}`} checked={checked.has(p.id)} onChange={() => toggle(p.id)} />
                    <button className="text-left space-y-1" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : p.id)}>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={st.tone}>{st.label}</Badge>
                        <span className="font-semibold text-sm">{p.title}</span>
                      </span>
                      <span className="block text-[11px] text-slate-500 font-mono">/{p.slug} · similitud máx. {Math.round(p.similarityScore * 100)}%{p.qualityChecks?.mostSimilar ? ` con /${p.qualityChecks.mostSimilar}` : ''} · {fmtDate(p.createdAt)}</span>
                    </button>
                    <div className="flex flex-wrap gap-2">
                      {p.status !== 'BLOCKED' && p.status !== 'APPROVED' && p.status !== 'SENT_AS_DRAFT' && (
                        <Button variant="secondary" disabled={busy === p.id} onClick={() => review(p, 'approved')}><Check className="w-3.5 h-3.5" aria-hidden /> Aprobar</Button>
                      )}
                      {p.status !== 'BLOCKED' && p.status !== 'NEEDS_REVIEW' && p.status !== 'SENT_AS_DRAFT' && (
                        <Button variant="secondary" disabled={busy === p.id} onClick={() => review(p, 'rejected')}><X className="w-3.5 h-3.5" aria-hidden /> Rechazar</Button>
                      )}
                      {connected && <Button variant="secondary" disabled={busy === p.id} onClick={() => { setOpen(p.id); dryRun(p); }}><Eye className="w-3.5 h-3.5" aria-hidden /> Dry run</Button>}
                      {connected && canSend && <Button disabled={busy === p.id} onClick={() => push(p)}><Send className="w-3.5 h-3.5" aria-hidden /> {p.publishedWpPostId ? 'Actualizar borrador' : 'Enviar como borrador'}</Button>}
                    </div>
                  </div>

                  {c && (
                    <div role="alert" className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-xs space-y-2">
                      <p className="font-semibold">El borrador se editó en WordPress después del último envío (modificado {c.remoteModified} UTC). Revisa qué se perdería:</p>
                      <Diff lines={c.diff.content} />
                      <Button variant="danger" onClick={() => push(p, true)}>Sobrescribir cambios remotos</Button>
                    </div>
                  )}

                  {expanded && (
                    <div className="ml-1 space-y-3 text-xs">
                      {!!p.qualityChecks?.issues.length && (
                        <ul className="space-y-1">
                          {p.qualityChecks.issues.map(i => <li key={i} className="p-2 rounded bg-amber-500/10">• {i}</li>)}
                        </ul>
                      )}
                      <p><strong>Meta description:</strong> {p.metaDescription}</p>
                      {p.sourceData && <p className="text-slate-500"><strong>Datos de origen:</strong> <span className="font-mono">{JSON.stringify(p.sourceData)}</span></p>}
                      <details>
                        <summary className="cursor-pointer font-semibold">HTML generado</summary>
                        <pre className="mt-1 font-mono text-[11px] whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-900 rounded p-2 max-h-60 overflow-auto">{p.content}</pre>
                      </details>
                      {p.approvals[0] && <p className="text-slate-500">Última revisión: {p.approvals[0].action === 'approved' ? 'aprobada' : 'rechazada'} por {p.approvals[0].reviewer} · {fmtDate(p.approvals[0].createdAt)}</p>}
                      {p.wpLink && (
                        <p>
                          WordPress: post #{p.publishedWpPostId} ·{' '}
                          <a className="underline" href={p.wpLink} target="_blank" rel="noreferrer">vista previa</a>
                        </p>
                      )}
                      {d && (
                        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 space-y-2">
                          <p className="font-semibold">Dry run: {d.action === 'create' ? 'se crearía un borrador nuevo' : `se actualizaría el borrador #${d.remote?.id}`} (status: draft). No se envió nada.</p>
                          {d.warnings.map(w => <p key={w} className="text-amber-700 dark:text-amber-400">⚠ {w}</p>)}
                          {d.diff.title && <p>Título: <span className="line-through text-slate-500">{d.diff.title.before || '—'}</span> → {d.diff.title.after}</p>}
                          <Diff lines={d.diff.content} />
                        </div>
                      )}
                      {!!p.publications.length && (
                        <div>
                          <h4 className="font-semibold mb-1">Historial de envíos</h4>
                          <ul className="space-y-1">
                            {p.publications.map(x => (
                              <li key={x.id} className="flex flex-wrap items-center gap-2">
                                <Badge tone={x.result === 'success' ? 'good' : x.result === 'conflict' || x.result === 'refused' ? 'warn' : 'bad'}>{x.action} · {x.result}</Badge>
                                <span className="text-slate-500">{fmtDate(x.createdAt)}</span>
                                {x.error && <span className="text-rose-700 dark:text-rose-300">{x.error}</span>}
                                {x.id === lastUpdate?.id && (
                                  <Button variant="secondary" onClick={() => rollback(x.id, p.id)}><RotateCcw className="w-3.5 h-3.5" aria-hidden /> Restaurar versión anterior</Button>
                                )}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
