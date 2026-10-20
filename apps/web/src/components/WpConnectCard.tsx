'use client';

import React, { useEffect, useState } from 'react';
import { PlugZap } from 'lucide-react';
import { apiGet, apiSend } from '@/lib/api';
import type { Site } from '@/lib/types';
import { Button, Card, ErrorBox, inputCls } from './ui';

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
};

/** Sends the browser to WordPress's "Authorize Application" screen for `url`, attached to `siteId` (or a new site). */
export async function startWpConnect(url: string, siteId?: string) {
  const r = await apiSend<{ authorizeUrl: string }>('POST', '/api/v1/wordpress/connect/start', { url, ...(siteId ? { siteId } : {}) });
  window.location.href = r.authorizeUrl;
}

/** Arrived from the WordPress plugin ("Conectar con G.SEO"): confirm which site it is, then approve in WordPress. */
export function WpConnectCard({ url, onDone }: { url: string; onDone: () => void }) {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [siteId, setSiteId] = useState('new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    apiGet<Site[]>('/api/v1/sites').then(list => {
      setSites(list);
      const match = list.find(s => host(s.canonicalUrl) === host(url) || s.domain.replace(/^www\./, '') === host(url));
      if (match) setSiteId(match.id);
    }, setError);
  }, [url]);
  const go = async () => {
    setBusy(true);
    setError(null);
    try {
      await startWpConnect(url, siteId === 'new' ? undefined : siteId);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };
  return (
    <Card title={<span className="flex items-center gap-2"><PlugZap className="w-4 h-4" aria-hidden /> Conectar WordPress con G.SEO</span>}>
      <div className="space-y-3 text-xs">
        <p>
          <strong className="font-mono">{host(url)}</strong> quiere conectarse. Al continuar, WordPress te pedirá <strong>aprobar a G.SEO</strong> y creará una contraseña de aplicación solo para esta conexión (la puedes revocar en tu perfil de WordPress).
        </p>
        <label className="block space-y-1 max-w-md">
          <span className="font-semibold">Sitio de G.SEO</span>
          <select aria-label="Sitio de G.SEO para esta conexión" className={`${inputCls} w-full`} value={siteId} onChange={e => setSiteId(e.target.value)} disabled={!sites}>
            {sites?.map(s => <option key={s.id} value={s.id}>{s.name} ({s.domain})</option>)}
            <option value="new">Crear un sitio nuevo: {host(url)}</option>
          </select>
        </label>
        <div className="flex gap-2">
          <Button onClick={go} disabled={busy || !sites}>{busy ? 'Abriendo WordPress…' : 'Continuar a WordPress'}</Button>
          <Button variant="secondary" onClick={onDone}>Cancelar</Button>
        </div>
        <ErrorBox error={error} />
      </div>
    </Card>
  );
}
