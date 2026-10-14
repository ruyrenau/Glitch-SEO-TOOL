'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronRight, Copy, Download, ExternalLink, FileUp, Plus, Save, Trash2, Wand2, XCircle } from 'lucide-react';
import { CATALOG, CUSTOM_TYPE_ID, buildJsonLd, toScriptTag, validateSchema, fillTemplate, templatePlaceholders, parseCsv, findTypeDef, type FieldDef, type FormObject, type FormValue, type SchemaForm, type SchemaReport } from '@glitch/schema-engine';
import { apiGet, apiSend, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, Card, Empty, ErrorBox, inputCls } from './ui';

const tzOffset = () => {
  const m = -new Date().getTimezoneOffset();
  const s = m >= 0 ? '+' : '-';
  const a = Math.abs(m);
  return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
};
const newForm = (typeId: string): SchemaForm => ({ typeId, type: typeId === CUSTOM_TYPE_ID ? '' : findTypeDef(typeId)?.subtypes[0][0] ?? typeId, values: {}, extra: [] });
const download = (name: string, text: string, type: string) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
};
const copy = (t: string) => navigator.clipboard?.writeText(t);

// ---------------------------------------------------------------- field editors

function inputType(f: FieldDef) {
  return f.kind === 'date' ? 'date' : f.kind === 'datetime' ? 'datetime-local' : f.kind === 'time' ? 'time' : f.kind === 'email' ? 'email' : f.kind === 'url' || f.kind === 'image' ? 'url' : 'text';
}

function Label({ f }: { f: FieldDef }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5 font-semibold">
      {f.label}
      {f.required && <span className="text-rose-600" title="Google lo exige">*</span>}
      {f.recommended && <span className="text-[10px] font-normal px-1.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">recomendado</span>}
    </span>
  );
}

function Scalar({ f, value, onChange, ariaLabel }: { f: FieldDef; value: string; onChange: (v: string) => void; ariaLabel: string }) {
  if (f.kind === 'textarea') return <textarea aria-label={ariaLabel} rows={3} className={`${inputCls} w-full`} placeholder={f.placeholder} value={value} onChange={e => onChange(e.target.value)} />;
  if (f.kind === 'enum')
    return (
      <select aria-label={ariaLabel} className={`${inputCls} w-full`} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    );
  return <input aria-label={ariaLabel} type={inputType(f)} inputMode={f.kind === 'number' || f.kind === 'integer' ? 'decimal' : undefined} className={`${inputCls} w-full ${f.kind === 'url' || f.kind === 'image' ? 'font-mono' : ''}`} placeholder={f.placeholder} value={value} onChange={e => onChange(e.target.value)} />;
}

function FieldEditor({ f, value, onChange, path }: { f: FieldDef; value: FormValue; onChange: (v: FormValue) => void; path: string }) {
  const aria = path ? `${path} › ${f.label}` : f.label;
  if (f.kind === 'boolean')
    return (
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={value === true} onChange={e => onChange(e.target.checked)} /> <Label f={f} /></label>
    );
  if (f.kind === 'enum' && f.multiple) {
    const arr = Array.isArray(value) ? (value as string[]) : [];
    return (
      <fieldset className="text-xs space-y-1"><legend><Label f={f} /></legend>
        <div className="flex flex-wrap gap-2">
          {f.options?.map(([v, l]) => (
            <label key={v} className="flex items-center gap-1"><input type="checkbox" checked={arr.includes(v)} onChange={e => onChange(e.target.checked ? [...arr, v] : arr.filter(x => x !== v))} />{l}</label>
          ))}
        </div>
      </fieldset>
    );
  }
  if (f.kind === 'object') {
    const one = (obj: FormObject, set: (o: FormObject) => void, idx?: number) => (
      <div className="space-y-2 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/40">
        {f.itemTypes && (
          <select aria-label={`${aria} › tipo`} className={inputCls} value={obj['@type'] ?? f.itemTypes[0]} onChange={e => set({ ...obj, '@type': e.target.value })}>
            {f.itemTypes.map(t => <option key={t} value={t}>{t === 'Person' ? 'Persona' : t === 'Organization' ? 'Organización' : t}</option>)}
          </select>
        )}
        <div className="grid sm:grid-cols-2 gap-2">
          {f.fields?.map(sub => (
            <div key={sub.key} className={sub.kind === 'textarea' || sub.kind === 'object' || sub.multiple ? 'sm:col-span-2' : ''}>
              <FieldEditor f={sub} value={obj[sub.key]} path={idx !== undefined ? `${aria} ${idx + 1}` : aria} onChange={v => set({ ...obj, [sub.key]: v })} />
            </div>
          ))}
        </div>
      </div>
    );
    if (!f.multiple) {
      const obj = (value && !Array.isArray(value) && typeof value === 'object' ? value : {}) as FormObject;
      return <div className="text-xs space-y-1"><Label f={f} />{f.help && <p className="text-[11px] text-slate-500">{f.help}</p>}{one(obj, onChange)}</div>;
    }
    const list = (Array.isArray(value) ? value : []) as FormObject[];
    return (
      <div className="text-xs space-y-1.5">
        <Label f={f} />
        {f.help && <p className="text-[11px] text-slate-500">{f.help}</p>}
        {list.map((o, i) => (
          <div key={i} className="relative">
            {one(o, n => onChange(list.map((x, j) => (j === i ? n : x))), i)}
            <button aria-label={`Quitar ${f.label} ${i + 1}`} className="absolute top-1 right-1 p-1 text-slate-400 hover:text-rose-600" onClick={() => onChange(list.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <Button variant="secondary" onClick={() => onChange([...list, {}])}><Plus className="w-3.5 h-3.5" aria-hidden /> Agregar {f.label.toLowerCase()}</Button>
      </div>
    );
  }
  if (f.multiple) {
    const arr = Array.isArray(value) ? (value as string[]) : typeof value === 'string' && value ? [value] : [];
    const rows = arr.length ? arr : [''];
    return (
      <div className="text-xs space-y-1">
        <Label f={f} />
        {f.help && <p className="text-[11px] text-slate-500">{f.help}</p>}
        {rows.map((v, i) => (
          <div key={i} className="flex gap-1.5">
            <Scalar f={f} value={v} ariaLabel={`${aria} ${i + 1}`} onChange={n => onChange(rows.map((x, j) => (j === i ? n : x)))} />
            {rows.length > 1 && <button aria-label={`Quitar ${f.label} ${i + 1}`} className="p-1 text-slate-400 hover:text-rose-600" onClick={() => onChange(rows.filter((_, j) => j !== i))}><Trash2 className="w-3.5 h-3.5" /></button>}
          </div>
        ))}
        <button className="text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => onChange([...rows, ''])}>+ otro</button>
      </div>
    );
  }
  return (
    <label className="block text-xs space-y-1">
      <Label f={f} />
      <Scalar f={f} value={typeof value === 'string' ? value : ''} ariaLabel={aria} onChange={onChange} />
      {f.help && <span className="block text-[11px] text-slate-500">{f.help}</span>}
    </label>
  );
}

function SchemaFormCard({ form, onChange, onRemove, index }: { form: SchemaForm; onChange: (f: SchemaForm) => void; onRemove: () => void; index: number }) {
  const def = form.typeId === CUSTOM_TYPE_ID ? undefined : findTypeDef(form.typeId);
  const [more, setMore] = useState(false);
  const main = def?.fields.filter(f => f.required || f.recommended) ?? [];
  const rest = def?.fields.filter(f => !f.required && !f.recommended) ?? [];
  const setVal = (k: string, v: FormValue) => onChange({ ...form, values: { ...form.values, [k]: v } });
  return (
    <section aria-label={`Schema ${index + 1}`} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
      <div className="flex flex-wrap items-end gap-2 text-xs">
        <label className="space-y-1"><span className="block font-semibold">Tipo</span>
          <select aria-label={`Tipo del schema ${index + 1}`} className={inputCls} value={form.typeId} onChange={e => onChange({ ...newForm(e.target.value), values: form.values, extra: form.extra })}>
            {CATALOG.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            <option value={CUSTOM_TYPE_ID}>Otro tipo de schema.org…</option>
          </select>
        </label>
        {def && def.subtypes.length > 1 && (
          <label className="space-y-1"><span className="block font-semibold">Giro / variante</span>
            <select aria-label={`Variante del schema ${index + 1}`} className={inputCls} value={form.type} onChange={e => onChange({ ...form, type: e.target.value })}>
              {def.subtypes.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        )}
        {!def && (
          <label className="space-y-1"><span className="block font-semibold">@type de schema.org</span>
            <input aria-label={`Tipo personalizado del schema ${index + 1}`} className={`${inputCls} font-mono`} placeholder="Mosque, Library, Brewery…" value={form.type} onChange={e => onChange({ ...form, type: e.target.value })} />
          </label>
        )}
        <button aria-label={`Quitar schema ${index + 1}`} className="ml-auto p-1.5 text-slate-400 hover:text-rose-600" onClick={onRemove}><Trash2 className="w-4 h-4" /></button>
      </div>
      {def && <p className="text-[11px] text-slate-500">{def.description} <span className="italic">Ej.: {def.examples}.</span></p>}
      {!def && <p className="text-[11px] text-slate-500">Escribe cualquier tipo de <a className="underline" href="https://schema.org/docs/full.html" target="_blank" rel="noreferrer">schema.org</a> y agrega sus propiedades abajo.</p>}
      <div className="grid md:grid-cols-2 gap-3">
        {main.map(f => <div key={f.key} className={f.kind === 'object' || f.kind === 'textarea' || f.multiple ? 'md:col-span-2' : ''}><FieldEditor f={f} value={form.values[f.key]} path="" onChange={v => setVal(f.key, v)} /></div>)}
      </div>
      {rest.length > 0 && (
        <div>
          <button className="text-xs font-semibold inline-flex items-center gap-1" aria-expanded={more} onClick={() => setMore(m => !m)}>{more ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} Más campos ({rest.length})</button>
          {more && <div className="grid md:grid-cols-2 gap-3 mt-2">{rest.map(f => <div key={f.key} className={f.kind === 'object' || f.kind === 'textarea' || f.multiple ? 'md:col-span-2' : ''}><FieldEditor f={f} value={form.values[f.key]} path="" onChange={v => setVal(f.key, v)} /></div>)}</div>}
        </div>
      )}
      <div className="text-xs space-y-1.5">
        <span className="font-semibold">Propiedades adicionales</span>
        <p className="text-[11px] text-slate-500">Para cualquier propiedad de schema.org que el formulario no tenga. El valor puede ser texto o JSON ({'{"@type":"…"}'} o [ … ]).</p>
        {(form.extra ?? []).map((e, i) => (
          <div key={i} className="grid grid-cols-[10rem_1fr_auto] gap-1.5">
            <input aria-label={`Propiedad adicional ${i + 1}`} className={`${inputCls} font-mono`} placeholder="hasMap" value={e.key} onChange={ev => onChange({ ...form, extra: form.extra!.map((x, j) => (j === i ? { ...x, key: ev.target.value } : x)) })} />
            <input aria-label={`Valor adicional ${i + 1}`} className={`${inputCls} font-mono`} placeholder="https://maps.google.com/…" value={e.value} onChange={ev => onChange({ ...form, extra: form.extra!.map((x, j) => (j === i ? { ...x, value: ev.target.value } : x)) })} />
            <button aria-label={`Quitar propiedad ${i + 1}`} className="p-1 text-slate-400 hover:text-rose-600" onClick={() => onChange({ ...form, extra: form.extra!.filter((_, j) => j !== i) })}><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        ))}
        <button className="text-indigo-600 dark:text-indigo-400 hover:underline" onClick={() => onChange({ ...form, extra: [...(form.extra ?? []), { key: '', value: '' }] })}>+ propiedad</button>
      </div>
    </section>
  );
}

function ReportView({ report }: { report: SchemaReport }) {
  return (
    <div className="space-y-2 text-xs" aria-live="polite">
      <div className={`flex items-center gap-2 font-bold text-sm ${report.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
        {report.ok ? <CheckCircle2 className="w-4 h-4" aria-hidden /> : <XCircle className="w-4 h-4" aria-hidden />}
        {report.ok ? 'Listo para Google' : 'Hay que corregir'}
      </div>
      {report.errors.map(e => <div key={e} className="p-2 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300">✕ {e}</div>)}
      {report.warnings.map(w => <div key={w} className="p-2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300">! {w}</div>)}
      {report.nodes.map((n, i) => (
        <div key={i} className="space-y-1">
          <div className="font-semibold">{n.label} <span className="font-mono text-slate-500">({n.type})</span> {!n.errors.length && <Badge tone="good">sin errores</Badge>}</div>
          {n.richResult && <p className="text-[11px] text-slate-500">Resultado enriquecido posible: {n.richResult}.</p>}
          {n.errors.map(e => <div key={e} className="p-2 rounded bg-rose-500/10 text-rose-700 dark:text-rose-300">✕ {e}</div>)}
          {n.warnings.map(w => <div key={w} className="p-2 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300">! {w}</div>)}
        </div>
      ))}
      <p className="text-[11px] text-slate-500">Cumplir esto no garantiza que Google muestre el resultado enriquecido; el contenido debe coincidir con lo visible en la página.</p>
    </div>
  );
}

// ---------------------------------------------------------------- main view

interface Prefill {
  finalUrl: string;
  hints: { title: string | null; existing: Array<{ type: string; json: unknown }> };
  suggestions: Array<{ typeId: string; type: string; values: Record<string, FormValue>; reason: string }>;
}
interface Template { id: string; name: string; forms: SchemaForm[]; updatedAt: string }

export function SchemaGeneratorView() {
  const { can } = useAuth();
  const [tab, setTab] = useState<'generator' | 'bulk' | 'templates' | 'validator'>('generator');
  const [pageUrl, setPageUrl] = useState('');
  const [forms, setForms] = useState<SchemaForm[]>([newForm('Organization')]);
  const [prefill, setPrefill] = useState<Prefill | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [templates, setTemplates] = useState<Template[] | null>(null);
  const [tplName, setTplName] = useState('');
  const [addType, setAddType] = useState('FAQPage');
  const tz = useMemo(tzOffset, []);

  const jsonLd = useMemo(() => buildJsonLd(forms, { pageUrl: /^https?:\/\//.test(pageUrl) ? pageUrl : undefined, tzOffset: tz }), [forms, pageUrl, tz]);
  const report = useMemo(() => validateSchema(jsonLd), [jsonLd]);
  const tag = useMemo(() => toScriptTag(jsonLd), [jsonLd]);

  const loadTemplates = () => apiGet<Template[]>('/api/v1/schema-templates').then(setTemplates).catch(setError);
  useEffect(() => {
    loadTemplates();
  }, []);

  const run = async (fn: () => Promise<void>, ok?: string) => {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg(ok);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const doPrefill = () =>
    run(async () => {
      const r = await apiSend<Prefill>('POST', '/api/v1/schema/prefill', { url: pageUrl.trim() });
      setPrefill(r);
      setPageUrl(r.finalUrl);
      setForms(r.suggestions.map(s => ({ typeId: s.typeId, type: s.type, values: s.values, extra: [] })));
    }, 'Listo: revisa y completa los campos.');

  const tabs = [['generator', 'Generador'], ['bulk', 'Masivo (CSV)'], ['templates', `Plantillas${templates ? ` (${templates.length})` : ''}`], ['validator', 'Validador']] as const;

  return (
    <div className="space-y-5">
      <div role="tablist" aria-label="Herramientas de schema" className="flex flex-wrap gap-1">
        {tabs.map(([id, label]) => <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${tab === id ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-200 dark:border-slate-700'}`}>{label}</button>)}
      </div>
      <ErrorBox error={error} />
      {msg && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{msg}</p>}

      {tab === 'generator' && (
        <>
          <Card title={<span className="flex items-center gap-2"><Wand2 className="w-4 h-4" aria-hidden /> Página</span>}>
            <div className="text-xs space-y-2">
              <p className="text-slate-600 dark:text-slate-300">Pega la URL de cualquier página. La herramienta la lee y propone los schemas que le corresponden con lo que la página ya dice (título, imágenes, precio, fechas, autor, teléfono, dirección, redes, migas de pan, preguntas frecuentes, video). También puedes empezar en blanco eligiendo el tipo abajo.</p>
              <div className="flex flex-wrap gap-2">
                <input aria-label="Página a leer" className={`${inputCls} flex-1 min-w-[18rem] font-mono`} placeholder="https://www.misitio.com/pagina" value={pageUrl} onChange={e => setPageUrl(e.target.value)} />
                <Button disabled={busy || !/^https?:\/\/.+\..+/.test(pageUrl.trim())} onClick={doPrefill}><Wand2 className="w-3.5 h-3.5" aria-hidden /> {busy ? 'Leyendo…' : 'Rellenar desde la página'}</Button>
              </div>
              {prefill && (
                <div className="space-y-1">
                  {prefill.suggestions.map((s, i) => <p key={i} className="text-slate-500">• <strong>{findTypeDef(s.typeId)?.label ?? s.typeId}</strong>: {s.reason}</p>)}
                  {prefill.hints.existing.length > 0 && (
                    <p className="text-amber-700 dark:text-amber-400">
                      Esta página ya tiene schema: {prefill.hints.existing.map(e => e.type).join(', ')}.{' '}
                      <button className="underline" onClick={() => { setValidatorInput(JSON.stringify(prefill.hints.existing.map(e => e.json).length === 1 ? prefill.hints.existing[0].json : prefill.hints.existing.map(e => e.json), null, 2)); setTab('validator'); }}>Validar el actual</button>
                    </p>
                  )}
                </div>
              )}
            </div>
          </Card>

          <div className="grid xl:grid-cols-[1fr_28rem] gap-5 items-start">
            <div className="space-y-4">
              {forms.map((f, i) => <SchemaFormCard key={i} index={i} form={f} onChange={n => setForms(fs => fs.map((x, j) => (j === i ? n : x)))} onRemove={() => setForms(fs => fs.filter((_, j) => j !== i))} />)}
              {!forms.length && <Empty>Agrega un schema.</Empty>}
              <div className="flex flex-wrap gap-2 items-center text-xs">
                <select aria-label="Tipo a agregar" className={inputCls} value={addType} onChange={e => setAddType(e.target.value)}>
                  {CATALOG.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  <option value={CUSTOM_TYPE_ID}>Otro tipo de schema.org…</option>
                </select>
                <Button variant="secondary" onClick={() => setForms(fs => [...fs, newForm(addType)])}><Plus className="w-3.5 h-3.5" aria-hidden /> Agregar otro schema a esta página</Button>
              </div>
            </div>
            <div className="space-y-4 xl:sticky xl:top-4">
              <Card title="Resultado">
                <div className="space-y-3 text-xs">
                  <pre aria-label="JSON-LD generado" className="font-mono text-[11px] whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-900 rounded p-3 max-h-96 overflow-auto">{tag}</pre>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => { copy(tag); setMsg('Etiqueta copiada: pégala en el <head> de la página.'); }}><Copy className="w-3.5 h-3.5" aria-hidden /> Copiar etiqueta</Button>
                    <Button variant="secondary" onClick={() => { copy(JSON.stringify(jsonLd, null, 2)); setMsg('JSON copiado.'); }}>Copiar JSON</Button>
                    <Button variant="secondary" onClick={() => download('schema.json', JSON.stringify(jsonLd, null, 2), 'application/ld+json')}><Download className="w-3.5 h-3.5" aria-hidden /> .json</Button>
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Pruébalo también en <a className="underline inline-flex items-center gap-0.5" href="https://search.google.com/test/rich-results" target="_blank" rel="noreferrer">la prueba de Google <ExternalLink className="w-3 h-3" /></a> y en <a className="underline inline-flex items-center gap-0.5" href="https://validator.schema.org/" target="_blank" rel="noreferrer">validator.schema.org <ExternalLink className="w-3 h-3" /></a> (pega el código).
                  </p>
                  {can('content:edit') && (
                    <div className="flex gap-2">
                      <input aria-label="Nombre de la plantilla" className={`${inputCls} flex-1`} placeholder="Nombre para guardarla como plantilla" value={tplName} onChange={e => setTplName(e.target.value)} />
                      <Button variant="secondary" disabled={!tplName.trim() || busy} onClick={() => run(async () => { await apiSend('POST', '/api/v1/schema-templates', { name: tplName.trim(), forms }); setTplName(''); await loadTemplates(); }, 'Plantilla guardada.')}><Save className="w-3.5 h-3.5" aria-hidden /> Guardar</Button>
                    </div>
                  )}
                </div>
              </Card>
              <Card title="Validación en vivo"><ReportView report={report} /></Card>
            </div>
          </div>
        </>
      )}

      {tab === 'bulk' && <BulkPanel forms={forms} templates={templates ?? []} tz={tz} />}

      {tab === 'templates' && (
        <Card title="Plantillas guardadas">
          {!templates?.length ? <Empty>Guarda una plantilla desde el Generador. Usa {'{{columna}}'} en los campos para rellenarla luego con un CSV.</Empty> : (
            <ul className="space-y-2 text-xs">
              {templates.map(t => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
                  <span className="font-semibold text-sm">{t.name}</span>
                  <span className="text-slate-500">{t.forms.map(f => findTypeDef(f.typeId)?.label ?? f.type).join(' + ')} · {fmtDate(t.updatedAt)}</span>
                  {templatePlaceholders(t.forms[0]).length > 0 && <Badge>usa {t.forms.flatMap(templatePlaceholders).length} columnas</Badge>}
                  <span className="ml-auto flex gap-2">
                    <Button variant="secondary" onClick={() => { setForms(t.forms); setTab('generator'); }}>Abrir</Button>
                    {can('content:edit') && <Button variant="secondary" onClick={() => confirm(`¿Borrar la plantilla "${t.name}"?`) && run(async () => { await apiSend('DELETE', `/api/v1/schema-templates/${t.id}`); await loadTemplates(); })}><Trash2 className="w-3.5 h-3.5" aria-hidden /></Button>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {tab === 'validator' && <ValidatorPanel />}
    </div>
  );
}

// Shared between the generator ("Validar el actual") and the validator tab.
let validatorSeed = '';
function setValidatorInput(v: string) {
  validatorSeed = v;
}

function ValidatorPanel() {
  const [text, setText] = useState(() => validatorSeed || '{\n  "@context": "https://schema.org",\n  "@type": "Organization",\n  "name": "Mi empresa",\n  "url": "https://www.miempresa.com"\n}');
  const [url, setUrl] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const report = useMemo(() => validateSchema(text), [text]);
  const fromUrl = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<Prefill>('POST', '/api/v1/schema/prefill', { url: url.trim() });
      if (!r.hints.existing.length) throw new Error('Esa página no tiene JSON-LD. Puedes generarlo en la pestaña Generador.');
      const blocks = r.hints.existing.map(e => e.json);
      setText(JSON.stringify(blocks.length === 1 ? blocks[0] : blocks, null, 2));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Validador de schema">
      <div className="grid md:grid-cols-2 gap-6 text-xs">
        <div className="space-y-2">
          <div className="flex gap-2">
            <input aria-label="URL a validar" className={`${inputCls} flex-1 font-mono`} placeholder="https://… (lee el schema que ya tiene la página)" value={url} onChange={e => setUrl(e.target.value)} />
            <Button variant="secondary" disabled={busy || !/^https?:\/\/.+\..+/.test(url.trim())} onClick={fromUrl}>Leer</Button>
          </div>
          <label className="block space-y-1"><span className="font-semibold">JSON-LD o etiqueta {'<script>'}</span>
            <textarea aria-label="JSON-LD a validar" rows={18} className={`${inputCls} w-full font-mono`} spellCheck={false} value={text} onChange={e => setText(e.target.value)} />
          </label>
          <ErrorBox error={error} />
        </div>
        <ReportView report={report} />
      </div>
    </Card>
  );
}

function BulkPanel({ forms, templates, tz }: { forms: SchemaForm[]; templates: Template[]; tz: string }) {
  const [source, setSource] = useState<string>('current');
  const [csv, setCsv] = useState('');
  const [urlCol, setUrlCol] = useState('');
  const tplForms = source === 'current' ? forms : templates.find(t => t.id === source)?.forms ?? [];
  const parsed = useMemo(() => (csv.trim() ? parseCsv(csv) : { headers: [], rows: [] }), [csv]);
  const placeholders = useMemo(() => [...new Set(tplForms.flatMap(templatePlaceholders))], [tplForms]);
  const missing = placeholders.filter(p => parsed.headers.length && !parsed.headers.includes(p));
  const results = useMemo(
    () =>
      parsed.rows.slice(0, 5000).map(row => {
        const json = buildJsonLd(tplForms.map(f => fillTemplate(f, row)), { pageUrl: urlCol && /^https?:/.test(row[urlCol] ?? '') ? row[urlCol] : undefined, tzOffset: tz });
        const r = validateSchema(json);
        return { row, json, ok: r.ok, errors: r.errors.length + r.nodes.reduce((n, x) => n + x.errors.length, 0) };
      }),
    [parsed, tplForms, urlCol, tz]
  );
  const ok = results.filter(r => r.ok).length;
  const exportCsv = () => {
    const esc = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    const head = [...parsed.headers, 'schema_jsonld', 'schema_valido'];
    const lines = results.map(r => [...parsed.headers.map(h => r.row[h] ?? ''), toScriptTag(r.json), r.ok ? 'sí' : 'no'].map(esc).join(','));
    download('schemas.csv', '﻿' + [head.join(','), ...lines].join('\n'), 'text/csv;charset=utf-8');
  };
  return (
    <Card title="Generación masiva desde CSV">
      <div className="text-xs space-y-3">
        <p className="text-slate-600 dark:text-slate-300">Usa una plantilla con {'{{columna}}'} en los campos (por ejemplo, Nombre = {'{{nombre}}'}, Precio = {'{{precio}}'}) y un CSV con esas columnas: se genera un schema por fila. Útil para catálogos, sucursales, cursos, vacantes o eventos.</p>
        <div className="flex flex-wrap gap-3 items-end">
          <label className="space-y-1"><span className="block font-semibold">Plantilla</span>
            <select aria-label="Plantilla para el CSV" className={inputCls} value={source} onChange={e => setSource(e.target.value)}>
              <option value="current">Lo que está en el Generador</option>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer"><FileUp className="w-3.5 h-3.5" aria-hidden /> Subir CSV
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={async e => { const f = e.target.files?.[0]; if (f) setCsv(await f.text()); }} />
          </label>
          {parsed.headers.length > 0 && (
            <label className="space-y-1"><span className="block font-semibold">Columna con la URL de cada página (opcional)</span>
              <select aria-label="Columna de URL" className={inputCls} value={urlCol} onChange={e => setUrlCol(e.target.value)}>
                <option value="">—</option>
                {parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
          )}
        </div>
        <textarea aria-label="Contenido CSV" rows={6} className={`${inputCls} w-full font-mono`} placeholder={'nombre,precio,sku,url\nSilla Eames,1499,S-1,https://tienda.mx/silla'} value={csv} onChange={e => setCsv(e.target.value)} />
        <p className="text-slate-500">Columnas que usa la plantilla: {placeholders.length ? placeholders.map(p => <code key={p} className="mx-0.5">{p}</code>) : 'ninguna (agrega {{columna}} en los campos)'}</p>
        {missing.length > 0 && <p className="text-rose-600">El CSV no tiene estas columnas: {missing.join(', ')}.</p>}
        {results.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge tone={ok === results.length ? 'good' : 'warn'}>{ok} de {results.length} válidos</Badge>
              <Button onClick={exportCsv}><Download className="w-3.5 h-3.5" aria-hidden /> Descargar CSV con los schemas</Button>
              <Button variant="secondary" onClick={() => download('schemas.jsonl', results.map(r => JSON.stringify(r.json)).join('\n'), 'application/x-ndjson')}>.jsonl</Button>
            </div>
            <div className="overflow-auto max-h-80">
              <table className="w-full">
                <thead><tr className="text-slate-500 text-left"><th className="py-1">#</th>{parsed.headers.slice(0, 3).map(h => <th key={h}>{h}</th>)}<th>Estado</th><th>Vista previa</th></tr></thead>
                <tbody>
                  {results.slice(0, 50).map((r, i) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-800 align-top">
                      <td className="py-1 pr-2 tabular-nums">{i + 1}</td>
                      {parsed.headers.slice(0, 3).map(h => <td key={h} className="pr-2 max-w-[10rem] truncate">{r.row[h]}</td>)}
                      <td className="pr-2">{r.ok ? <Badge tone="good">válido</Badge> : <Badge tone="bad">{r.errors} errores</Badge>}</td>
                      <td><details><summary className="cursor-pointer">ver</summary><pre className="font-mono text-[10px] whitespace-pre-wrap max-w-md">{JSON.stringify(r.json, null, 2)}</pre></details></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {results.length > 50 && <p className="text-slate-500 mt-1">Se muestran 50; la descarga incluye todas.</p>}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
