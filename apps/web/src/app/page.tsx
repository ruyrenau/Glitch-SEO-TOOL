'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  LayoutDashboard, Globe, FileText, ShieldAlert, Gauge, Code2, Layers, Send, Search, Sparkles, Cpu, History, Sun, Moon, AlertTriangle, Menu, Bell, BookOpen, Users, LogOut, UserCircle, ScanSearch,
  PanelLeftClose,
  Settings,
  Activity,
  Rocket,
  PencilLine,
  PanelLeftOpen,
  FileBarChart,
  Bot,
  FileSearch,
  BarChart3,
  Network,
  BadgeCheck,
  Trophy,
  ShieldCheck,
  MousePointerClick,
  Target,
  FlaskConical,
  ChevronDown,
  ChevronsUpDown
} from 'lucide-react';
import { API_URL, ApiRequestError, UNAUTHORIZED_EVENT, apiGet, apiSend } from '@/lib/api';
import { AuthProvider, useAuth } from '@/lib/auth';
import type { User, Permission, GoFn } from '@/lib/types';
import { LoginView, ForcedPasswordView } from '@/components/AuthViews';
import { AdminView, WorkspaceSwitcher, type WorkspaceSummary } from '@/components/WorkspaceViews';
import { UsersView, AccountView } from '@/components/UsersView';
import { JobsView } from '@/components/JobsView';
import { PerformanceView } from '@/components/PerformanceView';
import { ExplorerView } from '@/components/ExplorerView';
import { SeoEditPanel } from '@/components/SeoEditPanel';
import { WizardView } from '@/components/WizardView';
import { GscView } from '@/components/GscView';
import { MonitorView } from '@/components/MonitorView';
import { ReportsView } from '@/components/ReportsView';
import { AiReadinessView } from '@/components/AiReadinessView';
import { ContentAuditView } from '@/components/ContentAuditView';
import { Ga4View } from '@/components/Ga4View';
import { ArchitectureView } from '@/components/ArchitectureView';
import { EntitiesView } from '@/components/EntitiesView';
import { AuthorityView } from '@/components/AuthorityView';
import { AgentsView } from '@/components/AgentsView';
import { ExperimentsView } from '@/components/ExperimentsView';
import { GapsView } from '@/components/GapsView';
import { WpConnectCard } from '@/components/WpConnectCard';
import { AiVisibilityView } from '@/components/AiVisibilityView';
import { SettingsView } from '@/components/SettingsView';
import { SeoChangesView } from '@/components/SeoChangesView';
import type { Site } from '@/lib/types';
import { ErrorBox, Roadmap, Skeleton } from '@/components/ui';
import { OverviewView } from '@/components/OverviewView';
import { SitesView } from '@/components/SitesView';
import { LogsView } from '@/components/LogsView';
import { CrawlView } from '@/components/CrawlView';
import { IssuesView } from '@/components/IssuesView';
import { AlertsView } from '@/components/AlertsView';
import { ManualView } from '@/components/ManualView';
import { AuditView } from '@/components/ToolsViews';
import { SchemaGeneratorView } from '@/components/SchemaGeneratorView';
import { WordPressView } from '@/components/WordPressView';
import { ContentView } from '@/components/ContentView';

type NavId = 'wizard' | 'overview' | 'monitor' | 'sites' | 'logs' | 'crawler' | 'explorer' | 'architecture' | 'issues' | 'alerts' | 'vitals' | 'schema' | 'entities' | 'programmatic' | 'wordpress' | 'seochanges' | 'gsc' | 'ga4' | 'authority' | 'geo' | 'aiready' | 'agents' | 'experiments' | 'gaps' | 'contentaudit' | 'reports' | 'automations' | 'audit' | 'manual' | 'users' | 'settings' | 'account' | 'admin';

type NavGroup = 'top' | 'data' | 'tech' | 'content' | 'ai' | 'compete' | 'system';
/** Menu sections, in order. "top" items have no heading and are always visible. */
const GROUPS: Array<{ id: Exclude<NavGroup, 'top'>; label: string }> = [
  { id: 'data', label: 'Datos y conexiones' },
  { id: 'tech', label: 'SEO técnico' },
  { id: 'content', label: 'Contenido' },
  { id: 'ai', label: 'IA (AEO y GEO)' },
  { id: 'compete', label: 'Competencia y resultados' },
  { id: 'system', label: 'Sistema' }
];
const NAV: Array<{ id: NavId; label: string; icon: React.ComponentType<{ className?: string }>; ready: boolean; perm?: Permission; group: NavGroup }> = [
  { id: 'wizard', label: 'Inicio guiado', icon: Rocket, ready: true, group: 'top' },
  { id: 'overview', label: 'Overview', icon: LayoutDashboard, ready: true, group: 'top' },
  { id: 'monitor', label: 'Monitoreo', icon: Activity, ready: true, group: 'top' },
  { id: 'sites', label: 'Sitios', icon: Globe, ready: true, group: 'data' },
  { id: 'gsc', label: 'Search Console', icon: Search, ready: true, group: 'data' },
  { id: 'ga4', label: 'Google Analytics', icon: BarChart3, ready: true, group: 'data' },
  { id: 'logs', label: 'Logs y sitemap', icon: FileText, ready: true, group: 'data' },
  { id: 'wordpress', label: 'WordPress', icon: Send, ready: true, group: 'data' },
  { id: 'crawler', label: 'Crawl y auditoría', icon: ShieldAlert, ready: true, group: 'tech' },
  { id: 'explorer', label: 'Explorador SEO', icon: ScanSearch, ready: true, group: 'tech' },
  { id: 'issues', label: 'Issues técnicos', icon: AlertTriangle, ready: true, group: 'tech' },
  { id: 'alerts', label: 'Alertas', icon: Bell, ready: true, group: 'tech' },
  { id: 'architecture', label: 'Arquitectura', icon: Network, ready: true, group: 'tech' },
  { id: 'vitals', label: 'Core Web Vitals', icon: Gauge, ready: true, group: 'tech' },
  { id: 'schema', label: 'Schema.org', icon: Code2, ready: true, group: 'tech' },
  { id: 'contentaudit', label: 'Análisis de contenido', icon: FileSearch, ready: true, group: 'content' },
  { id: 'gaps', label: 'Brechas de contenido', icon: Target, ready: true, group: 'content' },
  { id: 'seochanges', label: 'Cambios SEO', icon: PencilLine, ready: true, group: 'content' },
  { id: 'programmatic', label: 'Contenido programático', icon: Layers, ready: true, group: 'content' },
  { id: 'entities', label: 'Entidades y E-E-A-T', icon: BadgeCheck, ready: true, group: 'content' },
  { id: 'geo', label: 'Visibilidad en IA', icon: Sparkles, ready: true, group: 'ai' },
  { id: 'aiready', label: 'Listo para IA', icon: Bot, ready: true, group: 'ai' },
  { id: 'agents', label: 'Agentes de IA', icon: MousePointerClick, ready: true, group: 'ai' },
  { id: 'authority', label: 'Autoridad y SERP', icon: Trophy, ready: true, group: 'compete' },
  { id: 'experiments', label: 'Experimentos SEO', icon: FlaskConical, ready: true, group: 'compete' },
  { id: 'reports', label: 'Reportes', icon: FileBarChart, ready: true, group: 'compete' },
  { id: 'automations', label: 'Jobs y automatizaciones', icon: Cpu, ready: true, group: 'system' },
  { id: 'audit', label: 'Audit log', icon: History, ready: true, group: 'system' },
  { id: 'users', label: 'Usuarios', icon: Users, ready: true, perm: 'users:manage', group: 'system' },
  { id: 'settings', label: 'Configuración', icon: Settings, ready: true, perm: 'users:manage', group: 'system' }
];

const ROADMAP: Partial<Record<NavId, { status: string; items: string[] }>> = {
};

function Dashboard() {
  const { user, can, logout } = useAuth();
  const [nav, setNav] = useState<NavId>('overview');
  const [dark, setDark] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [gscNotice, setGscNotice] = useState<{ kind: 'connected' | 'error'; message?: string } | null>(null);
  // From the WordPress plugin: /?nav=wordpress&wpconnect=<site>; back from WordPress: &wp=connected|rejected|error
  const [wpConnect, setWpConnect] = useState<string | null>(null);
  const [wpNotice, setWpNotice] = useState<{ kind: 'connected' | 'rejected' | 'error'; message?: string; site?: string } | null>(null);
  // Back from Google's consent screen: /?nav=gsc&gsc=connected|error&message=…
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const back = q.get('nav');
    if (back === 'wordpress') {
      setNav('wordpress');
      const target = q.get('wpconnect');
      if (target && /^https?:\/\//.test(target)) setWpConnect(target);
      const kind = q.get('wp');
      if (kind === 'connected' || kind === 'rejected' || kind === 'error') setWpNotice({ kind, message: q.get('message') ?? undefined, site: q.get('site') ?? undefined });
      window.history.replaceState(null, '', window.location.pathname);
    }
    if (back === 'gsc' || back === 'ga4') {
      setNav(back);
      const kind = q.get('gsc');
      if (kind === 'connected' || kind === 'error') setGscNotice({ kind, message: q.get('message') ?? undefined });
      window.history.replaceState(null, '', window.location.pathname);
    }
  }, []);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem('glitch.sidebar') === 'collapsed');
    } catch {}
  }, []);
  const toggleCollapsed = () =>
    setCollapsed(c => {
      try {
        localStorage.setItem('glitch.sidebar', c ? 'open' : 'collapsed');
      } catch {}
      return !c;
    });
  const [sites, setSites] = useState<Site[] | null>(null);
  const [siteId, setSiteId] = useState('');
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('glitch-theme');
      setDark(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
      const savedSite = localStorage.getItem('glitch-site');
      if (savedSite) setSiteId(savedSite);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const loadSites = useCallback(async () => {
    try {
      const list = await apiGet<Site[]>('/api/v1/sites');
      setSites(list);
      setError(null);
      setSiteId(cur => (list.some(s => s.id === cur) ? cur : list[0]?.id ?? ''));
      // First visit with no sites: start in the guided setup.
      if (!list.length) setNav(n => (n === 'overview' ? 'wizard' : n));
    } catch (err) {
      setError(err);
      setSites([]);
    }
  }, []);

  useEffect(() => {
    loadSites();
  }, [loadSites]);
  useEffect(() => {
    if (wpNotice?.kind === 'connected' && wpNotice.site && sites?.some(s => s.id === wpNotice.site)) selectSite(wpNotice.site);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wpNotice, sites]);

  const selectSite = (id: string) => {
    setSiteId(id);
    try {
      localStorage.setItem('glitch-site', id);
    } catch {
      /* ignore */
    }
  };
  const toggleTheme = () => {
    setDark(d => {
      try {
        localStorage.setItem('glitch-theme', d ? 'light' : 'dark');
      } catch {
        /* ignore */
      }
      return !d;
    });
  };
  // Menu sections: all closed at first; the choice is remembered in this browser.
  const [openGroups, setOpenGroups] = useState<NavGroup[]>([]);
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem('glitch-nav-open') ?? '[]');
      if (Array.isArray(v)) setOpenGroups(v);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const saveGroups = (v: NavGroup[]) => {
    try {
      localStorage.setItem('glitch-nav-open', JSON.stringify(v));
    } catch {
      /* ignore */
    }
    return v;
  };
  const toggleGroup = (g: NavGroup) => setOpenGroups(o => saveGroups(o.includes(g) ? o.filter(x => x !== g) : [...o, g]));
  const allOpen = GROUPS.every(g => openGroups.includes(g.id));
  const toggleAll = () => setOpenGroups(saveGroups(allOpen ? [] : GROUPS.map(g => g.id)));
  const [explorerPreset, setExplorerPreset] = useState<{ tab: string; filter?: string; n: number } | null>(null);
  const go: GoFn = (id, explorer) => {
    const g = NAV.find(n => n.id === id)?.group ?? (id === 'admin' ? 'system' : null);
    if (g && g !== 'top') setOpenGroups(o => (o.includes(g) ? o : saveGroups([...o, g])));
    if (id === 'explorer') setExplorerPreset(explorer ? { ...explorer, n: Date.now() } : null);
    setNav(id as NavId);
    setMenuOpen(false);
  };

  const current = nav === 'manual' ? { label: 'Manual de uso' } : nav === 'account' ? { label: 'Mi cuenta' } : nav === 'admin' ? { label: 'Administración' } : NAV.find(n => n.id === nav)!;
  const visibleNav = [...NAV.filter(n => !n.perm || can(n.perm)), ...(user.isSuperAdmin ? [{ id: 'admin' as NavId, label: 'Administración', icon: ShieldCheck, ready: true, group: 'system' as NavGroup }] : [])];
  const needsSite = ['overview', 'monitor', 'architecture', 'entities', 'authority', 'agents', 'experiments', 'gaps', 'ga4', 'geo', 'aiready', 'contentaudit', 'reports', 'logs', 'crawler', 'explorer', 'seochanges', 'gsc', 'issues', 'alerts', 'programmatic', 'wordpress', 'vitals'].includes(nav);

  return (
    <div className={dark ? 'dark' : ''}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-2 focus:bg-white">Saltar al contenido</a>
      <div className="min-h-screen flex bg-[#F4F6FB] text-slate-900 dark:bg-[#0F111A] dark:text-slate-100">
        <aside
          className={`${menuOpen ? 'fixed inset-0 z-40 flex' : 'hidden'} md:static md:flex ${collapsed && !menuOpen ? 'w-16 [&_.nav-text]:hidden' : 'w-64'} transition-[width] border-r flex-col shrink-0 bg-white border-slate-200 dark:bg-[#151824] dark:border-slate-800`}
          aria-label="Navegación principal"
        >
          <div className={`${collapsed && !menuOpen ? 'p-3 justify-center' : 'p-5'} border-b border-slate-200 dark:border-slate-800 flex items-center gap-2.5`}>
            {collapsed && !menuOpen ? (
              <img src="/brand/icon.png" alt="G.SEO" className="w-9 h-9 rounded-lg" />
            ) : (
              <div className="nav-text">
                <img src="/brand/logo-dark.png" alt="G.SEO" className="h-8 w-auto dark:hidden" />
                <img src="/brand/logo-white.png" alt="G.SEO" className="h-8 w-auto hidden dark:block" />
                <div className="text-[10px] text-slate-500 font-mono mt-1">v0.9 · local</div>
              </div>
            )}
          </div>

          <div className="nav-text p-3 border-b border-slate-200 dark:border-slate-800">
            <WorkspaceSwitcher />
            <label htmlFor="site-select" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Sitio activo</label>
            <select
              id="site-select"
              value={siteId}
              onChange={e => selectSite(e.target.value)}
              className="w-full text-xs font-semibold rounded-lg p-2 border bg-slate-50 border-slate-200 dark:bg-slate-900 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {!sites?.length && <option value="">Sin sitios</option>}
              {sites?.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.environment})</option>
              ))}
            </select>
          </div>

          <nav className="flex-1 overflow-y-auto p-3 space-y-1">
            {(() => {
              const iconOnly = collapsed && !menuOpen;
              const item = (n: (typeof visibleNav)[number]) => {
                const Icon = n.icon;
                const active = nav === n.id;
                return (
                  <button
                    key={n.id}
                    onClick={() => go(n.id)}
                    aria-current={active ? 'page' : undefined}
                    title={n.label}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                      active ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800/60'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span className="nav-text truncate flex-1 text-left">{n.label}</span>
                    {!n.ready && <span className={`nav-text text-[9px] font-bold ${active ? 'text-white/80' : 'text-amber-600'}`}>PRONTO</span>}
                  </button>
                );
              };
              // Icon-only sidebar: every item, sections separated by a line.
              if (iconOnly)
                return [visibleNav.filter(n => n.group === 'top'), ...GROUPS.map(g => visibleNav.filter(n => n.group === g.id))]
                  .filter(l => l.length)
                  .map((l, i) => <div key={i} className={i ? 'pt-1 mt-1 border-t border-slate-200 dark:border-slate-800 space-y-1' : 'space-y-1'}>{l.map(item)}</div>);
              return (
                <>
                  {visibleNav.filter(n => n.group === 'top').map(item)}
                  <div className="flex justify-end pt-2">
                    <button onClick={toggleAll} className="nav-text text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline flex items-center gap-1" aria-label={allOpen ? 'Contraer todas las secciones del menú' : 'Expandir todas las secciones del menú'}>
                      <ChevronsUpDown className="w-3 h-3" aria-hidden /> {allOpen ? 'Contraer todo' : 'Expandir todo'}
                    </button>
                  </div>
                  {GROUPS.map(g => {
                    const items = visibleNav.filter(n => n.group === g.id);
                    if (!items.length) return null;
                    const open = openGroups.includes(g.id);
                    const hasActive = items.some(n => n.id === nav);
                    return (
                      <div key={g.id}>
                        <button
                          onClick={() => toggleGroup(g.id)}
                          aria-expanded={open}
                          aria-controls={`nav-${g.id}`}
                          className="w-full flex items-center gap-2 px-3 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
                        >
                          <span className="flex-1 text-left">{g.label}</span>
                          {!open && hasActive && <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" aria-label="Contiene la sección abierta" />}
                          <ChevronDown className={`w-3.5 h-3.5 transition-transform ${open ? '' : '-rotate-90'}`} aria-hidden />
                        </button>
                        {open && <div id={`nav-${g.id}`} className="space-y-1">{items.map(item)}</div>}
                      </div>
                    );
                  })}
                </>
              );
            })()}
          </nav>

          <div className={`px-3 pt-3 border-t border-slate-200 dark:border-slate-800 flex items-center gap-2 ${collapsed && !menuOpen ? 'flex-col' : ''}`}>
            <button
              onClick={() => go('account')}
              aria-current={nav === 'account' ? 'page' : undefined}
              className="flex-1 min-w-0 flex items-center gap-2 text-left rounded-lg p-1 hover:bg-slate-100 dark:hover:bg-slate-800"
              title="Mi cuenta"
            >
              <UserCircle className="w-7 h-7 text-indigo-600 dark:text-indigo-400 shrink-0" aria-hidden />
              <span className="nav-text min-w-0">
                <span className="block text-[11px] font-semibold truncate">{user.name}</span>
                <span className="block text-[10px] text-slate-500">{user.roleLabel}</span>
              </span>
            </button>
            <button onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión" className="p-1.5 rounded-lg border bg-slate-100 border-slate-200 dark:bg-slate-800 dark:border-slate-700 text-slate-600 dark:text-slate-300">
              <LogOut className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className={`p-3 flex justify-between items-center ${collapsed && !menuOpen ? 'flex-col gap-1.5' : ''}`}>
            <a href={`${API_URL}/docs`} target="_blank" rel="noreferrer" className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">OpenAPI</a>
            <div className={`flex items-center gap-1.5 ${collapsed && !menuOpen ? 'flex-col' : ''}`}>
            <button
              onClick={() => go('manual')}
              aria-label="Abrir manual de uso"
              title="Manual de uso"
              aria-current={nav === 'manual' ? 'page' : undefined}
              className={`p-1.5 rounded-lg border ${nav === 'manual' ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-slate-100 border-slate-200 dark:bg-slate-800 dark:border-slate-700 text-slate-600 dark:text-slate-300'}`}
            >
              <BookOpen className="w-3.5 h-3.5" />
            </button>
            <button onClick={toggleTheme} aria-label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} className="p-1.5 rounded-lg border bg-slate-100 border-slate-200 dark:bg-slate-800 dark:border-slate-700">
              {dark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-slate-600" />}
            </button>
            </div>
          </div>
        </aside>

        <main id="main" className="flex-1 flex flex-col min-w-0 overflow-x-hidden">
          <header className="h-14 border-b flex items-center gap-3 px-4 md:px-6 shrink-0 bg-white border-slate-200 dark:bg-[#151824] dark:border-slate-800">
            <button className="md:hidden p-1.5 rounded-lg border border-slate-200 dark:border-slate-700" aria-label="Abrir menú" aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
              <Menu className="w-4 h-4" />
            </button>
            <button
              className="hidden md:inline-flex p-1.5 rounded-lg border border-slate-200 dark:border-slate-700"
              aria-label={collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'}
              title={collapsed ? 'Expandir barra lateral' : 'Contraer barra lateral'}
              aria-expanded={!collapsed}
              onClick={toggleCollapsed}
            >
              {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
            <h1 className="font-bold text-base">{current.label}</h1>
          </header>

          <div className="p-4 md:p-6 space-y-6 flex-1">
            {error ? <ErrorBox error={error} /> : null}
            {wpConnect && <WpConnectCard url={wpConnect} onDone={() => setWpConnect(null)} />}
            {sites === null ? (
              <Skeleton rows={4} />
            ) : needsSite && !siteId ? (
              <SitesView sites={sites} reload={loadSites} select={selectSite} />
            ) : (
              <>
                {nav === 'wizard' && <WizardView sites={sites} siteId={siteId} select={selectSite} reload={loadSites} go={go} />}
                {nav === 'manual' && <ManualView go={go} />}
                {nav === 'overview' && <OverviewView siteId={siteId} go={go} />}
                {nav === 'sites' && <SitesView sites={sites} reload={loadSites} select={selectSite} />}
                {nav === 'logs' && <LogsView key={siteId} siteId={siteId} onChanged={loadSites} />}
                {nav === 'crawler' && <CrawlView key={siteId} siteId={siteId} onFinished={loadSites} />}
                {nav === 'issues' && <IssuesView key={siteId} siteId={siteId} go={go} />}
                {nav === 'alerts' && <AlertsView key={siteId} siteId={siteId} go={go} />}
                {nav === 'schema' && <SchemaGeneratorView />}
                {nav === 'entities' && <EntitiesView key={siteId} siteId={siteId} go={go} />}
                {nav === 'authority' && <AuthorityView key={siteId} siteId={siteId} go={go} />}
                {nav === 'agents' && <AgentsView key={siteId} siteId={siteId} go={go} />}
                {nav === 'experiments' && <ExperimentsView key={siteId} siteId={siteId} go={go} />}
                {nav === 'gaps' && <GapsView key={siteId} siteId={siteId} go={go} />}
                {nav === 'reports' && <ReportsView key={siteId} siteId={siteId} />}
                {nav === 'aiready' && <AiReadinessView key={siteId} siteId={siteId} go={go} />}
                {nav === 'contentaudit' && <ContentAuditView key={siteId} siteId={siteId} go={go} />}
                {nav === 'programmatic' && <ContentView key={siteId} siteId={siteId} go={go} />}
                {nav === 'wordpress' && <WordPressView key={siteId} siteId={siteId} go={go} notice={wpNotice} />}
                {nav === 'explorer' && <ExplorerView key={`${siteId}-${explorerPreset?.n ?? 0}`} siteId={siteId} initial={explorerPreset ?? undefined} detailExtra={d => <SeoEditPanel siteId={siteId} detail={d} goChanges={() => go('seochanges')} />} />}
                {nav === 'seochanges' && <SeoChangesView key={siteId} siteId={siteId} />}
                {nav === 'geo' && <AiVisibilityView key={siteId} siteId={siteId} go={go} />}
                {nav === 'settings' && can('users:manage') && <SettingsView />}
                {nav === 'admin' && user.isSuperAdmin && <AdminView />}
                {nav === 'monitor' && <MonitorView key={siteId} siteId={siteId} go={go} />}
                {nav === 'gsc' && <GscView key={siteId} siteId={siteId} go={go} notice={gscNotice} />}
                {nav === 'architecture' && <ArchitectureView key={siteId} siteId={siteId} go={go} />}
                {nav === 'ga4' && <Ga4View key={siteId} siteId={siteId} go={go} notice={gscNotice} />}
                {nav === 'vitals' && <PerformanceView key={siteId} siteId={siteId} />}
                {nav === 'automations' && <JobsView sites={sites} />}
                {nav === 'audit' && <AuditView />}
                {nav === 'users' && can('users:manage') && <UsersView />}
                {nav === 'account' && <AccountView />}
                {ROADMAP[nav] && <Roadmap title={current.label} status={ROADMAP[nav]!.status} items={ROADMAP[nav]!.items} />}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/** Shows the login screen until there is a valid session, then the dashboard. */
export default function App() {
  const [state, setState] = useState<'loading' | 'anon' | 'offline' | User>('loading');
  const [ws, setWs] = useState<{ workspaces: WorkspaceSummary[]; workspaceId: string; canCreateWorkspace: boolean } | null>(null);
  const [dark, setDark] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await apiGet<{ user: User; workspaces: WorkspaceSummary[]; workspaceId: string; canCreateWorkspace: boolean }>('/api/v1/auth/me');
      setWs({ workspaces: r.workspaces, workspaceId: r.workspaceId, canCreateWorkspace: r.canCreateWorkspace });
      setState(r.user);
    } catch (err) {
      setState(err instanceof ApiRequestError && err.status === 401 ? 'anon' : 'offline');
    }
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem('glitch-theme');
      setDark(saved ? saved === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches);
    } catch {
      /* storage unavailable */
    }
    refresh();
    const onUnauthorized = () => setState('anon');
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiSend('POST', '/api/v1/auth/logout').catch(() => undefined);
    setState('anon');
  }, []);

  if (state === 'loading') return <div className={dark ? 'dark' : ''}><div className="min-h-screen bg-[#F4F6FB] dark:bg-[#0F111A]" aria-busy="true" /></div>;
  if (state === 'offline')
    return (
      <div className={dark ? 'dark' : ''}>
        <main className="min-h-screen flex items-center justify-center p-4 bg-[#F4F6FB] dark:bg-[#0F111A]">
          <div className="max-w-sm space-y-3 text-center">
            <ErrorBox error={new Error('fetch failed')} />
            <button className="text-xs underline text-slate-600 dark:text-slate-300" onClick={refresh}>Reintentar</button>
          </div>
        </main>
      </div>
    );
  if (state === 'anon') return <div className={dark ? 'dark' : ''}><LoginView onLoggedIn={() => refresh()} /></div>;
  if (state.mustChangePassword) return <div className={dark ? 'dark' : ''}><ForcedPasswordView onDone={refresh} onLogout={logout} /></div>;
  const user = state;
  return (
    <AuthProvider value={{ user, can: p => user.permissions.includes(p), logout, refresh, workspaces: ws?.workspaces, workspaceId: ws?.workspaceId, canCreateWorkspace: ws?.canCreateWorkspace }}>
      <Dashboard />
    </AuthProvider>
  );
}
