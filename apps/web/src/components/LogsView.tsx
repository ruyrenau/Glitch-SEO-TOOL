'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Trash2, Upload, Map as MapIcon } from 'lucide-react';
import { API_URL, ApiRequestError, apiGet, apiSend, fmt, fmtDate, pct, waitForJob } from '@/lib/api';
import type { JobRow, LogImport, LogReport } from '@/lib/types';
import { BarList, Badge, Button, Card, Columns, Empty, ErrorBox, Kpi, Skeleton, UrlTable, inputCls } from './ui';

const toItems = (r: Record<string, number>) =>
  Object.entries(r)
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);

export function LogsView({ siteId, onChanged }: { siteId: string; onChanged: () => void }) {
  const [report, setReport] = useState<LogReport | null>(null);
  const [imports, setImports] = useState<LogImport[]>([]);
  const [importId, setImportId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sitemapUrl, setSitemapUrl] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const xmlRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiGet<LogImport[]>(`/api/v1/sites/${siteId}/log-imports`);
      setImports(list);
      if (list.length) {
        const q = importId && list.some(i => i.id === importId) ? `?importId=${importId}` : '';
        setReport(await apiGet<LogReport>(`/api/v1/sites/${siteId}/log-report${q}`));
      } else setReport(null);
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'NO_LOG_DATA') setReport(null);
      else setError(err);
    } finally {
      setLoading(false);
    }
  }, [siteId, importId]);

  useEffect(() => {
    load();
  }, [load]);

  const upload = async (file: File, replace = false) => {
    setBusy(true);
    setError(null);
    setStatus(`Subiendo y procesando ${file.name} (${(file.size / 1024 ** 2).toFixed(1)} MB) por streams…`);
    const t0 = performance.now();
    try {
      const res = await apiSend<{ jobId: string }>(
        'POST',
        `/api/v1/sites/${siteId}/log-imports?fileName=${encodeURIComponent(file.name)}${replace ? '&replace=true' : ''}`,
        file,
        'application/octet-stream'
      );
      // The worker parses the file; follow its progress.
      const job = await waitForJob<JobRow>(res.jobId, j =>
        setStatus(
          j.status === 'QUEUED'
            ? 'Archivo recibido. En cola, esperando al worker…'
            : j.status === 'RETRYING'
              ? `Reintentando (intento ${j.attempts + 1} de ${j.maxAttempts})…`
              : `Procesando por streams… ${fmt(j.progressDetail?.lines ?? 0)} líneas leídas`
        )
      );
      if (job.status !== 'COMPLETED') throw new Error(job.status === 'CANCELLED' ? 'Importación cancelada.' : `La importación falló: ${job.error ?? 'error desconocido'}`);
      const r = job.result as { importId: string; validLines: number; invalidLines: number };
      setStatus(`✓ ${fmt(r.validLines)} líneas válidas, ${fmt(r.invalidLines)} inválidas, en ${((performance.now() - t0) / 1000).toFixed(1)} s.`);
      setImportId(r.importId);
      onChanged();
      await load();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'DUPLICATE_IMPORT') {
        setStatus(null);
        if (window.confirm('Este archivo ya fue importado (mismo checksum). ¿Reemplazar la importación anterior?')) return upload(file, true);
      } else {
        setStatus(null);
        setError(err);
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const loadSitemap = async (body: { url: string } | string) => {
    setBusy(true);
    setError(null);
    setStatus('Leyendo sitemap…');
    try {
      const res = await apiSend<{ urls: number; errors: string[] }>('POST', `/api/v1/sites/${siteId}/sitemap`, body, typeof body === 'string' ? 'application/xml' : 'application/json');
      setStatus(`✓ ${fmt(res.urls)} URLs de sitemap cargadas${res.errors.length ? ` (${res.errors.length} errores)` : ''}.`);
      onChanged();
      await load();
    } catch (err) {
      setStatus(null);
      setError(err);
    } finally {
      setBusy(false);
      if (xmlRef.current) xmlRef.current.value = '';
    }
  };

  const remove = async (imp: LogImport) => {
    if (!window.confirm(`¿Eliminar permanentemente la importación "${imp.fileName}" y sus agregados? No se puede deshacer.`)) return;
    try {
      await apiSend('DELETE', `/api/v1/log-imports/${imp.id}?confirm=true`);
      if (importId === imp.id) setImportId('');
      onChanged();
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const statusItems = report ? toItems(report.statusDistribution) : [];
  const share = (n: number) => (report && report.totals.requests ? pct(n / report.totals.requests) : '—');
  const codes = (prefix: string) => statusItems.filter(s => s.name.startsWith(prefix)).reduce((a, b) => a + b.value, 0);

  return (
    <div className="space-y-6">
      <Card
        title="Importar logs y sitemap"
        actions={
          <>
            <input ref={fileRef} type="file" accept=".log,.txt,.gz" className="sr-only" id="log-file" onChange={e => e.target.files?.[0] && upload(e.target.files[0])} />
            <Button disabled={busy} onClick={() => fileRef.current?.click()}>
              <Upload className="w-3.5 h-3.5" aria-hidden /> Subir log (.log, .txt, .gz)
            </Button>
            {report && (
              <a
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 border border-slate-200 dark:bg-slate-800 dark:border-slate-700"
                href={`${API_URL}/api/v1/sites/${siteId}/log-report.csv?importId=${report.import.id}`}
              >
                <Download className="w-3.5 h-3.5" aria-hidden /> Exportar CSV
              </a>
            )}
          </>
        }
      >
        <p className="text-xs text-slate-600 dark:text-slate-400 mb-4">
          Formatos Nginx/Apache combined, con o sin <code className="font-mono">$request_time</code>. El archivo se procesa por streams, las IP se hashean
          con HMAC y nunca se guardan, y los parámetros sensibles (token, email, password…) se redactan antes de almacenar agregados.
        </p>
        <div className="flex flex-col md:flex-row gap-2">
          <label className="flex-1 text-xs font-semibold">
            <span className="sr-only">URL del sitemap</span>
            <input className={inputCls} type="url" placeholder="https://www.ejemplo.com/sitemap.xml (vacío = el del sitio)" value={sitemapUrl} onChange={e => setSitemapUrl(e.target.value)} />
          </label>
          <Button variant="secondary" disabled={busy} onClick={() => loadSitemap(sitemapUrl ? { url: sitemapUrl } : ({} as { url: string }))}>
            <MapIcon className="w-3.5 h-3.5" aria-hidden /> Descargar sitemap
          </Button>
          <input ref={xmlRef} type="file" accept=".xml" className="sr-only" onChange={async e => e.target.files?.[0] && loadSitemap(await e.target.files[0].text())} />
          <Button variant="secondary" disabled={busy} onClick={() => xmlRef.current?.click()}>Subir sitemap.xml</Button>
        </div>
        {status && <p role="status" className="mt-3 text-xs text-indigo-700 dark:text-indigo-300">{status}</p>}
        <div className="mt-3"><ErrorBox error={error} /></div>
      </Card>

      {loading ? (
        <Skeleton rows={5} />
      ) : !report ? (
        <Empty>Este sitio no tiene logs importados. Sube un archivo para generar el reporte.</Empty>
      ) : (
        <>
          <Card
            title={
              <span>
                Reporte: <span className="font-mono">{report.import.fileName}</span>{' '}
                {report.import.fileName.includes('synthetic') && <Badge tone="demo">DEMO</Badge>}
              </span>
            }
            actions={
              imports.length > 1 && (
                <label className="text-xs">
                  
                  <select aria-label="Importación" className={inputCls} value={report.import.id} onChange={e => setImportId(e.target.value)}>
                    {imports.map(i => (
                      <option key={i.id} value={i.id}>{i.fileName} · {fmtDate(i.createdAt)}</option>
                    ))}
                  </select>
                </label>
              )
            }
          >
            <p className="text-xs text-slate-500 mb-4">
              Periodo {fmtDate(report.import.startDate)} → {fmtDate(report.import.endDate)} · {fmt(report.import.totalLines)} líneas ({fmt(report.import.invalidLines)} inválidas,{' '}
              {fmt(report.import.skippedLines)} vacías)
            </p>
            <div className="grid grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 gap-4">
              <Kpi label="Solicitudes válidas" value={fmt(report.totals.requests)} hint={`${fmt(report.totals.botRequests)} de bots (${share(report.totals.botRequests)})`} />
              <Kpi label="Googlebot" value={fmt(report.totals.googlebotRequests)} tone="brand" hint={`${fmt(report.totals.uniqueBotUrls)} URLs distintas rastreadas por bots`} />
              <Kpi label="Bots de IA" value={fmt(report.totals.aiBotRequests)} tone="brand" hint="Crawlers de entrenamiento, búsqueda y asistentes" />
              <Kpi
                label="Desperdicio potencial"
                value={pct(report.crawlWaste.share)}
                tone={report.crawlWaste.share > 0.15 ? 'warn' : 'default'}
                hint={<span title={report.crawlWaste.label}>Hits de bots a 3xx/4xx/5xx o URLs con parámetros. Estimación, no "crawl budget".</span>}
              />
              <Kpi label="Respuestas 3xx" value={fmt(codes('3'))} hint={share(codes('3'))} />
              <Kpi label="Respuestas 4xx" value={fmt(codes('4'))} tone={codes('4') ? 'warn' : 'default'} hint={share(codes('4'))} />
              <Kpi label="Respuestas 5xx" value={fmt(codes('5'))} tone={codes('5') ? 'bad' : 'default'} hint={share(codes('5'))} />
              <Kpi
                label="Tiempo de respuesta p50 / p90 / p99"
                value={report.dataQuality.responseTimeAvailable ? `${report.responseTime.p50} · ${report.responseTime.p90} · ${report.responseTime.p99}` : '—'}
                hint={report.dataQuality.responseTimeAvailable ? 'ms, cota superior por bucket' : 'El log no incluye $request_time'}
              />
            </div>
            {report.dataQuality.aggregatesTruncated && (
              <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">Se alcanzó el límite de claves distintas; algunas URLs poco frecuentes se agruparon como "(other)".</p>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="Hits de bots por día">
              <Columns label="Hits de bots por día" data={report.botHitsByDay.map(d => ({ key: d.date, value: d.hits }))} />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>{report.botHitsByDay[0]?.date}</span>
                <span>{report.botHitsByDay.at(-1)?.date}</span>
              </div>
            </Card>
            <Card title="Hits de bots por hora (UTC)">
              <Columns label="Hits de bots por hora UTC" data={report.hourlyBotHits.map((v, h) => ({ key: String(h), value: v, label: `${h}:00 UTC` }))} />
              <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                <span>00:00</span>
                <span>23:00</span>
              </div>
            </Card>
            <Card title="Bots identificados (user agent declarado)">
              <BarList label="Hits por bot" items={toItems(report.botDistribution)} />
            </Card>
            <Card title="Verificación de crawlers por DNS">
              {!report.botVerification || !Object.keys(report.botVerification).length ? (
                <Empty>
                  {report.botVerification === null
                    ? 'La verificación no se ejecutó en esta importación (desactivada con BOT_DNS_VERIFICATION=false o sin acceso a DNS).'
                    : 'No hay visitas de buscadores que publiquen verificación por DNS.'}
                </Empty>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <caption className="sr-only">Visitas verificadas y falsas por bot</caption>
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                        <th scope="col" className="py-2">Bot declarado</th>
                        <th scope="col" className="text-right">Verificadas</th>
                        <th scope="col" className="text-right">Falsas</th>
                        <th scope="col" className="text-right">Sin comprobar</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {Object.entries(report.botVerification)
                        .sort((a, b) => b[1].claimedHits - a[1].claimedHits)
                        .map(([bot, v]) => (
                          <tr key={bot}>
                            <td className="py-1.5 font-medium">{bot}</td>
                            <td className="text-right tabular-nums">{fmt(v.verifiedHits)} <span className="text-slate-500">({pct(v.verifiedHits / Math.max(1, v.claimedHits))})</span></td>
                            <td className="text-right tabular-nums">{v.spoofedHits ? <Badge tone="bad">{fmt(v.spoofedHits)}</Badge> : '0'}</td>
                            <td className="text-right tabular-nums text-slate-500">{fmt(v.uncheckedHits + v.errorHits)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11px] text-slate-500 mt-3">
                DNS inverso + directo, el método que documentan Google, Bing, Apple, Yandex y Baidu. "Falsas" son visitas que usan el user agent del bot desde IPs que no son suyas: no
                cuentan como rastreo real. Los bots de IA (GPTBot, ClaudeBot…) no publican verificación por DNS y se muestran solo como declarados. Las IP no se guardan.
              </p>
            </Card>
            <Card title="Códigos HTTP (todo el tráfico)">
              <BarList label="Solicitudes por código HTTP" items={statusItems} />
            </Card>
            <Card title="Rastreo de bots por directorio">
              <BarList label="Hits por directorio" mono items={report.botHitsByDirectory.map(d => ({ name: d.path, value: d.hits }))} />
            </Card>
            <Card title="Visibilidad en motores de IA">
              <h3 className="text-xs font-semibold mb-2">Bots de IA</h3>
              <BarList label="Hits por bot de IA" items={toItems(report.aiBots)} />
              <h3 className="text-xs font-semibold mt-4 mb-2">Visitas humanas referidas por asistentes de IA</h3>
              {Object.keys(report.aiReferrals).length ? (
                <BarList label="Visitas por referer de IA" items={toItems(report.aiReferrals)} />
              ) : (
                <Empty>Ninguna visita con referer de ChatGPT, Perplexity, Claude, Gemini o Copilot.</Empty>
              )}
            </Card>
          </div>

          <Card title="Cobertura sitemap ↔ logs">
            {!report.sitemapCoverage ? (
              <Empty>Carga un sitemap arriba para ver qué URLs nunca visitó Googlebot y qué URLs rastreadas no están en el sitemap.</Empty>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <Kpi label="URLs en sitemap" value={fmt(report.sitemapCoverage.sitemapUrls)} />
                  <Kpi
                    label="Visitadas por Googlebot en este periodo"
                    value={pct(report.sitemapCoverage.crawledByGooglebot / Math.max(1, report.sitemapCoverage.sitemapUrls))}
                    hint={`${fmt(report.sitemapCoverage.crawledByGooglebot)} de ${fmt(report.sitemapCoverage.sitemapUrls)}`}
                  />
                  <Kpi label="Rastreadas (200) fuera del sitemap" value={fmt(report.sitemapCoverage.crawledNotInSitemapCount)} tone={report.sitemapCoverage.crawledNotInSitemapCount ? 'warn' : 'default'} />
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div>
                    <h3 className="text-xs font-semibold mb-2">En sitemap, sin visitas de Googlebot ({fmt(report.sitemapCoverage.neverCrawledCount)})</h3>
                    <UrlTable caption="URLs de sitemap sin visitas de Googlebot" empty="Googlebot visitó todas las URLs del sitemap." rows={report.sitemapCoverage.neverCrawledByGooglebot.map(p => ({ path: p, hits: 0 }))} />
                  </div>
                  <div>
                    <h3 className="text-xs font-semibold mb-2">Rastreadas con 200 pero fuera del sitemap</h3>
                    <UrlTable caption="URLs rastreadas fuera del sitemap" empty="Ninguna." rows={report.sitemapCoverage.crawledNotInSitemap} />
                  </div>
                </div>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card title="URLs más rastreadas por bots"><UrlTable caption="URLs más rastreadas" empty="Sin datos." rows={report.topBotUrls} /></Card>
            <Card title="URLs menos rastreadas por bots"><UrlTable caption="URLs menos rastreadas" empty="Sin datos." rows={report.leastCrawledBotUrls} /></Card>
            <Card title={<span>Errores 4xx vistos por bots <Badge tone="warn">4xx</Badge></span>}><UrlTable caption="Errores 4xx" empty="Ningún 4xx servido a bots." rows={report.bot4xx} /></Card>
            <Card title={<span>Errores 5xx vistos por bots <Badge tone="bad">5xx</Badge></span>}><UrlTable caption="Errores 5xx" empty="Ningún 5xx servido a bots." rows={report.bot5xx} /></Card>
            <Card title="Redirecciones rastreadas por bots"><UrlTable caption="Redirecciones" empty="Ninguna." rows={report.botRedirects} /></Card>
            <Card title="URLs con parámetros rastreadas">
              <BarList label="Parámetros más rastreados" mono items={toItems(report.crawledParameters).slice(0, 10)} />
              <div className="mt-4"><UrlTable caption="URLs con parámetros" empty="Ninguna." rows={report.botParameterUrls} /></div>
            </Card>
          </div>

          {report.import.errorSamples.length > 0 && (
            <Card title="Muestra de líneas no reconocidas (IPs redactadas)">
              <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-900 p-3 rounded-lg max-h-48 overflow-auto">{report.import.errorSamples.join('\n')}</pre>
            </Card>
          )}

          <Card title="Historial de importaciones">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <caption className="sr-only">Importaciones de logs</caption>
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th scope="col" className="py-2">Archivo</th>
                    <th scope="col">Importado</th>
                    <th scope="col" className="text-right">Líneas válidas</th>
                    <th scope="col" className="text-right">Tamaño</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className="text-right"><span className="sr-only">Acciones</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {imports.map(i => (
                    <tr key={i.id}>
                      <td className="py-2 font-mono">{i.fileName}</td>
                      <td className="text-slate-500">{fmtDate(i.createdAt)}</td>
                      <td className="text-right tabular-nums">{fmt(i.validLines)}</td>
                      <td className="text-right tabular-nums">{(i.fileSizeBytes / 1024 ** 2).toFixed(1)} MB</td>
                      <td><Badge tone={i.status === 'completed' ? 'good' : i.status === 'failed' ? 'bad' : 'warn'}>{i.status}</Badge></td>
                      <td className="text-right">
                        <Button variant="secondary" aria-label={`Eliminar ${i.fileName}`} onClick={() => remove(i)}>
                          <Trash2 className="w-3.5 h-3.5" aria-hidden /> Eliminar
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
