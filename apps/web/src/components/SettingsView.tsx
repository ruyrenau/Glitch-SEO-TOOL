'use client';

import React, { useEffect, useState } from 'react';
import { KeyRound, Trash2 } from 'lucide-react';
import { apiGet, apiSend, fmtDate } from '@/lib/api';
import { Badge, Button, Card, ErrorBox, Skeleton, inputCls } from './ui';

interface Key { provider: string; label: string; usedFor: string; configured: boolean; hint: string | null; updatedAt: string | null }

const WHERE: Record<string, string> = {
  anthropic: 'console.anthropic.com → API Keys',
  openai: 'platform.openai.com → API keys',
  google: 'aistudio.google.com → Get API key',
  serpapi: 'serpapi.com → Dashboard → API key'
};

/** Admin settings: API keys for AI providers. Values go in once and are never shown again (only the last 4 characters). */
export function SettingsView() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    apiGet<Key[]>('/api/v1/ai-keys').then(setKeys).catch(setError);
  }, []);

  const act = async (provider: string, fn: () => Promise<Key[]>, ok: string) => {
    setBusy(provider);
    setError(null);
    setMsg(null);
    try {
      setKeys(await fn());
      setDraft(d => ({ ...d, [provider]: '' }));
      setMsg(ok);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5 max-w-4xl">
      <Card title={<span className="flex items-center gap-2"><KeyRound className="w-4 h-4" aria-hidden /> Claves de API de inteligencia artificial</span>}>
        <p className="text-xs text-slate-600 dark:text-slate-300 mb-4">
          Se guardan cifradas y nunca se vuelven a mostrar; solo ves sus últimos 4 caracteres. Las usa "Visibilidad en IA": hoy, el análisis con Claude; más adelante, las consultas automáticas a cada motor.
          Cada consulta se cobra en la cuenta del proveedor.
        </p>
        <ErrorBox error={error} />
        {msg && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400 mb-2">{msg}</p>}
        {!keys ? <Skeleton rows={4} /> : (
          <ul className="space-y-3">
            {keys.map(k => (
              <li key={k.provider} className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-xs space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-sm">{k.label}</span>
                  {k.configured ? <Badge tone="good">Configurada {k.hint}</Badge> : <Badge>Sin clave</Badge>}
                  {k.updatedAt && <span className="text-slate-500">actualizada {fmtDate(k.updatedAt)}</span>}
                </div>
                <p className="text-slate-500">{k.usedFor}. Dónde obtenerla: {WHERE[k.provider]}.</p>
                <div className="flex flex-wrap gap-2">
                  <input type="password" autoComplete="off" aria-label={`Clave de ${k.label}`} className={`${inputCls} flex-1 min-w-[16rem] font-mono`} placeholder={k.configured ? 'Pega una clave nueva para reemplazarla' : 'Pega la clave aquí'} value={draft[k.provider] ?? ''} onChange={e => setDraft(d => ({ ...d, [k.provider]: e.target.value }))} />
                  <Button disabled={busy === k.provider || !(draft[k.provider] ?? '').trim()} onClick={() => act(k.provider, () => apiSend<Key[]>('PUT', `/api/v1/ai-keys/${k.provider}`, { key: draft[k.provider] }), `Clave de ${k.label} guardada.`)}>Guardar</Button>
                  {k.configured && (
                    <Button variant="secondary" disabled={busy === k.provider} onClick={() => confirm(`¿Quitar la clave de ${k.label}?`) && act(k.provider, () => apiSend<Key[]>('DELETE', `/api/v1/ai-keys/${k.provider}`), 'Clave eliminada.')}><Trash2 className="w-3.5 h-3.5" aria-hidden /> Quitar</Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
