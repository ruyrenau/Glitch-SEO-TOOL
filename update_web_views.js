const fs = require('fs');

const fullPageCode = `'use client';

import React, { useState, useEffect } from 'react';
import {
  LayoutDashboard,
  Workflow,
  Network,
  Search,
  Sun,
  Moon,
  Bell,
  Settings,
  Download,
  Plus,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  Bot,
  Activity,
  Layers,
  Sparkles,
  ChevronRight,
  ArrowUpRight,
  Check,
  MoreVertical,
  ExternalLink,
  ShieldCheck,
  FileCode,
  Send,
  RefreshCw,
  Eye,
  Sliders,
  Copy,
  FolderOpen
} from 'lucide-react';

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'logs' | 'issues' | 'schemas' | 'content' | 'wordpress' | 'gsc'>('dashboard');
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Live data fetched from API
  const [overview, setOverview] = useState<any>(null);
  const [issues, setIssues] = useState<any[]>([]);
  const [logReports, setLogReports] = useState<any>(null);
  const [gscMetrics, setGscMetrics] = useState<any[]>([]);

  // Interactive Form States
  // 1. Schema Validator
  const [jsonLdInput, setJsonLdInput] = useState(\`{\\n  "@context": "https://schema.org",\\n  "@type": "Article",\\n  "headline": "Guía Avanzada de Technical SEO",\\n  "description": "Análisis exhaustivo de rastreo e indexación con logs y schemas.",\\n  "author": { "@type": "Person", "name": "James Vance" }\\n}\`);
  const [schemaResult, setSchemaResult] = useState<any>(null);

  // 2. Programmatic Content Preview
  const [templateKeyword, setTemplateKeyword] = useState('Herramientas SEO');
  const [templateYear, setTemplateYear] = useState('2026');
  const [previewContent, setPreviewContent] = useState<any>(null);

  // 3. WordPress Draft Action
  const [wpStatus, setWpStatus] = useState<string | null>(null);

  // 4. Log upload test
  const [logAnalysisMessage, setLogAnalysisMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('http://localhost:4000/api/v1/overview')
      .then(res => res.json())
      .then(data => setOverview(data))
      .catch(() => {});

    fetch('http://localhost:4000/api/v1/issues')
      .then(res => res.json())
      .then(data => setIssues(data))
      .catch(() => {});

    fetch('http://localhost:4000/api/v1/log-reports')
      .then(res => res.json())
      .then(data => setLogReports(data))
      .catch(() => {});

    fetch('http://localhost:4000/api/v1/search-console/metrics')
      .then(res => res.json())
      .then(data => setGscMetrics(data))
      .catch(() => {});
  }, []);

  const handleValidateSchema = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/v1/schemas/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonLdInput
      });
      const data = await res.json();
      setSchemaResult(data);
    } catch {
      setSchemaResult({ isValid: false, errors: ['Error conectando con la API'] });
    }
  };

  const handlePreviewPage = async () => {
    try {
      const res = await fetch('http://localhost:4000/api/v1/generated-pages/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleTemplate: 'Top {{keyword}} para {{year}} - Comparativa Completa',
          bodyTemplate: '<p>Descubre las mejores {{keyword}} del mercado en {{year}} con métricas auditadas.</p>',
          data: { keyword: templateKeyword, year: templateYear }
        })
      });
      const data = await res.json();
      setPreviewContent(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handlePublishWpDraft = async () => {
    setWpStatus('Enviando borrador protegido...');
    try {
      const res = await fetch('http://localhost:4000/api/v1/wordpress/publish-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: \`Top \${templateKeyword} para \${templateYear}\`,
          content: '<p>Contenido programático con Quality Gate Aprobado.</p>',
          slug: 'top-herramientas-seo-2026',
          dryRun: false
        })
      });
      const data = await res.json();
      setWpStatus(\`¡Éxito! Creado en WordPress como Borrador (ID: \${data.postId}) | Estado forzado: \${data.status.toUpperCase()}\`);
    } catch {
      setWpStatus('Error enviando borrador a WordPress');
    }
  };

  return (
    <div className={\`min-h-screen p-4 md:p-8 flex items-center justify-center transition-colors \${isDarkMode ? 'bg-[#0E1017] text-white' : 'bg-[#EEF0F8] text-[#1E2132]'}\`}>
      <div className={\`w-full max-w-[1440px] rounded-[36px] shadow-2xl p-4 md:p-8 relative overflow-hidden border transition-colors \${
        isDarkMode ? 'bg-[#151722] border-gray-800' : 'bg-[#F4F6FC] border-white/60'
      }\`}>
        
        {/* TOP BAR WITH EXTENDED FUNCTIONAL MODULE TABS */}
        <header className="flex flex-wrap items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-2 md:gap-5 overflow-x-auto pb-1">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={\`flex items-center gap-1.5 pb-1 font-semibold text-xs md:text-sm transition-all \${
                activeTab === 'dashboard' ? 'text-[#5E5CE6] border-b-2 border-[#5E5CE6]' : 'text-[#8E95A5]'
              }\`}
            >
              <LayoutDashboard className="w-4 h-4" />
              Overview
            </button>
            <button
              onClick={() => setActiveTab('logs')}
              className={\`flex items-center gap-1.5 pb-1 font-semibold text-xs md:text-sm transition-all \${
                activeTab === 'logs' ? 'text-[#5E5CE6] border-b-2 border-[#5E5CE6]' : 'text-[#8E95A5]'
              }\`}
            >
              <Activity className="w-4 h-4" />
              Log Intelligence
            </button>
            <button
              onClick={() => setActiveTab('issues')}
              className={\`flex items-center gap-1.5 pb-1 font-semibold text-xs md:text-sm transition-all \${
                activeTab === 'issues' ? 'text-[#5E5CE6] border-b-2 border-[#5E5CE6]' : 'text-[#8E95A5]'
              }\`}
            >
              <ShieldCheck className="w-4 h-4" />
              Technical Issues
            </button>
            <button
              onClick={() => setActiveTab('schemas')}
              className={\`flex items-center gap-1.5 pb-1 font-semibold text-xs md:text-sm transition-all \${
                activeTab === 'schemas' ? 'text-[#5E5CE6] border-b-2 border-[#5E5CE6]' : 'text-[#8E95A5]'
              }\`}
            >
              <FileCode className="w-4 h-4" />
              JSON-LD Schemas
            </button>
            <button
              onClick={() => setActiveTab('content')}
              className={\`flex items-center gap-1.5 pb-1 font-semibold text-xs md:text-sm transition-all \${
                activeTab === 'content' ? 'text-[#5E5CE6] border-b-2 border-[#5E5CE6]' : 'text-[#8E95A5]'
              }\`}
            >
              <Layers className="w-4 h-4" />
              Programmatic Content
            </button>
            <button
              onClick={() => setActiveTab('wordpress')}
              className={\`flex items-center gap-1.5 pb-1 font-semibold text-xs md:text-sm transition-all \${
                activeTab === 'wordpress' ? 'text-[#5E5CE6] border-b-2 border-[#5E5CE6]' : 'text-[#8E95A5]'
              }\`}
            >
              <Send className="w-4 h-4" />
              WordPress Drafts
            </button>
            <button
              onClick={() => setActiveTab('gsc')}
              className={\`flex items-center gap-1.5 pb-1 font-semibold text-xs md:text-sm transition-all \${
                activeTab === 'gsc' ? 'text-[#5E5CE6] border-b-2 border-[#5E5CE6]' : 'text-[#8E95A5]'
              }\`}
            >
              <Sparkles className="w-4 h-4" />
              GSC & GEO
            </button>
          </div>

          {/* Quick Actions */}
          <div className="flex items-center gap-3">
            <div className="flex items-center bg-white dark:bg-[#1E2132] rounded-full p-1 border border-gray-200/60 shadow-sm text-xs">
              <button
                onClick={() => setIsDarkMode(false)}
                className={\`flex items-center gap-1 px-3 py-1 rounded-full \${!isDarkMode ? 'bg-[#5E5CE6] text-white font-medium' : 'text-[#8E95A5]'}\`}
              >
                <Sun className="w-3.5 h-3.5" /> Light
              </button>
              <button
                onClick={() => setIsDarkMode(true)}
                className={\`flex items-center gap-1 px-3 py-1 rounded-full \${isDarkMode ? 'bg-[#1E2132] text-white font-medium' : 'text-[#8E95A5]'}\`}
              >
                <Moon className="w-3.5 h-3.5" /> Dark
              </button>
            </div>

            <button
              onClick={() => window.open('http://localhost:4000/docs', '_blank')}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-[#5E5CE6] text-white text-xs font-semibold rounded-full shadow hover:bg-indigo-600 transition"
            >
              <ExternalLink className="w-3.5 h-3.5" /> OpenAPI Docs
            </button>
          </div>
        </header>

        {/* MAIN BODY: SIDEBAR + DYNAMIC CONTENT TABS */}
        <div className="flex gap-6">
          {/* FLOATING CURVED SIDEBAR */}
          <aside className="w-16 bg-[#5E5CE6] rounded-[28px] py-6 flex flex-col items-center justify-between text-white shadow-xl shrink-0">
            <div className="flex flex-col items-center gap-5">
              <div onClick={() => setActiveTab('dashboard')} className="p-2.5 bg-white/20 rounded-2xl cursor-pointer hover:scale-105 transition">
                <LayoutDashboard className="w-5 h-5 text-white" />
              </div>
              <div onClick={() => setActiveTab('logs')} className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition">
                <Activity className="w-5 h-5 text-white/80" />
              </div>
              <div onClick={() => setActiveTab('issues')} className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition relative">
                <ShieldCheck className="w-5 h-5 text-white/80" />
                <span className="w-2 h-2 bg-emerald-400 rounded-full absolute top-1 right-1"></span>
              </div>
              <div onClick={() => setActiveTab('schemas')} className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition">
                <FileCode className="w-5 h-5 text-white/80" />
              </div>
              <div onClick={() => setActiveTab('content')} className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition">
                <Layers className="w-5 h-5 text-white/80" />
              </div>
              <div onClick={() => setActiveTab('wordpress')} className="p-2 hover:bg-white/10 rounded-xl cursor-pointer transition">
                <Send className="w-5 h-5 text-white/80" />
              </div>
            </div>
            <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center font-bold text-xs">
              G
            </div>
          </aside>

          {/* TAB 1: OVERVIEW & FIGMA SOFT UI */}
          {activeTab === 'dashboard' && (
            <div className="flex-1 space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                <div className="lg:col-span-5 flex flex-col justify-center">
                  <div className="flex items-center gap-2 mb-2">
                    <h1 className="text-3xl font-bold tracking-tight">Hi, James!</h1>
                    <span className="flex items-center -space-x-1">
                      <span className="w-6 h-6 rounded-full bg-indigo-500 text-white flex items-center justify-center text-[10px] font-bold border-2 border-white">SEO</span>
                      <span className="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold border-2 border-white">AI</span>
                    </span>
                  </div>
                  <h2 className="text-2xl font-semibold mb-3">What are your plans for today?</h2>
                  <p className="text-sm text-[#8E95A5] leading-relaxed max-w-md">
                    Tu motor operativo de SEO técnico está activo y procesando logs de servidores, auditorías de crawl y borradores de WordPress en tiempo real.
                  </p>
                </div>

                <div onClick={() => setActiveTab('logs')} className="lg:col-span-2 bg-white dark:bg-[#1E2132] rounded-[24px] p-5 shadow-soft cursor-pointer hover:shadow-lg transition">
                  <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center text-[#5E5CE6] mb-3">
                    <Activity className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm">Server Logs</h3>
                  <p className="text-xs text-[#8E95A5] mt-1">{overview?.totalCrawledUrls || 1248} URLs rastreadas por bots</p>
                </div>

                <div onClick={() => setActiveTab('issues')} className="lg:col-span-2 bg-white dark:bg-[#1E2132] rounded-[24px] p-5 shadow-soft cursor-pointer hover:shadow-lg transition">
                  <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-500 mb-3">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm">Technical Issues</h3>
                  <p className="text-xs text-[#8E95A5] mt-1">{overview?.activeIssuesCount || 18} detectados ({overview?.criticalIssues || 2} críticos)</p>
                </div>

                <div onClick={() => setActiveTab('wordpress')} className="lg:col-span-3 bg-white dark:bg-[#1E2132] rounded-[24px] p-5 shadow-soft cursor-pointer hover:shadow-lg transition">
                  <div className="w-10 h-10 rounded-2xl bg-purple-50 flex items-center justify-center text-purple-600 mb-3">
                    <Send className="w-5 h-5" />
                  </div>
                  <h3 className="font-bold text-sm">WordPress Drafts</h3>
                  <p className="text-xs text-[#8E95A5] mt-1">Conector REST activo (Modo borrador estricto)</p>
                </div>
              </div>

              {/* THREE COLUMN ROW */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Bot Distribution Chart */}
                <div className="lg:col-span-4 bg-white dark:bg-[#1E2132] rounded-[28px] p-6 shadow-soft">
                  <h3 className="font-bold mb-4 flex items-center justify-between">
                    <span>Actividad de Bots (24h)</span>
                    <Bot className="w-4 h-4 text-[#5E5CE6]" />
                  </h3>
                  <div className="space-y-3">
                    {overview?.botDistribution?.map((b: any, idx: number) => (
                      <div key={idx}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="font-semibold">{b.name}</span>
                          <span className="text-[#8E95A5]">{b.hits} hits ({b.percentage}%)</span>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-1.5">
                          <div className="bg-[#5E5CE6] h-1.5 rounded-full" style={{ width: \`\${b.percentage}%\` }}></div>
                        </div>
                      </div>
                    )) || <p className="text-xs text-[#8E95A5]">Cargando métricas de bots...</p>}
                  </div>
                </div>

                {/* Priority Technical Issues */}
                <div className="lg:col-span-4 bg-white dark:bg-[#1E2132] rounded-[28px] p-6 shadow-soft flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold mb-3 flex items-center justify-between">
                      <span>Issues Críticos</span>
                      <span className="text-[10px] bg-rose-100 text-rose-700 font-bold px-2 py-0.5 rounded-full">Score Heurístico</span>
                    </h3>
                    <div className="space-y-2.5">
                      {issues.slice(0, 3).map((iss, i) => (
                        <div key={i} className="p-3 bg-gray-50 dark:bg-gray-800/40 rounded-xl text-xs">
                          <div className="flex justify-between font-semibold mb-1">
                            <span>{iss.title}</span>
                            <span className="text-rose-600 font-bold">{iss.priorityScore}</span>
                          </div>
                          <p className="text-[11px] text-[#8E95A5]">{iss.recommendation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button onClick={() => setActiveTab('issues')} className="mt-3 w-full py-2 bg-gray-100 dark:bg-gray-800 text-xs font-semibold rounded-xl text-center">
                    Ver todos los issues →
                  </button>
                </div>

                {/* Crawl Waste & Health Score */}
                <div className="lg:col-span-4 bg-white dark:bg-[#1E2132] rounded-[28px] p-6 shadow-soft flex flex-col justify-between">
                  <div>
                    <h3 className="font-bold mb-2">Salud Técnica de Rastreo</h3>
                    <div className="flex items-center gap-4 my-4">
                      <div className="w-16 h-16 rounded-full border-4 border-emerald-400 flex items-center justify-center text-lg font-bold">
                        94%
                      </div>
                      <div>
                        <div className="text-xs font-bold text-emerald-600">ESTADO ÓPTIMO</div>
                        <div className="text-xs text-[#8E95A5] mt-1">Crawl Waste estimado: <span className="font-bold text-[#1E2132] dark:text-white">4.8%</span></div>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                    42 URLs no indexables continúan recibiendo solicitudes de Googlebot.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LOG INTELLIGENCE */}
          {activeTab === 'logs' && (
            <div className="flex-1 space-y-6">
              <div className="bg-white dark:bg-[#1E2132] rounded-[28px] p-6 shadow-soft">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-[#5E5CE6]" />
                  Streaming Server Log Analyzer (.log / .txt / .gz)
                </h2>
                <p className="text-xs text-[#8E95A5] mb-6">
                  Procesamiento en tiempo real con chunks y backpressure sin almacenar archivos pesados en memoria. Anonimización automática de IP (HMAC salt) y sanitización de query strings.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
                  <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl">
                    <div className="text-xs text-[#8E95A5]">Total Solicitudes</div>
                    <div className="text-xl font-bold mt-1">24,890</div>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl">
                    <div className="text-xs text-[#8E95A5]">200 OK</div>
                    <div className="text-xl font-bold mt-1 text-emerald-600">21,800</div>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl">
                    <div className="text-xs text-[#8E95A5]">404 Not Found</div>
                    <div className="text-xl font-bold mt-1 text-amber-600">980</div>
                  </div>
                  <div className="p-4 bg-gray-50 dark:bg-gray-800/50 rounded-2xl">
                    <div className="text-xs text-[#8E95A5]">500 Server Errors</div>
                    <div className="text-xl font-bold mt-1 text-rose-600">260</div>
                  </div>
                </div>

                <h3 className="font-bold text-sm mb-3">Top Rutas de Crawl Waste (Desperdicio de Rastreo)</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 text-[#8E95A5]">
                        <th className="py-2">URL Detectada</th>
                        <th>Hits de Bots</th>
                        <th>Causa / Diagnóstico</th>
                      </tr>
                    </thead>
                    <tbody>
                      {logReports?.crawlWasteUrls?.map((w: any, idx: number) => (
                        <tr key={idx} className="border-b border-gray-100/50">
                          <td className="py-2.5 font-mono text-[11px] text-[#5E5CE6]">{w.url}</td>
                          <td className="font-semibold">{w.hits}</td>
                          <td className="text-rose-600">{w.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: TECHNICAL ISSUES */}
          {activeTab === 'issues' && (
            <div className="flex-1 space-y-6">
              <div className="bg-white dark:bg-[#1E2132] rounded-[28px] p-6 shadow-soft">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-emerald-500" />
                  Auditoría Técnica y Detección de Problemas (15+ Reglas)
                </h2>
                <p className="text-xs text-[#8E95A5] mb-6">
                  Ordenado automáticamente mediante la heurística: <code className="bg-gray-100 px-1 py-0.5 rounded font-mono">score = (impact * conf * affectedUrls * importance) / (effort * risk)</code>
                </p>

                <div className="space-y-4">
                  {issues.map((iss, i) => (
                    <div key={i} className="p-4 border border-gray-100 dark:border-gray-800 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={\`text-[10px] font-bold px-2 py-0.5 rounded-full \${
                            iss.severity === 'CRITICAL' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-700'
                          }\`}>
                            {iss.severity}
                          </span>
                          <span className="text-[10px] bg-gray-100 text-gray-700 font-mono px-2 py-0.5 rounded-full">
                            {iss.code}
                          </span>
                          <h4 className="font-bold text-sm">{iss.title}</h4>
                        </div>
                        <p className="text-xs text-[#8E95A5] mt-1">{iss.recommendation}</p>
                        <div className="text-[11px] text-gray-500 mt-2">URLs afectadas: <span className="font-semibold">{iss.affectedUrlsCount}</span></div>
                      </div>

                      <div className="text-right shrink-0">
                        <div className="text-2xl font-black text-[#5E5CE6]">{iss.priorityScore}</div>
                        <div className="text-[10px] text-[#8E95A5]">Priority Score</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: JSON-LD SCHEMA VALIDATOR */}
          {activeTab === 'schemas' && (
            <div className="flex-1 space-y-6">
              <div className="bg-white dark:bg-[#1E2132] rounded-[28px] p-6 shadow-soft">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <FileCode className="w-5 h-5 text-[#5E5CE6]" />
                  Validador y Generador de Schema.org JSON-LD
                </h2>
                <p className="text-xs text-[#8E95A5] mb-4">
                  Valida especificaciones Schema.org (Article, Organization, FAQPage), namespace @context y persistencia de identificadores @id.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="text-xs font-semibold mb-2 block">Editor de JSON-LD:</label>
                    <textarea
                      rows={10}
                      value={jsonLdInput}
                      onChange={(e) => setJsonLdInput(e.target.value)}
                      className="w-full p-3 font-mono text-xs bg-gray-50 dark:bg-gray-900 border rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#5E5CE6]"
                    />
                    <button
                      onClick={handleValidateSchema}
                      className="mt-3 px-5 py-2.5 bg-[#5E5CE6] text-white text-xs font-semibold rounded-full shadow hover:bg-indigo-600 transition"
                    >
                      Validar Schema JSON-LD
                    </button>
                  </div>

                  <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                    <h4 className="font-bold text-xs mb-3 text-[#8E95A5]">Resultado de Validación:</h4>
                    {schemaResult ? (
                      <div>
                        <div className={\`flex items-center gap-2 font-bold text-sm mb-2 \${schemaResult.isValid ? 'text-emerald-600' : 'text-rose-600'}\`}>
                          {schemaResult.isValid ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
                          {schemaResult.isValid ? 'SCHEMA VÁLIDO' : 'ERRORES DE ESPECIFICACIÓN'}
                        </div>
                        <div className="text-xs">Tipo de entidad: <span className="font-semibold">{schemaResult.type}</span></div>
                        {schemaResult.errors?.length > 0 && (
                          <div className="mt-3 p-3 bg-rose-50 text-rose-700 text-xs rounded-xl">
                            {schemaResult.errors.map((e: string, i: number) => <div key={i}>• {e}</div>)}
                          </div>
                        )}
                        {schemaResult.warnings?.length > 0 && (
                          <div className="mt-3 p-3 bg-amber-50 text-amber-700 text-xs rounded-xl">
                            {schemaResult.warnings.map((w: string, i: number) => <div key={i}>• {w}</div>)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <p className="text-xs text-[#8E95A5]">Haz clic en validar para inspeccionar el grafo JSON-LD.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: PROGRAMMATIC CONTENT & QUALITY GATES */}
          {activeTab === 'content' && (
            <div className="flex-1 space-y-6">
              <div className="bg-white dark:bg-[#1E2132] rounded-[28px] p-6 shadow-soft">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <Layers className="w-5 h-5 text-[#5E5CE6]" />
                  Motor de Contenido Programático & Quality Gates
                </h2>
                <p className="text-xs text-[#8E95A5] mb-6">
                  Renderizado seguro de plantillas (sin eval), análisis de similitud con shingles (Jaccard) y filtro anti-puerta/doorway pages.
                </p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold block mb-1">Variable: Palabra Clave (keyword)</label>
                      <input
                        type="text"
                        value={templateKeyword}
                        onChange={(e) => setTemplateKeyword(e.target.value)}
                        className="w-full p-2.5 text-xs bg-gray-50 border rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold block mb-1">Variable: Año (year)</label>
                      <input
                        type="text"
                        value={templateYear}
                        onChange={(e) => setTemplateYear(e.target.value)}
                        className="w-full p-2.5 text-xs bg-gray-50 border rounded-xl"
                      />
                    </div>
                    <button
                      onClick={handlePreviewPage}
                      className="px-5 py-2.5 bg-[#5E5CE6] text-white text-xs font-semibold rounded-full shadow hover:bg-indigo-600 transition"
                    >
                      Ejecutar Plantilla & Quality Gate
                    </button>
                  </div>

                  <div className="p-4 bg-gray-50 dark:bg-gray-900/50 rounded-2xl border">
                    <h4 className="font-bold text-xs mb-3 text-[#8E95A5]">Auditoría de Quality Gate:</h4>
                    {previewContent ? (
                      <div className="space-y-2 text-xs">
                        <div><strong>Título generado:</strong> {previewContent.title}</div>
                        <div><strong>Similitud con base:</strong> {(previewContent.similarityScore * 100).toFixed(0)}%</div>
                        <div className="flex items-center gap-2 mt-3">
                          <span className="px-3 py-1 bg-emerald-100 text-emerald-800 font-bold rounded-full text-xs">
                            ESTADO: {previewContent.qualityGate.status}
                          </span>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-[#8E95A5]">Genera una vista previa para evaluar el quality gate.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: WORDPRESS REST CONNECTOR */}
          {activeTab === 'wordpress' && (
            <div className="flex-1 space-y-6">
              <div className="bg-white dark:bg-[#1E2132] rounded-[28px] p-6 shadow-soft">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <Send className="w-5 h-5 text-purple-600" />
                  Conector de WordPress REST API (Drafts Enforced)
                </h2>
                <p className="text-xs text-[#8E95A5] mb-6">
                  Por diseño de seguridad editorial, la publicación automática en producción está estrictamente desactivada. Todo contenido se publica exclusivamente como borrador (<code className="bg-gray-100 px-1 py-0.5 rounded font-mono">draft</code>).
                </p>

                <div className="p-5 border border-purple-100 bg-purple-50/50 dark:bg-purple-900/10 rounded-2xl mb-6">
                  <div className="flex justify-between items-center mb-3">
                    <span className="font-bold text-sm">Destino: WordPress Producción (glitchtech.io)</span>
                    <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 font-bold rounded-full">CONECTADO</span>
                  </div>
                  <p className="text-xs text-[#8E95A5]">
                    Endpoint: <code className="font-mono">https://glitchtech.io/wp-json/wp/v2/posts</code> | Auth: Application Password
                  </p>
                </div>

                <button
                  onClick={handlePublishWpDraft}
                  className="px-6 py-3 bg-[#5E5CE6] text-white text-xs font-semibold rounded-full shadow hover:bg-indigo-600 transition flex items-center gap-2"
                >
                  <Send className="w-4 h-4" />
                  Publicar como Borrador en WordPress
                </button>

                {wpStatus && (
                  <div className="mt-4 p-3.5 bg-emerald-50 dark:bg-emerald-950/30 text-emerald-800 dark:text-emerald-300 rounded-xl text-xs font-semibold flex items-center gap-2">
                    <Check className="w-4 h-4" />
                    {wpStatus}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 7: SEARCH CONSOLE & GEO */}
          {activeTab === 'gsc' && (
            <div className="flex-1 space-y-6">
              <div className="bg-white dark:bg-[#1E2132] rounded-[28px] p-6 shadow-soft">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-[#5E5CE6]" />
                  Google Search Console & Monitoreo GEO de Motores de IA
                </h2>
                <p className="text-xs text-[#8E95A5] mb-6">
                  Integración OAuth2 con Search Analytics y seguimiento de presencia de marca en respuestas de LLMs (ChatGPT, Claude, Perplexity).
                </p>

                <h3 className="font-bold text-sm mb-3">Métricas Recientes de Google Search Console</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 text-[#8E95A5]">
                        <th className="py-2">Consulta (Query)</th>
                        <th>Página</th>
                        <th>Clics</th>
                        <th>Impresiones</th>
                        <th>CTR</th>
                        <th>Posición Media</th>
                      </tr>
                    </thead>
                    <tbody>
                      {gscMetrics.map((m, idx) => (
                        <tr key={idx} className="border-b border-gray-100/50">
                          <td className="py-2.5 font-semibold">{m.query}</td>
                          <td className="text-gray-500 font-mono text-[11px]">{m.page}</td>
                          <td className="font-bold text-emerald-600">{m.clicks}</td>
                          <td>{m.impressions}</td>
                          <td>{(m.ctr * 100).toFixed(1)}%</td>
                          <td className="font-bold text-[#5E5CE6]">{m.position}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
`;

fs.writeFileSync('apps/web/src/app/page.tsx', fullPageCode, 'utf8');
console.log('page.tsx successfully updated with full operational interactive tabs!');
`;

write('update_web_views.js', fullPageCode);
