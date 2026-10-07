'use client';

import React, { useEffect, useState } from 'react';
import { PlugZap, Trash2 } from 'lucide-react';
import { apiGet, apiSend, fmtDate } from '@/lib/api';
import type { WpConnection } from '@/lib/types';
import { Badge, Button, Card, ErrorBox, Skeleton, inputCls } from './ui';

export function WordPressView({ siteId, go }: { siteId: string; go: (nav: string) => void }) {
  const [conn, setConn] = useState<WpConnection | null | undefined>(undefined);
  const [form, setForm] = useState({ endpointUrl: '', username: '', appPassword: '' });
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cats, setCats] = useState<Array<{ id: number; name: string; count: number }> | null>(null);

  useEffect(() => {
    apiGet<{ connection: WpConnection | null }>(`/api/v1/sites/${siteId}/wordpress`)
      .then(r => {
        setConn(r.connection);
        if (r.connection) setForm({ endpointUrl: r.connection.endpointUrl, username: r.connection.username, appPassword: '' });
      })
      .catch(setError);
  }, [siteId]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const body = { endpointUrl: form.endpointUrl, username: form.username, ...(form.appPassword ? { appPassword: form.appPassword } : {}) };
      await apiSend('PUT', `/api/v1/sites/${siteId}/wordpress`, body);
      setForm(f => ({ ...f, appPassword: '' }));
      await test();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await apiSend<{ ok: boolean; siteName?: string; user?: string; error?: string; connection: WpConnection }>('POST', `/api/v1/sites/${siteId}/wordpress/test`);
      setConn(r.connection);
      setMsg(r.ok ? `✓ Conectado a "${r.siteName}" como ${r.user}.` : null);
      if (r.ok) setCats(await apiGet(`/api/v1/sites/${siteId}/wordpress/categories`));
      else setCats(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('¿Borrar la conexión y la contraseña de aplicación guardada? Los borradores ya enviados no se tocan.')) return;
    try {
      await apiSend('DELETE', `/api/v1/sites/${siteId}/wordpress?confirm=true`);
      setConn(null);
      setCats(null);
      setForm({ endpointUrl: '', username: '', appPassword: '' });
    } catch (err) {
      setError(err);
    }
  };

  if (conn === undefined && !error) return <Skeleton rows={4} />;
  return (
    <div className="space-y-6">
      <Card
        title="Conexión con WordPress"
        actions={conn && <Badge tone={conn.status === 'ok' ? 'good' : conn.status === 'error' ? 'bad' : 'warn'}>{conn.status === 'ok' ? 'conectado' : conn.status === 'error' ? 'error' : 'sin probar'}</Badge>}
      >
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
          Usa una <strong>contraseña de aplicación</strong> (Usuarios → Perfil → Contraseñas de aplicación) de un usuario con permiso para editar entradas. Se guarda cifrada (AES-256-GCM) y
          nunca se devuelve completa. Se exige HTTPS. La herramienta solo crea y edita <strong>borradores</strong>: no publica, no borra y no modifica entradas que ya no sean borrador.
        </p>
        <form onSubmit={save} className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-xs font-semibold space-y-1">
            <span>URL del sitio WordPress</span>
            <input required type="url" placeholder="https://www.ejemplo.com" className={inputCls} value={form.endpointUrl} onChange={e => setForm({ ...form, endpointUrl: e.target.value })} />
          </label>
          <label className="text-xs font-semibold space-y-1">
            <span>Usuario</span>
            <input required autoComplete="off" className={inputCls} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} />
          </label>
          <label className="text-xs font-semibold space-y-1">
            <span>Contraseña de aplicación {conn && <span className="font-normal text-slate-500">(guardada: {conn.appPassword}; deja vacío para conservarla)</span>}</span>
            <input type="password" autoComplete="new-password" required={!conn} className={inputCls} value={form.appPassword} onChange={e => setForm({ ...form, appPassword: e.target.value })} />
          </label>
          <div className="md:col-span-3 flex flex-wrap gap-2">
            <Button type="submit" disabled={busy}><PlugZap className="w-3.5 h-3.5" aria-hidden /> Guardar y probar</Button>
            {conn && <Button type="button" variant="secondary" disabled={busy} onClick={test}>Probar de nuevo</Button>}
            {conn && <Button type="button" variant="secondary" onClick={remove}><Trash2 className="w-3.5 h-3.5" aria-hidden /> Borrar conexión</Button>}
          </div>
        </form>
        <div className="mt-3 space-y-2" aria-live="polite">
          {msg && <p className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</p>}
          {conn?.status === 'error' && conn.lastError && <p className="text-xs text-rose-700 dark:text-rose-300">Último error: {conn.lastError}</p>}
          {conn?.lastTestAt && <p className="text-[11px] text-slate-500">Última prueba: {fmtDate(conn.lastTestAt)}{conn.remoteName ? ` · ${conn.remoteName}` : ''}</p>}
          <ErrorBox error={error} />
        </div>
      </Card>

      {cats && (
        <Card title="Categorías en WordPress">
          <ul className="flex flex-wrap gap-2 text-xs">
            {cats.map(c => <li key={c.id} className="px-2 py-1 rounded bg-slate-100 dark:bg-slate-800">{c.name} <span className="text-slate-500">#{c.id} · {c.count}</span></li>)}
          </ul>
        </Card>
      )}

      {conn?.status === 'ok' && (
        <p className="text-xs">
          Siguiente paso: <button className="underline font-semibold" onClick={() => go('programmatic')}>genera y aprueba páginas</button> para enviarlas como borrador.
        </p>
      )}
    </div>
  );
}
