'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { apiGet, apiSend, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';

interface Proposal {
  id: string;
  url: string;
  target: string;
  wpId: number;
  field: string;
  imageSrc: string | null;
  oldValue: string;
  newValue: string;
  note: string | null;
  status: string;
  verifyStatus: string | null;
  verifyDetail: string | null;
  error: string | null;
  createdAt: string;
  appliedAt: string | null;
}

const FIELD: Record<string, string> = { postTitle: 'Título de la entrada', slug: 'Slug (URL)', seoTitle: 'Título SEO', metaDescription: 'Meta description', imageAlt: 'Alt de imagen' };
const STATUS: Record<string, [string, 'default' | 'good' | 'warn' | 'bad']> = {
  proposed: ['Propuesto', 'default'],
  approved: ['Aprobado', 'warn'],
  rejected: ['Rechazado', 'default'],
  applied: ['Aplicado', 'good'],
  conflict: ['Conflicto', 'bad'],
  failed: ['Falló', 'bad'],
  reverted: ['Revertido', 'default']
};

/** Proposal → approval → apply → verify → revert for SEO fields on live WordPress content. */
export function SeoChangesView({ siteId }: { siteId: string }) {
  const { can } = useAuth();
  const [list, setList] = useState<Proposal[] | null>(null);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await apiGet<Proposal[]>(`/api/v1/sites/${siteId}/seo-edits${status ? `?status=${status}` : ''}`));
    } catch (e) {
      setError(e);
    }
  }, [siteId, status]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (p: Proposal, action: 'approve' | 'reject' | 'apply' | 'verify' | 'revert') => {
    if (action === 'apply' && !confirm(`¿Aplicar en el sitio publicado?\n\n${FIELD[p.field]}\nAntes: ${p.oldValue || '(vacío)'}\nDespués: ${p.newValue}`)) return;
    if (action === 'revert' && !confirm(`¿Revertir a "${p.oldValue || '(vacío)'}"?`)) return;
    setBusy(p.id);
    setError(null);
    try {
      if (action === 'approve' || action === 'reject') await apiSend('POST', `/api/v1/seo-edits/${p.id}/review`, { decision: action === 'approve' ? 'approved' : 'rejected' });
      else await apiSend('POST', `/api/v1/seo-edits/${p.id}/${action}`, action === 'verify' ? {} : { confirm: true });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
      await load();
    }
  };

  const operate = can('seo:operate');
  return (
    <div className="space-y-4">
      <Card
        title="Cambios SEO en WordPress"
        actions={
          <select aria-label="Estado" className={inputCls} value={status} onChange={e => setStatus(e.target.value)}>
            <option value="">Todos</option>
            {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        }
      >
        <p className="text-xs text-slate-500 mb-3">
          Los cambios se proponen desde el Explorador SEO (detalle de una URL → Editar en WordPress). Aquí se aprueban, se aplican al sitio publicado, se verifican en la página real y se pueden revertir.
          Antes de aplicar se comprueba que nadie haya cambiado el valor en WordPress; si cambió, queda en conflicto y no se toca.
          {!operate && ' Tu rol puede ver la lista, pero no aprobar ni aplicar.'}
        </p>
        <ErrorBox error={error} />
        {!list ? (
          <Skeleton rows={4} />
        ) : !list.length ? (
          <Empty>No hay cambios {status ? 'con este estado' : 'todavía'}.</Empty>
        ) : (
          <ul className="space-y-3">
            {list.map(p => {
              const [label, tone] = STATUS[p.status] ?? [p.status, 'default'];
              const b = busy === p.id;
              return (
                <li key={p.id} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={tone}>{label}</Badge>
                    <span className="font-semibold">{FIELD[p.field] ?? p.field}</span>
                    {p.verifyStatus && <Badge tone={p.verifyStatus === 'verified' ? 'good' : 'warn'}>{p.verifyStatus === 'verified' ? 'Verificado en la página' : 'No coincide en la página'}</Badge>}
                    <a href={p.url} target="_blank" rel="noreferrer" className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400 break-all inline-flex items-center gap-1">{p.url}<ExternalLink className="w-3 h-3" aria-hidden /></a>
                    <span className="ml-auto text-slate-400">{fmtDate(p.createdAt)}</span>
                  </div>
                  {p.imageSrc && <div className="font-mono text-[11px] text-slate-500 break-all">{p.imageSrc}</div>}
                  <div className="grid md:grid-cols-2 gap-2">
                    <div className="p-2 rounded-lg bg-rose-500/10"><div className="text-[10px] uppercase text-slate-500">Antes</div><div className="break-words line-through decoration-rose-400/60">{p.oldValue || <em>(vacío)</em>}</div></div>
                    <div className="p-2 rounded-lg bg-emerald-500/10"><div className="text-[10px] uppercase text-slate-500">Después</div><div className="break-words">{p.newValue || <em>(vacío)</em>}</div></div>
                  </div>
                  {p.note && <div className="text-slate-500">Nota: {p.note}</div>}
                  {p.error && <div className="text-rose-600 dark:text-rose-400">{p.error}</div>}
                  {p.verifyDetail && <div className="text-amber-700 dark:text-amber-300">{p.verifyDetail}</div>}
                  {operate && (
                    <div className="flex flex-wrap gap-2">
                      {p.status === 'proposed' && (
                        <>
                          <Button disabled={b} onClick={() => act(p, 'approve')}>Aprobar</Button>
                          <Button variant="secondary" disabled={b} onClick={() => act(p, 'reject')}>Rechazar</Button>
                        </>
                      )}
                      {p.status === 'approved' && (
                        <>
                          <Button disabled={b} onClick={() => act(p, 'apply')}>Aplicar en WordPress</Button>
                          <Button variant="secondary" disabled={b} onClick={() => act(p, 'reject')}>Rechazar</Button>
                        </>
                      )}
                      {(p.status === 'conflict' || p.status === 'failed') && <Button variant="secondary" disabled={b} onClick={() => act(p, 'reject')}>Descartar</Button>}
                      {p.status === 'applied' && (
                        <>
                          <Button variant="secondary" disabled={b} onClick={() => act(p, 'verify')}>Verificar en la página</Button>
                          <Button variant="danger" disabled={b} onClick={() => act(p, 'revert')}>Revertir</Button>
                        </>
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
