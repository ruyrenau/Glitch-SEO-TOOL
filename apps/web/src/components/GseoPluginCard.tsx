'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { API_URL, apiGet } from '@/lib/api';
import { Badge, Button, Card } from './ui';

type Info = {
  connected: boolean;
  plugin: { version: string; active: boolean; output: boolean; conflicts: string[]; sitemap: string; llms_txt: string | null; public: boolean; robots_file: boolean } | null;
  seoFields: 'yoast' | 'rankmath' | 'gseo' | null;
  redirects: 'gseo' | 'redirection' | null;
  error: string | null;
};

const FIELDS: Record<string, string> = { gseo: 'G.SEO – SEO', yoast: 'Yoast SEO', rankmath: 'Rank Math' };

async function downloadZip() {
  const res = await fetch(`${API_URL}/api/v1/downloads/plugin/gseo-seo.zip`, { credentials: 'include' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await res.blob());
  a.download = 'gseo-seo.zip';
  a.click();
}

/** The G.SEO – SEO WordPress plugin: download it and see whether the connected site runs it. */
export function GseoPluginCard({ siteId, refreshKey }: { siteId: string; refreshKey?: unknown }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(false);
  const load = useCallback(() => {
    setLoading(true);
    apiGet<Info>(`/api/v1/sites/${siteId}/wordpress/seo-plugin`)
      .then(setInfo, () => setInfo(null))
      .finally(() => setLoading(false));
  }, [siteId]);
  useEffect(() => {
    load();
  }, [load, refreshKey]);
  const p = info?.plugin;
  return (
    <Card
      title="Plugin G.SEO – SEO para WordPress"
      actions={p ? <Badge tone={p.active ? 'good' : 'warn'}>{p.active ? `v${p.version} activo` : `v${p.version} en pausa`}</Badge> : info?.connected ? <Badge tone="default">no instalado</Badge> : null}
    >
      <div className="space-y-3 text-xs">
        <p className="text-slate-600 dark:text-slate-400">
          Le da al sitio su propio SEO, sin depender de que G.SEO esté encendido: títulos y meta descripciones con vista previa en el editor, canonical, noindex, Open Graph, datos estructurados, sitemap, robots.txt (con bloqueo opcional de bots de entrenamiento de IA), llms.txt, redirecciones y registro de 404. Desde aquí G.SEO lo controla: Cambios SEO edita sus campos, Arquitectura y Consolidación crean sus 301, y Listo para IA publica el llms.txt.
        </p>
        <ol className="list-decimal ml-5 space-y-1 text-slate-600 dark:text-slate-400">
          <li>Descarga el plugin.</li>
          <li>En WordPress: <strong>Plugins → Añadir nuevo → Subir plugin</strong>, elige <span className="font-mono">gseo-seo.zip</span>, instala y activa.</li>
          <li>Revisa <strong>Ajustes → G.SEO</strong> (pestaña Estado) y vuelve aquí a comprobar.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button onClick={downloadZip}><Download className="w-3.5 h-3.5" aria-hidden /> Descargar plugin (.zip)</Button>
          {info?.connected && <Button variant="secondary" onClick={load} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Comprobar</Button>}
        </div>
        {info?.connected && (
          <ul className="space-y-1" aria-label="Estado en el WordPress conectado">
            {info.error && <li className="text-rose-700 dark:text-rose-300">No se pudo consultar WordPress: {info.error}</li>}
            {p?.conflicts.length ? <li className="text-amber-700 dark:text-amber-400">⏸️ {p.conflicts.join(', ')} está activo: el plugin no imprime títulos ni metas para no duplicarlos. Desactívalo cuando quieras usar G.SEO.</li> : null}
            {p && !p.output && !p.conflicts.length && <li className="text-amber-700 dark:text-amber-400">⏸️ El SEO del plugin está apagado en Ajustes → G.SEO → General.</li>}
            {p && !p.public && <li className="text-rose-700 dark:text-rose-300">⚠️ WordPress pide a los buscadores no indexar el sitio (Ajustes → Lectura).</li>}
            {p?.robots_file && <li className="text-amber-700 dark:text-amber-400">⚠️ Hay un robots.txt físico en el servidor: los ajustes de robots del plugin no se aplican.</li>}
            <li>Campos SEO que edita G.SEO: <strong>{info.seoFields ? FIELDS[info.seoFields] : 'ninguno (instala el plugin)'}</strong></li>
            <li>Redirecciones: <strong>{info.redirects === 'gseo' ? 'plugin G.SEO' : info.redirects === 'redirection' ? 'plugin Redirection' : 'sin plugin (solo exportar a .htaccess / Nginx)'}</strong></li>
            {p && <li>Sitemap: <a className="underline" href={p.sitemap} target="_blank" rel="noreferrer">{p.sitemap}</a>{p.llms_txt && <> · llms.txt: <a className="underline" href={p.llms_txt} target="_blank" rel="noreferrer">{p.llms_txt}</a></>}</li>}
          </ul>
        )}
        {!info?.connected && <p className="text-slate-500">Conecta WordPress arriba para ver si el plugin está instalado.</p>}
      </div>
    </Card>
  );
}
