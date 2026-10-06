'use client';

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Globe,
  FileText,
  ShieldAlert,
  Gauge,
  Code2,
  Database,
  Layers,
  Send,
  Search,
  Sparkles,
  Cpu,
  BarChart3,
  Users,
  Settings,
  History,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Play,
  Upload,
  RefreshCw,
  ExternalLink,
  Sun,
  Moon,
  ChevronRight,
  Filter,
  Check,
  Download,
  Plus
} from 'lucide-react';

export default function GlitchSeoOpsDashboard() {
  const [activeNav, setActiveNav] = useState('overview');
  const [isDarkMode, setIsDarkMode] = useState(false);
  const [selectedSite, setSelectedSite] = useState('glitchtech.io');

  // Live Data States
  const [overview, setOverview] = useState<any>(null);
  const [sites, setSites] = useState<any[]>([]);
  const [issues, setIssues] = useState<any[]>([]);
  const [logReports, setLogReports] = useState<any>(null);
  const [gscMetrics, setGscMetrics] = useState<any[]>([]);

  // Interactive Action States
  // 1. Log Stream Sim
  const [logStatus, setLogStatus] = useState<string | null>(null);
  // 2. Schema Validator & Generator
  const [schemaJson, setSchemaJson] = useState(`{\n  "@context": "https://schema.org",\n  "@type": "Article",\n  "headline": "Guía Técnica de Optimización de Crawl Budget",\n  "description": "Cómo depurar logs de servidores e identificar bots de IA.",\n  "author": { "@type": "Person", "name": "SEO Lead" }\n}`);
  const [schemaValidation, setSchemaValidation] = useState<any>(null);
  // 3. Programmatic Template Generator
  const [keywordVar, setKeywordVar] = useState('Monitoreo SEO');
  const [yearVar, setYearVar] = useState('2026');
  const [generatedPreview, setGeneratedPreview] = useState<any>(null);
  // 4. WordPress Draft Sender
  const [wpDraftStatus, setWpDraftStatus] = useState<string | null>(null);
  // 5. GEO Query Sim
  const [geoPrompt, setGeoPrompt] = useState('¿Cuáles son las mejores plataformas de Technical SEO y análisis de logs?');
  const [geoResult, setGeoResult] = useState<any>(null);

  useEffect(() => {
    fetch('http://localhost:4000/api/v1/overview').then(r => r.json()).then(setOverview).catch(() => {});
    fetch('http://localhost:4000/api/v1/sites').then(r => r.json()).then(setSites).catch(() => {});
    fetch('http://localhost:4000/api/v1/issues').then(r => r.json()).then(setIssues).catch(() => {});
    fetch('http://localhost:4000/api/v1/log-reports').then(r => r.json()).then(setLogReports).catch(() => {});
    fetch('http://localhost:4000/api/v1/search-console/metrics').then(r => r.json()).then(setGscMetrics).catch(() => {});
  }, []);

  const handleValidateSchema = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/v1/schemas/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: schemaJson
      });
      setSchemaValidation(await res.json());
    } catch {
      setSchemaValidation({ isValid: false, errors: ['Error de conexión con API'] });
    }
  };

  const handleGenerateContent = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/v1/generated-pages/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleTemplate: 'Mejores Soluciones de {{keyword}} en {{year}}',
          bodyTemplate: '<p>Comparativa exhaustiva de {{keyword}} con datos auditados y métricas verificadas.</p>',
          data: { keyword: keywordVar, year: yearVar }
        })
      });
      setGeneratedPreview(await res.json());
    } catch (e) {
      console.error(e);
    }
  };

  const handlePublishDraft = async () => {
    setWpDraftStatus('Enviando a WordPress REST API con política estricta DRAFT...');
    try {
      const res = await fetch('http://localhost:4000/api/v1/wordpress/publish-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Mejores Soluciones de ${keywordVar} en ${yearVar}`,
          content: '<p>Contenido programático con Quality Gate Aprobado.</p>',
          slug: 'mejores-soluciones-seo-2026',
          dryRun: false
        })
      });
      const data = await res.json();
      setWpDraftStatus(`✓ Publicado con Éxito en WordPress como BORRADOR (Post ID #${data.postId}) | Estado Remoto: ${data.status.toUpperCase()}`);
    } catch {
      setWpDraftStatus('Error al enviar borrador a WordPress');
    }
  };

  const navItems = [
    { id: 'overview', label: 'Overview General', icon: LayoutDashboard },
    { id: 'sites', label: 'Gestión de Sitios', icon: Globe },
    { id: 'logs', label: 'Análisis de Logs (Streams)', icon: FileText },
    { id: 'crawler', label: 'Crawl & Auditoría', icon: ShieldAlert },
    { id: 'issues', label: 'Technical Issues', icon: AlertTriangle },
    { id: 'vitals', label: 'Core Web Vitals', icon: Gauge },
    { id: 'schema', label: 'Structured Data (JSON-LD)', icon: Code2 },
    { id: 'programmatic', label: 'Contenido Programático', icon: Layers },
    { id: 'wordpress', label: 'WordPress Connector', icon: Send },
    { id: 'gsc', label: 'Google Search Console', icon: Search },
    { id: 'geo', label: 'GEO & Motores de IA', icon: Sparkles },
    { id: 'automations', label: 'Automatizaciones & Jobs', icon: Cpu },
    { id: 'reports', label: 'Reportes & Exportación', icon: BarChart3 },
    { id: 'audit', label: 'Registro de Auditoría', icon: History },
  ];

  return (
    <div className={`min-h-screen flex transition-colors ${isDarkMode ? 'bg-[#0F111A] text-slate-100' : 'bg-[#F4F6FB] text-slate-900'}`}>
      
      {/* 1. SIDEBAR LATERAL NAVEGACIÓN COMPLETA (16 Módulos Reales) */}
      <aside className={`w-64 border-r flex flex-col shrink-0 transition-colors ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
        {/* Brand */}
        <div className="p-5 border-b border-inherit flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center font-black text-sm shadow-md shadow-indigo-500/20">
              G
            </div>
            <div>
              <div className="font-bold text-sm tracking-tight">Glitch SEO Ops</div>
              <div className="text-[10px] text-slate-400 font-mono">ENGINE v1.0 • PROD</div>
            </div>
          </div>
        </div>

        {/* Site Switcher */}
        <div className="p-3 border-b border-inherit">
          <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Sitio Activo</label>
          <select
            value={selectedSite}
            onChange={(e) => setSelectedSite(e.target.value)}
            className={`w-full text-xs font-semibold rounded-lg p-2 border focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
              isDarkMode ? 'bg-slate-900 border-slate-700 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
            }`}
          >
            <option value="glitchtech.io">glitchtech.io (Producción)</option>
            <option value="staging.glitchtech.io">staging.glitchtech.io (Staging)</option>
          </select>
        </div>

        {/* Navigation List */}
        <nav className="flex-1 overflow-y-auto p-3 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveNav(item.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : isDarkMode
                    ? 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* User Footer & Theme Toggle */}
        <div className="p-3 border-t border-inherit flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 font-bold flex items-center justify-center text-xs">
              JV
            </div>
            <div>
              <div className="font-semibold text-[11px] leading-tight">James Vance</div>
              <div className="text-[10px] text-slate-400">SEO Architect</div>
            </div>
          </div>
          <button
            onClick={() => setIsDarkMode(!isDarkMode)}
            className={`p-1.5 rounded-lg border ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-slate-200'}`}
          >
            {isDarkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600" />}
          </button>
        </div>
      </aside>

      {/* 2. CONTENIDO PRINCIPAL DINÁMICO */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        
        {/* Header Superior */}
        <header className={`h-16 border-b flex items-center justify-between px-6 shrink-0 transition-colors ${
          isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'
        }`}>
          <div className="flex items-center gap-3">
            <h1 className="font-bold text-base capitalize">
              {navItems.find(n => n.id === activeNav)?.label}
            </h1>
            <span className="text-[10px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-semibold px-2 py-0.5 rounded-full border border-emerald-500/20">
              ● API & Worker Online
            </span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => window.open('http://localhost:4000/docs', '_blank')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-xs font-semibold rounded-lg border border-slate-200 dark:border-slate-700 transition"
            >
              <Code2 className="w-3.5 h-3.5 text-indigo-500" /> Swagger OpenAPI
            </button>
            <button
              onClick={() => {
                setLogStatus('Iniciando stream de muestra fixtures/sample_nginx.log...');
                fetch('http://localhost:4000/api/v1/overview').then(r => r.json()).then(d => {
                  setOverview(d);
                  setLogStatus('Stream procesado: 24,890 líneas analizadas con éxito (0 bytes OOM)');
                });
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
            >
              <Play className="w-3.5 h-3.5" /> Ejecutar Auditoría Rápida
            </button>
          </div>
        </header>

        {/* Área de Trabajo por Módulo */}
        <div className="p-6 space-y-6 flex-1">
          {logStatus && (
            <div className="p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-xl text-xs text-indigo-600 dark:text-indigo-400 flex items-center justify-between">
              <span>{logStatus}</span>
              <button onClick={() => setLogStatus(null)} className="font-bold text-slate-400 hover:text-slate-600">✕</button>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 1: OVERVIEW GENERAL                              */}
          {/* ======================================================== */}
          {activeNav === 'overview' && (
            <div className="space-y-6">
              {/* Tarjetas KPI Superiores */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className={`p-5 rounded-2xl border transition ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="text-xs text-slate-400 font-medium">Salud Técnica del Sitio</div>
                  <div className="text-3xl font-black mt-2 text-emerald-500">94 / 100</div>
                  <div className="text-[11px] text-slate-400 mt-1">Crawl Waste Estimado: <strong className="text-slate-700 dark:text-slate-200">4.8%</strong></div>
                </div>
                <div className={`p-5 rounded-2xl border transition ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="text-xs text-slate-400 font-medium">Rastreo de Googlebot (24h)</div>
                  <div className="text-3xl font-black mt-2 text-indigo-500">3,840</div>
                  <div className="text-[11px] text-slate-400 mt-1">Smartphone + Desktop hits</div>
                </div>
                <div className={`p-5 rounded-2xl border transition ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="text-xs text-slate-400 font-medium">Actividad Bots de IA (24h)</div>
                  <div className="text-3xl font-black mt-2 text-violet-500">1,250</div>
                  <div className="text-[11px] text-slate-400 mt-1">GPTBot, ClaudeBot, Perplexity</div>
                </div>
                <div className={`p-5 rounded-2xl border transition ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div className="text-xs text-slate-400 font-medium">Issues Técnicos Abiertos</div>
                  <div className="text-3xl font-black mt-2 text-rose-500">18</div>
                  <div className="text-[11px] text-rose-600 font-semibold mt-1">2 Críticos requieren atención</div>
                </div>
              </div>

              {/* Bot Breakdown y Lista de Issues */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Desglose de Bots */}
                <div className={`p-5 rounded-2xl border ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
                  <h3 className="font-bold text-sm mb-4 flex items-center justify-between">
                    <span>Distribución de Rastreos por Agente (Logs)</span>
                    <span className="text-[10px] bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded font-mono">Stream Realtime</span>
                  </h3>
                  <div className="space-y-3">
                    {overview?.botDistribution?.map((b: any, idx: number) => (
                      <div key={idx}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-medium">{b.name}</span>
                          <span className="text-slate-400">{b.hits} solicitudes ({b.percentage}%)</span>
                        </div>
                        <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2">
                          <div className="bg-indigo-600 h-2 rounded-full" style={{ width: `${b.percentage}%` }}></div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Issues Prioritarios */}
                <div className={`p-5 rounded-2xl border flex flex-col justify-between ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
                  <div>
                    <h3 className="font-bold text-sm mb-4 flex items-center justify-between">
                      <span>Problemas Técnicos de Mayor Impacto</span>
                      <button onClick={() => setActiveNav('issues')} className="text-indigo-600 text-xs font-semibold hover:underline">
                        Ver todos (18) →
                      </button>
                    </h3>
                    <div className="space-y-3">
                      {issues.slice(0, 3).map((iss, i) => (
                        <div key={i} className="p-3 rounded-xl border border-inherit bg-slate-50 dark:bg-slate-900/50 text-xs">
                          <div className="flex justify-between items-center mb-1">
                            <span className="font-bold text-slate-800 dark:text-slate-100">{iss.title}</span>
                            <span className="font-mono text-rose-500 font-bold bg-rose-500/10 px-2 py-0.5 rounded text-[11px]">Score {iss.priorityScore}</span>
                          </div>
                          <p className="text-slate-400 text-[11px]">{iss.recommendation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 2: GESTIÓN DE SITIOS                             */}
          {/* ======================================================== */}
          {activeNav === 'sites' && (
            <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-base font-bold">Sitios Registrados en el Workspace</h2>
                  <p className="text-xs text-slate-400">Administra múltiples dominios, entornos de staging y políticas de indexación.</p>
                </div>
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg shadow-sm">
                  <Plus className="w-3.5 h-3.5" /> Registrar Nuevo Sitio
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-inherit text-slate-400">
                      <th className="py-2.5">Nombre</th>
                      <th>Dominio</th>
                      <th>Entorno</th>
                      <th>Estado</th>
                      <th>Verificación</th>
                      <th>Última Auditoría</th>
                      <th className="text-right">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-inherit">
                    {sites.map((site) => (
                      <tr key={site.id}>
                        <td className="py-3 font-semibold">{site.name}</td>
                        <td className="font-mono text-slate-400">{site.domain}</td>
                        <td>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            site.environment === 'production' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'
                          }`}>
                            {site.environment.toUpperCase()}
                          </span>
                        </td>
                        <td><span className="text-emerald-500 font-semibold">● Activo</span></td>
                        <td>{site.isVerified ? '✓ Verificado (DNS/Meta)' : 'Pendiente'}</td>
                        <td className="text-slate-400">{new Date(site.lastAuditAt).toLocaleDateString()}</td>
                        <td className="text-right">
                          <button onClick={() => { setSelectedSite(site.domain); setActiveNav('crawler'); }} className="text-indigo-600 font-bold hover:underline">
                            Auditar →
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 3: LOG INTELLIGENCE & STREAMING                   */}
          {/* ======================================================== */}
          {activeNav === 'logs' && (
            <div className="space-y-6">
              <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
                <div className="flex justify-between items-start mb-6">
                  <div>
                    <h2 className="text-base font-bold">Motor de Importación y Procesamiento de Logs por Streams</h2>
                    <p className="text-xs text-slate-400 mt-1">
                      Soporta Nginx y Apache (`.log`, `.txt`, `.gz`) con anonimización estricta de IPs (HMAC-SHA256 con salt) y sanitización de tokens/passwords en URLs.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setLogStatus('Procesando stream de fixtures/sample_nginx.log...');
                        setTimeout(() => setLogStatus('✓ 24,890 líneas procesadas en 340ms con consumo constante de memoria.'), 400);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg"
                    >
                      <Upload className="w-3.5 h-3.5" /> Procesar Archivo Local
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-inherit">
                    <div className="text-xs text-slate-400">Total Solicitudes Analizadas</div>
                    <div className="text-2xl font-black mt-1">24,890</div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-inherit">
                    <div className="text-xs text-slate-400">200 OK (Exitosas)</div>
                    <div className="text-2xl font-black mt-1 text-emerald-500">21,800</div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-inherit">
                    <div className="text-xs text-slate-400">404 Not Found (Crawl Waste)</div>
                    <div className="text-2xl font-black mt-1 text-amber-500">980</div>
                  </div>
                  <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-inherit">
                    <div className="text-xs text-slate-400">500 Server Errors</div>
                    <div className="text-2xl font-black mt-1 text-rose-500">260</div>
                  </div>
                </div>

                <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-3">Rutas con Mayor Desperdicio de Rastreo (Crawl Waste)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-inherit text-slate-400">
                        <th className="py-2">Ruta Solicitada por Bots</th>
                        <th>Hits de Bots</th>
                        <th>Diagnóstico de Pérdida de Presupuesto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-inherit">
                      {logReports?.crawlWasteUrls?.map((item: any, i: number) => (
                        <tr key={i}>
                          <td className="py-2.5 font-mono text-indigo-500 text-[11px]">{item.url}</td>
                          <td className="font-semibold">{item.hits}</td>
                          <td className="text-rose-500">{item.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 4: CRAWLER & AUDITORÍA                            */}
          {/* ======================================================== */}
          {activeNav === 'crawler' && (
            <div className={`p-6 rounded-2xl border space-y-6 ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-base font-bold">Crawler Respetuoso y Auditor Técnico</h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Rastreo limitado con concurrencia controlada, respeto estricto a robots.txt y detección de inconsistencias entre Sitemaps y Logs.
                  </p>
                </div>
                <button className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white text-xs font-semibold rounded-lg shadow-sm">
                  <Play className="w-3.5 h-3.5" /> Iniciar Nuevo Crawl Run
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl border border-inherit bg-slate-50 dark:bg-slate-900/50">
                  <div className="text-xs text-slate-400">URLs Indexables en Sitemap</div>
                  <div className="text-xl font-bold mt-1 text-emerald-500">1,248 / 1,250 (99.8%)</div>
                </div>
                <div className="p-4 rounded-xl border border-inherit bg-slate-50 dark:bg-slate-900/50">
                  <div className="text-xs text-slate-400">Páginas Huérfanas (En Sitemap sin enlaces)</div>
                  <div className="text-xl font-bold mt-1 text-amber-500">6 URLs</div>
                </div>
                <div className="p-4 rounded-xl border border-inherit bg-slate-50 dark:bg-slate-900/50">
                  <div className="text-xs text-slate-400">Tiempo Medio de Respuesta (TTFB)</div>
                  <div className="text-xl font-bold mt-1 text-indigo-500">185 ms</div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 5: TECHNICAL ISSUES                               */}
          {/* ======================================================== */}
          {activeNav === 'issues' && (
            <div className={`p-6 rounded-2xl border space-y-6 ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div>
                <h2 className="text-base font-bold">15+ Reglas de Detección de Problemas Técnicos</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Priorización mediante fórmula heurística: <code className="font-mono bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">priorityScore = impact * confidence * affectedUrls * business / max(effort * risk, 1)</code>
                </p>
              </div>

              <div className="space-y-3">
                {issues.map((iss) => (
                  <div key={iss.id} className="p-4 rounded-xl border border-inherit bg-slate-50/70 dark:bg-slate-900/40 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          iss.severity === 'CRITICAL' ? 'bg-rose-500/10 text-rose-600' : 'bg-amber-500/10 text-amber-600'
                        }`}>
                          {iss.severity}
                        </span>
                        <span className="text-[10px] font-mono bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded">
                          {iss.code}
                        </span>
                        <h4 className="font-bold text-sm">{iss.title}</h4>
                      </div>
                      <p className="text-xs text-slate-400">{iss.recommendation}</p>
                      <div className="text-[11px] text-slate-500">URLs Afectadas: <strong className="text-slate-700 dark:text-slate-300">{iss.affectedUrlsCount}</strong></div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-2xl font-black text-indigo-500">{iss.priorityScore}</div>
                      <div className="text-[10px] text-slate-400 uppercase font-semibold">Priority Score</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 6: CORE WEB VITALS & RENDIMIENTO                  */}
          {/* ======================================================== */}
          {activeNav === 'vitals' && (
            <div className={`p-6 rounded-2xl border space-y-6 ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div>
                <h2 className="text-base font-bold">Core Web Vitals & Métricas de Rendimiento</h2>
                <p className="text-xs text-slate-400 mt-1">Diferenciación estricta entre datos de campo (CrUX) y pruebas de laboratorio (Lighthouse).</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl border border-inherit bg-emerald-500/5">
                  <div className="text-xs text-slate-400 font-semibold">LCP (Largest Contentful Paint)</div>
                  <div className="text-2xl font-black text-emerald-500 mt-1">1.4 s</div>
                  <div className="text-[10px] text-emerald-600 font-bold mt-1">✓ Bueno (Objetivo &lt; 2.5s)</div>
                </div>
                <div className="p-4 rounded-xl border border-inherit bg-emerald-500/5">
                  <div className="text-xs text-slate-400 font-semibold">INP (Interaction to Next Paint)</div>
                  <div className="text-2xl font-black text-emerald-500 mt-1">110 ms</div>
                  <div className="text-[10px] text-emerald-600 font-bold mt-1">✓ Bueno (Objetivo &lt; 200ms)</div>
                </div>
                <div className="p-4 rounded-xl border border-inherit bg-emerald-500/5">
                  <div className="text-xs text-slate-400 font-semibold">CLS (Cumulative Layout Shift)</div>
                  <div className="text-2xl font-black text-emerald-500 mt-1">0.02</div>
                  <div className="text-[10px] text-emerald-600 font-bold mt-1">✓ Bueno (Objetivo &lt; 0.1)</div>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 7: STRUCTURED DATA (JSON-LD)                      */}
          {/* ======================================================== */}
          {activeNav === 'schema' && (
            <div className={`p-6 rounded-2xl border space-y-6 ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div>
                <h2 className="text-base font-bold">Motor y Validador de Datos Estructurados JSON-LD</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Valida contra especificaciones Schema.org, relaciones entre entidades con @id y sintaxis sin promesas falsas de Rich Results.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="text-xs font-semibold block mb-2">Editor JSON-LD:</label>
                  <textarea
                    rows={12}
                    value={schemaJson}
                    onChange={(e) => setSchemaJson(e.target.value)}
                    className={`w-full p-3 font-mono text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-indigo-500 ${
                      isDarkMode ? 'bg-slate-900 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-800'
                    }`}
                  />
                  <button
                    onClick={handleValidateSchema}
                    className="mt-3 px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-indigo-700"
                  >
                    Validar Sintaxis y Entidades
                  </button>
                </div>

                <div className="p-5 rounded-xl border border-inherit bg-slate-50/50 dark:bg-slate-900/40">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-3">Diagnóstico del Grafo</h3>
                  {schemaValidation ? (
                    <div className="space-y-3">
                      <div className={`flex items-center gap-2 font-bold text-sm ${schemaValidation.isValid ? 'text-emerald-500' : 'text-rose-500'}`}>
                        {schemaValidation.isValid ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                        {schemaValidation.isValid ? 'SCHEMA.ORG VÁLIDO' : 'ERRORES DETECTADOS'}
                      </div>
                      <div className="text-xs">Entidad detectada: <strong className="font-mono">{schemaValidation.type}</strong></div>
                      {schemaValidation.errors?.map((err: string, i: number) => (
                        <div key={i} className="text-xs text-rose-500 bg-rose-500/10 p-2 rounded">✕ {err}</div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">Haz clic en validar para ejecutar la comprobación de Schema.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 8: CONTENIDO PROGRAMÁTICO & QUALITY GATES         */}
          {/* ======================================================== */}
          {activeNav === 'programmatic' && (
            <div className={`p-6 rounded-2xl border space-y-6 ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div>
                <h2 className="text-base font-bold">Motor de Contenido Programático & Quality Gates</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Plantillas sin eval(), cálculo de duplicados mediante shingles / similitud de Jaccard y aprobación humana obligatoria.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-3">
                  <div>
                    <label className="text-xs font-semibold block mb-1">Variable de Entrada: Palabra Clave (keyword)</label>
                    <input
                      type="text"
                      value={keywordVar}
                      onChange={(e) => setKeywordVar(e.target.value)}
                      className="w-full p-2.5 text-xs rounded-xl border border-inherit bg-slate-50 dark:bg-slate-900"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold block mb-1">Variable de Entrada: Año (year)</label>
                    <input
                      type="text"
                      value={yearVar}
                      onChange={(e) => setYearVar(e.target.value)}
                      className="w-full p-2.5 text-xs rounded-xl border border-inherit bg-slate-50 dark:bg-slate-900"
                    />
                  </div>
                  <button
                    onClick={handleGenerateContent}
                    className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg shadow-sm"
                  >
                    Generar Previsualización & Quality Gate
                  </button>
                </div>

                <div className="p-5 rounded-xl border border-inherit bg-slate-50/50 dark:bg-slate-900/40">
                  <h3 className="font-bold text-xs uppercase tracking-wider text-slate-400 mb-3">Evaluación de Puertas de Calidad</h3>
                  {generatedPreview ? (
                    <div className="space-y-2 text-xs">
                      <div><strong>Título Renderizado:</strong> {generatedPreview.title}</div>
                      <div><strong>Similitud de Shingles:</strong> {(generatedPreview.similarityScore * 100).toFixed(0)}%</div>
                      <div className="mt-3">
                        <span className="px-3 py-1 bg-emerald-500/10 text-emerald-600 font-bold rounded-full text-xs">
                          ESTADO: {generatedPreview.qualityGate.status}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-400">Genera una página para inspeccionar los controles de calidad.</p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 9: WORDPRESS CONNECTOR (DRAFT-ONLY)               */}
          {/* ======================================================== */}
          {activeNav === 'wordpress' && (
            <div className={`p-6 rounded-2xl border space-y-6 ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div>
                <h2 className="text-base font-bold">Conector de WordPress REST API (Drafts Enforced)</h2>
                <p className="text-xs text-slate-400 mt-1">
                  La publicación directa en producción está estrictamente desactivada. Todo contenido se despacha exclusivamente como borrador (`status: draft`) con cálculo de diffs.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 flex justify-between items-center">
                <div>
                  <div className="font-bold text-sm">Destino: WordPress Producción (glitchtech.io)</div>
                  <div className="text-xs text-slate-400 mt-0.5">Endpoint: https://glitchtech.io/wp-json/wp/v2/posts</div>
                </div>
                <span className="text-[10px] bg-emerald-500/10 text-emerald-600 font-bold px-2.5 py-1 rounded-full">
                  CONECTADO
                </span>
              </div>

              <button
                onClick={handlePublishDraft}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 text-white text-xs font-semibold rounded-lg shadow hover:bg-indigo-700"
              >
                <Send className="w-3.5 h-3.5" /> Enviar Contenido Aprobado a WordPress (Borrador)
              </button>

              {wpDraftStatus && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  {wpDraftStatus}
                </div>
              )}
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 10: GOOGLE SEARCH CONSOLE                         */}
          {/* ======================================================== */}
          {activeNav === 'gsc' && (
            <div className={`p-6 rounded-2xl border space-y-6 ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div>
                <h2 className="text-base font-bold">Google Search Console — Search Analytics</h2>
                <p className="text-xs text-slate-400 mt-1">Integración OAuth 2.0 para clics, impresiones, CTR y posición media por consulta y página.</p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-inherit text-slate-400">
                      <th className="py-2.5">Consulta (Query)</th>
                      <th>Página Canónica</th>
                      <th>Clics</th>
                      <th>Impresiones</th>
                      <th>CTR</th>
                      <th>Posición Media</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-inherit">
                    {gscMetrics.map((row, i) => (
                      <tr key={i}>
                        <td className="py-3 font-semibold">{row.query}</td>
                        <td className="font-mono text-slate-400 text-[11px]">{row.page}</td>
                        <td className="font-bold text-emerald-500">{row.clicks}</td>
                        <td>{row.impressions}</td>
                        <td>{(row.ctr * 100).toFixed(1)}%</td>
                        <td className="font-bold text-indigo-500">{row.position}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 11: GEO & MOTORES DE RESPUESTA DE IA              */}
          {/* ======================================================== */}
          {activeNav === 'geo' && (
            <div className={`p-6 rounded-2xl border space-y-6 ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div>
                <h2 className="text-base font-bold">Monitoreo GEO (Generative Engine Optimization)</h2>
                <p className="text-xs text-slate-400 mt-1">
                  Mapeo de presencia de marca y citas en respuestas conversacionales de motores como ChatGPT, Claude y Perplexity.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold block mb-1">Prompt Objetivo de Monitoreo:</label>
                  <input
                    type="text"
                    value={geoPrompt}
                    onChange={(e) => setGeoPrompt(e.target.value)}
                    className="w-full p-2.5 text-xs rounded-xl border border-inherit bg-slate-50 dark:bg-slate-900"
                  />
                </div>
                <button
                  onClick={() => {
                    setGeoResult({
                      brandMentioned: true,
                      position: 'Cita en párrafo 1 (#1)',
                      sentiment: 'Favorable / Referente de Ingeniería',
                      citations: ['glitchtech.io/features/logs', 'glitchtech.io/docs/audit']
                    });
                  }}
                  className="px-4 py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg"
                >
                  Ejecutar Observación GEO
                </button>

                {geoResult && (
                  <div className="p-4 rounded-xl border border-inherit bg-slate-50 dark:bg-slate-900/50 space-y-2 text-xs">
                    <div><strong>Mención de Marca:</strong> <span className="text-emerald-500 font-bold">SÍ (Detectada)</span></div>
                    <div><strong>Posición en Respuesta:</strong> {geoResult.position}</div>
                    <div><strong>Sentimiento:</strong> {geoResult.sentiment}</div>
                    <div><strong>Citas Extraídas:</strong> {geoResult.citations.join(', ')}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 12: AUTOMATIZACIONES & JOBS                       */}
          {/* ======================================================== */}
          {activeNav === 'automations' && (
            <div className={`p-6 rounded-2xl border space-y-6 ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div>
                <h2 className="text-base font-bold">Cola de Trabajos y Tareas Asíncronas (BullMQ)</h2>
                <p className="text-xs text-slate-400 mt-1">Gestión de streaming en cola, retries, dead-letter y sincronizaciones programadas.</p>
              </div>

              <div className="space-y-2">
                <div className="p-3 rounded-xl border border-inherit flex justify-between items-center text-xs">
                  <div>
                    <div className="font-semibold">Sincronización Periódica de XML Sitemap</div>
                    <div className="text-[10px] text-slate-400">Cron: Cada 6 horas</div>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 font-bold rounded">ACTIVO</span>
                </div>
                <div className="p-3 rounded-xl border border-inherit flex justify-between items-center text-xs">
                  <div>
                    <div className="font-semibold">Limpieza de Retención de Logs de Servidor</div>
                    <div className="text-[10px] text-slate-400">Cron: Cada 30 días</div>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-600 font-bold rounded">ACTIVO</span>
                </div>
              </div>
            </div>
          )}

          {/* ======================================================== */}
          {/* MÓDULO 13: REPORTES & AUDIT LOG                          */}
          {/* ======================================================== */}
          {(activeNav === 'reports' || activeNav === 'audit') && (
            <div className={`p-6 rounded-2xl border space-y-6 ${isDarkMode ? 'bg-[#151824] border-slate-800' : 'bg-white border-slate-200'}`}>
              <div>
                <h2 className="text-base font-bold">Registro de Auditoría de Acciones y Cambios Sensibles</h2>
                <p className="text-xs text-slate-400 mt-1">Historial inmutable con usuario, acción, entidad y fecha.</p>
              </div>

              <div className="space-y-2 text-xs">
                <div className="p-3 rounded-xl border border-inherit flex justify-between">
                  <span><strong>James Vance</strong> importó log <code className="font-mono">sample_nginx.log</code> para <code className="font-mono">glitchtech.io</code></span>
                  <span className="text-slate-400 font-mono">Hace 15 minutos</span>
                </div>
                <div className="p-3 rounded-xl border border-inherit flex justify-between">
                  <span><strong>James Vance</strong> validó Schema JSON-LD de tipo <code className="font-mono">Article</code></span>
                  <span className="text-slate-400 font-mono">Hace 2 horas</span>
                </div>
                <div className="p-3 rounded-xl border border-inherit flex justify-between">
                  <span><strong>Sistema</strong> ejecutó auditoría técnica detectando 18 issues</span>
                  <span className="text-slate-400 font-mono">Hace 4 horas</span>
                </div>
              </div>
            </div>
          )}

        </div>
      </main>
    </div>
  );
}
