'use client';

import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { apiGet, apiSend, fmtDate } from '@/lib/api';
import type { AuditEvent } from '@/lib/types';
import { Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';

const SAMPLE_SCHEMA = `{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "Cómo analizar logs de servidor para SEO",
  "author": { "@type": "Person", "name": "Nombre real del autor" },
  "datePublished": "2026-10-05"
}`;

export function SchemaView() {
  const [json, setJson] = useState(SAMPLE_SCHEMA);
  const [result, setResult] = useState<{ isValid: boolean; type: string; errors: string[]; warnings: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);

  const validate = async () => {
    setError(null);
    try {
      setResult(await apiSend('POST', '/api/v1/schemas/validate', json, 'text/plain'));
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Card title="Validador JSON-LD">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="schema-json" className="text-xs font-semibold block mb-2">JSON-LD</label>
          <textarea id="schema-json" rows={14} value={json} onChange={e => setJson(e.target.value)} className={`${inputCls} font-mono`} spellCheck={false} />
          <Button className="mt-3" onClick={validate}>Validar</Button>
        </div>
        <div aria-live="polite">
          <ErrorBox error={error} />
          {result ? (
            <div className="space-y-2 text-xs">
              <div className={`flex items-center gap-2 font-bold text-sm ${result.isValid ? 'text-emerald-600' : 'text-rose-600'}`}>
                {result.isValid ? <CheckCircle2 className="w-4 h-4" aria-hidden /> : <XCircle className="w-4 h-4" aria-hidden />}
                {result.isValid ? 'Sin errores de estructura' : 'Errores detectados'}
              </div>
              <div>Tipo: <strong className="font-mono">{result.type}</strong></div>
              {result.errors.map(e => <div key={e} className="p-2 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300">✕ {e}</div>)}
              {result.warnings.map(w => <div key={w} className="p-2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300">! {w}</div>)}
              <p className="text-[11px] text-slate-500 pt-2">Validar la estructura no garantiza resultados enriquecidos en Google.</p>
            </div>
          ) : (
            <Empty>Pega un JSON-LD y valida.</Empty>
          )}
        </div>
      </div>
    </Card>
  );
}

export function AuditView() {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    apiGet<AuditEvent[]>('/api/v1/audit-events?limit=200').then(setEvents).catch(setError);
  }, []);
  if (error) return <ErrorBox error={error} />;
  if (!events) return <Skeleton rows={6} />;
  return (
    <Card title="Registro de auditoría">
      {events.length === 0 ? (
        <Empty>Sin eventos.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Eventos de auditoría</caption>
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                <th scope="col" className="py-2">Fecha</th>
                <th scope="col">Acción</th>
                <th scope="col">Entidad</th>
                <th scope="col">Usuario</th>
                <th scope="col">Detalles</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {events.map(e => (
                <tr key={e.id}>
                  <td className="py-2 text-slate-500 whitespace-nowrap">{fmtDate(e.createdAt)}</td>
                  <td className="font-mono">{e.action}</td>
                  <td className="font-mono text-slate-500">{e.entity} {e.entityId.slice(0, 8)}</td>
                  <td>{e.user?.email ?? 'sistema / sin sesión'}</td>
                  <td className="font-mono text-[11px] text-slate-500 break-all">{e.details ? JSON.stringify(e.details) : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-slate-500 mt-3">La autenticación aún no existe, por eso las acciones se registran sin usuario.</p>
    </Card>
  );
}
