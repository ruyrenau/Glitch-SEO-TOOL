'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Copy, Plus, Search, Send, Trash2, XCircle } from 'lucide-react';
import { apiGet, apiSend, fmt } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { GoFn } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Kpi, Skeleton, inputCls } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Org { name: string; legalName?: string; type?: string; url: string; logo?: string; description?: string; email?: string; telephone?: string; address?: Record<string, string>; foundingDate?: string; sameAs?: string[] }
interface Author { id: string; name: string; slug: string; url?: string; jobTitle?: string; description?: string; image?: string; sameAs?: string[]; knowsAbout?: string[] }
interface Ref { label: string; qid?: string; wikipedia?: string; description?: string | null }
interface PageRow { url: string; title: string | null; clicks: number | null; configured: boolean; type: string; authorId: string | null; about: Ref[]; mentions: Ref[]; datePublished: string | null }

const ORG_TYPES = ['Organization', 'LocalBusiness', 'Corporation', 'ProfessionalService', 'EducationalOrganization', 'MedicalOrganization', 'NewsMediaOrganization', 'Store', 'Restaurant', 'NGO'];
const TYPE_LABEL: Record<string, string> = { Article: 'Artículo', BlogPosting: 'Entrada de blog', NewsArticle: 'Noticia', WebPage: 'Página', AboutPage: 'Nosotros', ContactPage: 'Contacto', ProfilePage: 'Perfil de autor', CollectionPage: 'Listado / categoría', FAQPage: 'Preguntas frecuentes' };
const lines = (s: string) => s.split(/\n|,/).map(x => x.trim()).filter(Boolean);
const path = (u: string) => {
  try {
    const x = new URL(u);
    return x.pathname + x.search;
  } catch {
    return u;
  }
};
const Field = ({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) => <label className={`space-y-1 ${wide ? 'md:col-span-2' : ''}`}><span className="block font-semibold">{label}</span>{children}</label>;

// ---------------------------------------------------------------------------
function Audit({ siteId, go }: { siteId: string; go: GoFn }) {
  const [d, setD] = useState<any>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    apiGet(`/api/v1/sites/${siteId}/entities/eeat`).then(setD, setError);
  }, [siteId]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={5} />;
  const areas = ['Organización', 'Autores', 'Contenido', 'Confianza'];
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">Revisa las señales de experiencia, autoridad y confianza que Google y las IAs pueden comprobar: quién está detrás del sitio, quién escribe y si eso está marcado y conectado.{!d.crawl && ' Haz un crawl para revisar también las páginas.'}</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <Kpi label="Puntaje E-E-A-T" value={`${d.score}/100`} tone={d.score >= 75 ? 'good' : d.score >= 50 ? 'warn' : 'bad'} />
        <Kpi label="Revisiones correctas" value={`${d.checks.filter((c: any) => c.status === 'ok').length}/${d.checks.length}`} />
        <Kpi label="Artículos detectados" value={fmt(d.articles)} />
      </div>
      {areas.map(a => {
        const cs = d.checks.filter((c: any) => c.area === a);
        if (!cs.length) return null;
        return (
          <section key={a} aria-label={a}>
            <h3 className="font-semibold text-sm mb-1">{a}</h3>
            <ul className="space-y-1.5">
              {cs.map((c: any) => {
                const Icon = c.status === 'ok' ? CheckCircle2 : c.status === 'partial' ? AlertTriangle : XCircle;
                return (
                  <li key={c.id} className="flex gap-2">
                    <Icon className={`w-4 h-4 shrink-0 ${c.status === 'ok' ? 'text-emerald-600' : c.status === 'partial' ? 'text-amber-500' : 'text-rose-600'}`} aria-label={c.status === 'ok' ? 'Bien' : c.status === 'partial' ? 'A medias' : 'Falta'} />
                    <div><strong>{c.label}</strong> — {c.detail}{c.status !== 'ok' && <div className="text-slate-500">{c.fix}</div>}</div>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
      {!d.crawl && <Button variant="secondary" onClick={() => go('crawler')}>Ir a Crawl y auditoría</Button>}
    </div>
  );
}

// ---------------------------------------------------------------------------
function OrgForm({ siteId, org, onSaved }: { siteId: string; org: Org; onSaved: () => void }) {
  const { can } = useAuth();
  const [o, setO] = useState<Org>(org);
  const [sameAs, setSameAs] = useState((org.sameAs ?? []).join('\n'));
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const set = (k: keyof Org, v: string) => setO(x => ({ ...x, [k]: v }));
  const setAddr = (k: string, v: string) => setO(x => ({ ...x, address: { ...(x.address ?? {}), [k]: v } }));
  const save = async () => {
    setError(null);
    setMsg(null);
    try {
      const body = Object.fromEntries(Object.entries({ ...o, sameAs: lines(sameAs) }).filter(([, v]) => v !== '' && v !== undefined));
      await apiSend('PUT', `/api/v1/sites/${siteId}/entities/org`, body);
      setMsg('Organización guardada.');
      onSaved();
    } catch (e) {
      setError(e);
    }
  };
  const dis = !can('site:manage');
  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">Quién está detrás del sitio. Se usa como "publisher" de todos los artículos y como entidad principal de la portada, "Nosotros" y "Contacto".</p>
      <div className="grid md:grid-cols-2 gap-3">
        <Field label="Nombre"><input aria-label="Nombre de la organización" className={`${inputCls} w-full`} disabled={dis} value={o.name ?? ''} onChange={e => set('name', e.target.value)} /></Field>
        <Field label="Tipo"><select aria-label="Tipo de organización" className={`${inputCls} w-full`} disabled={dis} value={o.type ?? 'Organization'} onChange={e => set('type', e.target.value)}>{ORG_TYPES.map(t => <option key={t}>{t}</option>)}</select></Field>
        <Field label="URL del sitio"><input aria-label="URL de la organización" className={`${inputCls} w-full`} disabled={dis} value={o.url ?? ''} onChange={e => set('url', e.target.value)} /></Field>
        <Field label="Logo (URL de la imagen)"><input aria-label="Logo" className={`${inputCls} w-full`} disabled={dis} value={o.logo ?? ''} onChange={e => set('logo', e.target.value)} /></Field>
        <Field label="Descripción" wide><textarea aria-label="Descripción de la organización" rows={2} className={`${inputCls} w-full`} disabled={dis} value={o.description ?? ''} onChange={e => set('description', e.target.value)} /></Field>
        <Field label="Correo"><input aria-label="Correo" className={`${inputCls} w-full`} disabled={dis} value={o.email ?? ''} onChange={e => set('email', e.target.value)} /></Field>
        <Field label="Teléfono"><input aria-label="Teléfono" className={`${inputCls} w-full`} disabled={dis} value={o.telephone ?? ''} onChange={e => set('telephone', e.target.value)} /></Field>
        <Field label="Calle y número"><input aria-label="Calle" className={`${inputCls} w-full`} disabled={dis} value={o.address?.streetAddress ?? ''} onChange={e => setAddr('streetAddress', e.target.value)} /></Field>
        <Field label="Ciudad / estado / país"><div className="flex gap-1"><input aria-label="Ciudad" className={`${inputCls} w-full`} disabled={dis} value={o.address?.addressLocality ?? ''} onChange={e => setAddr('addressLocality', e.target.value)} /><input aria-label="Estado" className={`${inputCls} w-full`} disabled={dis} value={o.address?.addressRegion ?? ''} onChange={e => setAddr('addressRegion', e.target.value)} /><input aria-label="País" className={`${inputCls} w-20`} disabled={dis} value={o.address?.addressCountry ?? ''} onChange={e => setAddr('addressCountry', e.target.value)} /></div></Field>
        <Field label="Perfiles oficiales (sameAs), uno por línea" wide><textarea aria-label="Perfiles oficiales" rows={4} className={`${inputCls} w-full font-mono`} disabled={dis} placeholder={'https://www.linkedin.com/company/…\nhttps://www.facebook.com/…\nhttps://www.wikidata.org/wiki/Q…'} value={sameAs} onChange={e => setSameAs(e.target.value)} /></Field>
      </div>
      <Button disabled={dis} onClick={save}>Guardar organización</Button>
      {dis && <span className="ml-2 text-amber-600">Solo administradores cambian la organización.</span>}
      {msg && <p role="status" className="text-emerald-700">{msg}</p>}
      <ErrorBox error={error} />
    </div>
  );
}

// ---------------------------------------------------------------------------
function Authors({ siteId, authors, reload }: { siteId: string; authors: Author[]; reload: () => void }) {
  const { can } = useAuth();
  const blank = { name: '', url: '', jobTitle: '', description: '', image: '', sameAs: '', knowsAbout: '' };
  const [f, setF] = useState<typeof blank & { id?: string }>(blank);
  const [error, setError] = useState<unknown>(null);
  const edit = (a: Author) => setF({ id: a.id, name: a.name, url: a.url ?? '', jobTitle: a.jobTitle ?? '', description: a.description ?? '', image: a.image ?? '', sameAs: (a.sameAs ?? []).join('\n'), knowsAbout: (a.knowsAbout ?? []).join(', ') });
  const save = async () => {
    setError(null);
    try {
      const body = { name: f.name, url: f.url || null, jobTitle: f.jobTitle || null, description: f.description || null, image: f.image || null, sameAs: lines(f.sameAs), knowsAbout: lines(f.knowsAbout) };
      if (f.id) await apiSend('PUT', `/api/v1/sites/${siteId}/entities/authors/${f.id}`, body);
      else await apiSend('POST', `/api/v1/sites/${siteId}/entities/authors`, body);
      setF(blank);
      reload();
    } catch (e) {
      setError(e);
    }
  };
  const del = async (a: Author) => {
    if (!confirm(`¿Quitar a ${a.name}? Sus páginas quedan sin autor.`)) return;
    await apiSend('DELETE', `/api/v1/sites/${siteId}/entities/authors/${a.id}`).catch(setError);
    reload();
  };
  const dis = !can('content:edit');
  return (
    <div className="grid lg:grid-cols-2 gap-4 text-xs">
      <div className="space-y-2">
        <p className="text-slate-500">Las personas que escriben o revisan el contenido. Cada una es una entidad "Person" con su @id, enlazada desde sus artículos. Para E-E-A-T: biografía con su experiencia real, foto, página de autor y perfiles verificables.</p>
        {!authors.length ? <Empty>Todavía no hay autores.</Empty> : (
          <ul className="space-y-2">
            {authors.map(a => {
              const missing = [!a.description || a.description.length < 80 ? 'biografía' : null, !a.image ? 'foto' : null, !a.url ? 'página de autor' : null, !a.sameAs?.length ? 'perfiles' : null].filter(Boolean);
              return (
                <li key={a.id} className="p-2 rounded-lg border border-slate-200 dark:border-slate-800 flex gap-2 items-start">
                  <div className="flex-1">
                    <div className="font-semibold">{a.name} {a.jobTitle && <span className="font-normal text-slate-500">· {a.jobTitle}</span>}</div>
                    <div className="text-slate-500">{(a.sameAs ?? []).length} perfiles{a.knowsAbout?.length ? ` · sabe de: ${a.knowsAbout.join(', ')}` : ''}</div>
                    {missing.length ? <Badge tone="warn">Falta: {missing.join(', ')}</Badge> : <Badge tone="good">Completo</Badge>}
                  </div>
                  <Button variant="secondary" disabled={dis} onClick={() => edit(a)}>Editar</Button>
                  <button aria-label={`Quitar ${a.name}`} disabled={dis} onClick={() => del(a)} className="p-1 text-rose-600"><Trash2 className="w-4 h-4" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <div className="space-y-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
        <h3 className="font-semibold text-sm">{f.id ? 'Editar autor' : 'Nuevo autor'}</h3>
        <Field label="Nombre"><input aria-label="Nombre del autor" className={`${inputCls} w-full`} disabled={dis} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Cargo o especialidad"><input aria-label="Cargo" className={`${inputCls} w-full`} disabled={dis} value={f.jobTitle} onChange={e => setF({ ...f, jobTitle: e.target.value })} /></Field>
        <Field label="Página de autor en el sitio"><input aria-label="Página de autor" className={`${inputCls} w-full`} disabled={dis} value={f.url} onChange={e => setF({ ...f, url: e.target.value })} /></Field>
        <Field label="Foto (URL)"><input aria-label="Foto" className={`${inputCls} w-full`} disabled={dis} value={f.image} onChange={e => setF({ ...f, image: e.target.value })} /></Field>
        <Field label="Biografía (experiencia, formación, años en el tema)"><textarea aria-label="Biografía" rows={3} className={`${inputCls} w-full`} disabled={dis} value={f.description} onChange={e => setF({ ...f, description: e.target.value })} /></Field>
        <Field label="Perfiles (LinkedIn, X, ORCID…), uno por línea"><textarea aria-label="Perfiles del autor" rows={3} className={`${inputCls} w-full font-mono`} disabled={dis} value={f.sameAs} onChange={e => setF({ ...f, sameAs: e.target.value })} /></Field>
        <Field label="Temas que domina (separados por coma)"><input aria-label="Temas" className={`${inputCls} w-full`} disabled={dis} value={f.knowsAbout} onChange={e => setF({ ...f, knowsAbout: e.target.value })} /></Field>
        <div className="flex gap-2"><Button disabled={dis || !f.name.trim()} onClick={save}><Plus className="w-3.5 h-3.5" aria-hidden /> {f.id ? 'Guardar cambios' : 'Agregar autor'}</Button>{f.id && <Button variant="secondary" onClick={() => setF(blank)}>Cancelar</Button>}</div>
        <ErrorBox error={error} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function RefChips({ items, onRemove, label }: { items: Ref[]; onRemove: (i: number) => void; label: string }) {
  if (!items.length) return <p className="text-slate-400">Ninguna.</p>;
  return (
    <ul className="flex flex-wrap gap-1" aria-label={label}>
      {items.map((r, i) => (
        <li key={`${r.qid}-${r.label}`} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800">
          {r.label}{r.qid && <a href={`https://www.wikidata.org/wiki/${r.qid}`} target="_blank" rel="noreferrer" className="text-slate-500 font-mono">{r.qid}</a>}
          <button aria-label={`Quitar ${r.label}`} onClick={() => onRemove(i)} className="text-slate-400 hover:text-rose-600">×</button>
        </li>
      ))}
    </ul>
  );
}

function PageEditor({ siteId, page, authors, types, onSaved, go }: { siteId: string; page: PageRow; authors: Author[]; types: string[]; onSaved: () => void; go: GoFn }) {
  const { can } = useAuth();
  const [p, setP] = useState(page);
  const [sug, setSug] = useState<Array<{ phrase: string; results: Ref[] }> | null>(null);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Ref[] | null>(null);
  const [graph, setGraph] = useState<{ json: string; warnings: string[] } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadGraph = useCallback(() => apiGet<any>(`/api/v1/sites/${siteId}/entities/graph?url=${encodeURIComponent(page.url)}`).then(setGraph, setError), [siteId, page.url]);
  useEffect(() => {
    loadGraph();
  }, [loadGraph]);
  const add = (kind: 'about' | 'mentions', r: Ref) => setP(x => (x[kind].some(y => y.qid === r.qid && y.label === r.label) ? x : { ...x, [kind]: [...x[kind], { label: r.label, qid: r.qid, wikipedia: r.wikipedia }] }));
  const save = async () => {
    setError(null);
    setMsg(null);
    try {
      await apiSend('PUT', `/api/v1/sites/${siteId}/entities/pages`, { url: p.url, type: p.type, authorId: p.authorId, about: p.about, mentions: p.mentions, datePublished: p.datePublished });
      setMsg('Guardado.');
      await loadGraph();
      onSaved();
    } catch (e) {
      setError(e);
    }
  };
  const propose = async () => {
    setError(null);
    try {
      await apiSend('POST', `/api/v1/sites/${siteId}/seo-edits`, { url: p.url, field: 'schemaJsonLd', newValue: graph!.json });
      setMsg('Propuesto en Cambios SEO: apruébalo y aplícalo ahí.');
    } catch (e) {
      setError(e);
    }
  };
  const ResultList = ({ items }: { items: Ref[] }) => (
    <ul className="space-y-1">
      {items.map(r => (
        <li key={r.qid} className="flex flex-wrap items-center gap-2">
          <span><strong>{r.label}</strong> <span className="text-slate-500">{r.description}</span> <a className="font-mono text-slate-400" href={`https://www.wikidata.org/wiki/${r.qid}`} target="_blank" rel="noreferrer">{r.qid}</a></span>
          <button className="text-indigo-600 hover:underline" onClick={() => add('about', r)}>+ Trata de</button>
          <button className="text-indigo-600 hover:underline" onClick={() => add('mentions', r)}>+ Menciona</button>
        </li>
      ))}
    </ul>
  );
  const dis = !can('content:edit');
  return (
    <div className="space-y-3 text-xs border-t border-slate-200 dark:border-slate-800 pt-3">
      <div className="grid md:grid-cols-3 gap-2">
        <Field label="Tipo"><select aria-label="Tipo de página" className={`${inputCls} w-full`} disabled={dis} value={p.type} onChange={e => setP({ ...p, type: e.target.value })}>{types.map(t => <option key={t} value={t}>{TYPE_LABEL[t] ?? t}</option>)}</select></Field>
        <Field label="Autor"><select aria-label="Autor de la página" className={`${inputCls} w-full`} disabled={dis} value={p.authorId ?? ''} onChange={e => setP({ ...p, authorId: e.target.value || null })}><option value="">Sin autor</option>{authors.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
        <Field label="Fecha de publicación"><input aria-label="Fecha de publicación" type="date" className={`${inputCls} w-full`} disabled={dis} value={p.datePublished ?? ''} onChange={e => setP({ ...p, datePublished: e.target.value || null })} /></Field>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <div><span className="font-semibold">Trata de (about)</span><RefChips label="Trata de" items={p.about} onRemove={i => setP({ ...p, about: p.about.filter((_, j) => j !== i) })} /></div>
        <div><span className="font-semibold">Menciona (mentions)</span><RefChips label="Menciona" items={p.mentions} onRemove={i => setP({ ...p, mentions: p.mentions.filter((_, j) => j !== i) })} /></div>
      </div>
      <div className="flex flex-wrap gap-2 items-end">
        <Button variant="secondary" disabled={dis} onClick={() => apiGet<any>(`/api/v1/sites/${siteId}/entities/suggest?url=${encodeURIComponent(p.url)}`).then(setSug, setError)}><Search className="w-3.5 h-3.5" aria-hidden /> Sugerir entidades de Wikidata</Button>
        <input aria-label="Buscar en Wikidata" placeholder="Buscar en Wikidata…" className={`${inputCls} min-w-[14rem]`} value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && q.trim() && apiGet<Ref[]>(`/api/v1/wikidata/search?q=${encodeURIComponent(q)}`).then(setFound, setError)} />
        <Button variant="secondary" disabled={!q.trim()} onClick={() => apiGet<Ref[]>(`/api/v1/wikidata/search?q=${encodeURIComponent(q)}`).then(setFound, setError)}>Buscar</Button>
      </div>
      {found && <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900">{found.length ? <ResultList items={found} /> : 'Sin resultados.'}</div>}
      {sug && (
        <div className="p-2 rounded-lg bg-slate-50 dark:bg-slate-900 space-y-2">
          {!sug.length ? 'No se encontraron frases en la página.' : sug.map(s => <div key={s.phrase}><div className="text-slate-500">«{s.phrase}»</div>{s.results.length ? <ResultList items={s.results} /> : <span className="text-slate-400">Sin coincidencias.</span>}</div>)}
          <p className="text-slate-500">Elige solo entidades que de verdad sean el tema (about) o se nombren en la página (mentions). Revisa la descripción: hay homónimos.</p>
        </div>
      )}
      <div className="flex gap-2"><Button disabled={dis} onClick={save}>Guardar página</Button></div>
      {msg && <p role="status" className="text-emerald-700">{msg}</p>}
      <ErrorBox error={error} />
      {graph && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold">JSON-LD conectado</h4>
            {graph.warnings.length ? <Badge tone="warn">{graph.warnings.length} aviso(s)</Badge> : <Badge tone="good">Completo</Badge>}
            <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(`<script type="application/ld+json">\n${graph.json}\n</script>`)}><Copy className="w-3.5 h-3.5" aria-hidden /> Copiar</Button>
            <Button variant="secondary" disabled={!can('content:edit')} onClick={propose}><Send className="w-3.5 h-3.5" aria-hidden /> Proponer en WordPress</Button>
            <button className="text-indigo-600 underline" onClick={() => go('seochanges')}>Ver Cambios SEO</button>
          </div>
          {graph.warnings.length > 0 && <ul className="list-disc ml-5 text-amber-700 dark:text-amber-400">{graph.warnings.map(w => <li key={w}>{w}</li>)}</ul>}
          <pre aria-label="JSON-LD de la página" className="font-mono text-[11px] whitespace-pre-wrap break-words bg-slate-50 dark:bg-slate-900 p-2 rounded max-h-72 overflow-auto">{graph.json}</pre>
          <p className="text-slate-500">"Proponer en WordPress" necesita la versión 2 del mu-plugin (docs/wordpress/glitch-seo-meta.php). Si tu tema o tu plugin SEO ya imprimen schema de Organization o Article, desactiva el suyo para no duplicar entidades.</p>
        </div>
      )}
    </div>
  );
}

function Pages({ siteId, authors, types, go }: { siteId: string; authors: Author[]; types: string[]; go: GoFn }) {
  const [d, setD] = useState<{ crawl: any; pages: PageRow[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const load = useCallback(() => apiGet<any>(`/api/v1/sites/${siteId}/entities/pages`).then(setD, setError), [siteId]);
  useEffect(() => {
    load();
  }, [load]);
  const rows = useMemo(() => (d?.pages ?? []).filter(p => !q.trim() || p.url.toLowerCase().includes(q.toLowerCase()) || (p.title ?? '').toLowerCase().includes(q.toLowerCase())), [d, q]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={5} />;
  if (!d.crawl) return <Empty>Haz un crawl del sitio para asignar autores y entidades a sus páginas. <button className="text-indigo-600 underline" onClick={() => go('crawler')}>Ir a Crawl y auditoría</button></Empty>;
  const name = (id: string | null) => authors.find(a => a.id === id)?.name;
  return (
    <div className="space-y-2 text-xs">
      <p className="text-slate-500">Asigna a cada página su tipo, su autor y las entidades de Wikidata de las que trata o que menciona. Primero salen los artículos y las páginas con más clics.</p>
      <input aria-label="Buscar página" placeholder="Buscar URL o título" className={`${inputCls} w-full max-w-md`} value={q} onChange={e => setQ(e.target.value)} />
      <ul className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl">
        {rows.slice(0, 200).map(p => (
          <li key={p.url} className="p-2">
            <button className="w-full flex flex-wrap items-center gap-2 text-left" aria-expanded={open === p.url} onClick={() => setOpen(open === p.url ? null : p.url)}>
              <span className="font-mono text-[11px] flex-1 min-w-[12rem] break-all">{path(p.url)}<span className="block font-sans text-slate-500">{p.title}</span></span>
              <Badge>{TYPE_LABEL[p.type] ?? p.type}</Badge>
              {name(p.authorId) ? <Badge tone="good">{name(p.authorId)}</Badge> : /Article|BlogPosting|NewsArticle/.test(p.type) && <Badge tone="warn">Sin autor</Badge>}
              {p.about.length > 0 && <Badge tone="good">{p.about.length + p.mentions.length} entidades</Badge>}
              {p.clicks !== null && <span className="text-slate-500 tabular-nums">{fmt(p.clicks)} clics</span>}
            </button>
            {open === p.url && <PageEditor key={p.url} siteId={siteId} page={p} authors={authors} types={types} onSaved={load} go={go} />}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Entidades y E-E-A-T: the site's entity profile (Organization, authors, page entities) and its E-E-A-T audit. */
export function EntitiesView({ siteId, go }: { siteId: string; go: GoFn }) {
  const [tab, setTab] = useState<'audit' | 'org' | 'authors' | 'pages'>('audit');
  const [d, setD] = useState<{ org: Org; authors: Author[]; types: string[] } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => apiGet<any>(`/api/v1/sites/${siteId}/entities`).then(setD, setError), [siteId]);
  useEffect(() => {
    load();
  }, [load]);
  if (error) return <ErrorBox error={error} />;
  if (!d) return <Skeleton rows={5} />;
  return (
    <Card>
      <p className="text-xs text-slate-500 mb-3">Un "perfil de entidad" conecta la organización, sus autores y el tema de cada página en un solo grafo de Schema.org, enlazado a Wikidata y Wikipedia. Así Google y los motores de IA entienden quién publica, quién escribe y de qué trata cada página.</p>
      <div role="tablist" aria-label="Entidades" className="flex flex-wrap gap-1 mb-4">
        {([['audit', 'Auditoría E-E-A-T'], ['org', 'Organización'], ['authors', `Autores (${d.authors.length})`], ['pages', 'Páginas']] as const).map(([id, l]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'}`}>{l}</button>
        ))}
      </div>
      {tab === 'audit' && <Audit key={d.authors.length} siteId={siteId} go={go} />}
      {tab === 'org' && <OrgForm siteId={siteId} org={d.org} onSaved={load} />}
      {tab === 'authors' && <Authors siteId={siteId} authors={d.authors} reload={load} />}
      {tab === 'pages' && <Pages siteId={siteId} authors={d.authors} types={d.types} go={go} />}
    </Card>
  );
}
