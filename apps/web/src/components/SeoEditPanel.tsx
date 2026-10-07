'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { apiGet, apiSend } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Badge, Button, ErrorBox, Skeleton, inputCls } from './ui';
import type { ExplorerDetail } from './ExplorerView';

type Field = 'postTitle' | 'slug' | 'seoTitle' | 'metaDescription' | 'imageAlt';
interface Lookup {
  item: null | { target: string; wpId: number; status: string; link: string; postTitle: string; slug: string; metaProvider: string | null; seoTitle: string | null; metaDescription: string | null };
  images: Array<{ src: string; mediaId: number | null; alt: string | null }>;
  pending: Array<{ id: string; field: Field; newValue: string; status: string; imageSrc: string | null }>;
  error: string | null;
}

const LIMITS: Partial<Record<Field, [number, number]>> = { seoTitle: [30, 60], postTitle: [30, 60], metaDescription: [70, 155] };

function Counter({ field, value }: { field: Field; value: string }) {
  const l = LIMITS[field];
  if (!l) return null;
  const n = value.length;
  const tone = n === 0 ? 'bad' : n < l[0] || n > l[1] ? 'warn' : 'good';
  return <Badge tone={tone}>{n} car. · ideal {l[0]}–{l[1]}</Badge>;
}

function FieldEditor({ label, field, current, help, pending, onPropose, canEdit }: { label: string; field: Field; current: string; help?: string; pending?: { newValue: string; status: string }; onPropose: (v: string, note: string) => Promise<void>; canEdit: boolean }) {
  const [v, setV] = useState(current);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(current), [current]);
  const multiline = field === 'metaDescription' || field === 'imageAlt';
  const Input = multiline ? 'textarea' : 'input';
  return (
    <div className="space-y-1.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold">{label}</span>
        <Counter field={field} value={v} />
      </div>
      <div className="text-[11px] text-slate-500 break-words">Actual: {current ? <span className="text-slate-700 dark:text-slate-300">{current}</span> : <em>(vacío)</em>}</div>
      {help && <div className="text-[11px] text-amber-600 dark:text-amber-400">{help}</div>}
      {pending ? (
        <div className="text-[11px]"><Badge tone="warn">{pending.status === 'approved' ? 'aprobado, sin aplicar' : 'propuesto'}</Badge> {pending.newValue}</div>
      ) : canEdit ? (
        <>
          <Input aria-label={`Nuevo valor: ${label}`} className={`${inputCls} w-full ${multiline ? 'h-16' : ''}`} value={v} onChange={(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value)} />
          <div className="flex gap-2">
            <input aria-label={`Nota: ${label}`} className={`${inputCls} flex-1`} placeholder="Nota opcional (motivo del cambio)" value={note} onChange={e => setNote(e.target.value)} />
            <Button disabled={busy || v === current} onClick={async () => { setBusy(true); try { await onPropose(v, note); setNote(''); } finally { setBusy(false); } }}>Proponer cambio</Button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/** "Editar en WordPress": shown inside the explorer's URL detail. Changes are proposals; nothing touches WordPress until approved and applied in "Cambios SEO". */
export function SeoEditPanel({ siteId, detail, goChanges }: { siteId: string; detail: ExplorerDetail; goChanges: () => void }) {
  const { can } = useAuth();
  const [data, setData] = useState<Lookup | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState('');
  const url = detail.page.finalUrl || detail.page.url;
  const imgs = (detail.page.images ?? []).map(i => i.src).slice(0, 30);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await apiGet<Lookup>(`/api/v1/sites/${siteId}/seo-edits/lookup?url=${encodeURIComponent(url)}&images=${encodeURIComponent(imgs.join('\n'))}`));
    } catch (e) {
      setError(e);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, url]);
  useEffect(() => {
    load();
  }, [load]);

  const propose = async (field: Field, newValue: string, note: string, imageSrc?: string) => {
    setError(null);
    setMsg('');
    try {
      await apiSend('POST', `/api/v1/sites/${siteId}/seo-edits`, { url, field, newValue, note: note || undefined, imageSrc });
      setMsg('Cambio propuesto. Apruébalo y aplícalo en "Cambios SEO".');
      await load();
    } catch (e) {
      setError(e);
    }
  };

  if (error && !data) return <ErrorBox error={error} />;
  if (!data) return <Skeleton rows={4} />;
  const canEdit = can('content:edit');
  const pend = (f: Field, src?: string) => data.pending.find(p => p.field === f && (!src || p.imageSrc === src));
  const it = data.item;

  return (
    <div className="space-y-3 text-xs">
      <p className="text-slate-500">
        Los cambios se guardan como <strong>propuestas</strong>. WordPress no cambia hasta que alguien con permiso las aprueba y las aplica en{' '}
        <button className="text-indigo-600 dark:text-indigo-400 underline" onClick={goChanges}>Cambios SEO</button>. Solo se tocan estos campos; nunca el contenido ni el estado de publicación.
      </p>
      {!canEdit && <p className="text-amber-600">Tu rol solo puede ver. Para proponer cambios necesitas el permiso de edición de contenido.</p>}
      {msg && <div role="status" className="p-2 rounded-lg bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">{msg}</div>}
      <ErrorBox error={error} />
      {!it ? (
        <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500">{data.error}</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 items-center">
            <Badge>{it.target === 'page' ? 'Página' : 'Entrada'} #{it.wpId}</Badge>
            <Badge tone={it.status === 'publish' ? 'good' : 'warn'}>{it.status}</Badge>
            <Badge tone={it.metaProvider ? 'good' : 'warn'}>{it.metaProvider === 'yoast' ? 'Yoast SEO' : it.metaProvider === 'rankmath' ? 'Rank Math' : 'Sin plugin SEO expuesto'}</Badge>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <FieldEditor label="Título de la entrada (H1 y título por defecto)" field="postTitle" current={it.postTitle} pending={pend('postTitle')} canEdit={canEdit} onPropose={(v, n) => propose('postTitle', v, n)} />
            <FieldEditor label="Slug (URL)" field="slug" current={it.slug} help="Cambiar el slug cambia la URL. WordPress redirige la URL vieja solo en entradas; en páginas crea una redirección 301." pending={pend('slug')} canEdit={canEdit} onPropose={(v, n) => propose('slug', v, n)} />
            {it.metaProvider ? (
              <>
                <FieldEditor label="Título SEO (etiqueta <title>)" field="seoTitle" current={it.seoTitle ?? ''} help={it.seoTitle ? undefined : 'Vacío: el plugin usa su plantilla (normalmente el título de la entrada).'} pending={pend('seoTitle')} canEdit={canEdit} onPropose={(v, n) => propose('seoTitle', v, n)} />
                <FieldEditor label="Meta description" field="metaDescription" current={it.metaDescription ?? ''} pending={pend('metaDescription')} canEdit={canEdit} onPropose={(v, n) => propose('metaDescription', v, n)} />
              </>
            ) : (
              <div className="lg:col-span-2 p-3 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                Para editar título SEO y meta description, el sitio necesita Yoast SEO o Rank Math activos y el mu-plugin <code>docs/wordpress/glitch-seo-meta.php</code> instalado en <code>wp-content/mu-plugins/</code>.
              </div>
            )}
          </div>
        </>
      )}
      {data.images.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-semibold">Texto alternativo de imágenes</h4>
          <p className="text-[11px] text-slate-500">Se cambia en la biblioteca de medios. WordPress copia el alt dentro del contenido al insertar una imagen, así que las imágenes ya insertadas pueden seguir mostrando el alt anterior.</p>
          {data.images.map(im =>
            im.mediaId === null ? (
              <div key={im.src} className="text-[11px] text-slate-500 break-all"><span className="font-mono">{im.src}</span> · no está en la biblioteca de medios</div>
            ) : (
              <FieldEditor key={im.src} label={im.src.split('/').pop() ?? im.src} field="imageAlt" current={im.alt ?? ''} pending={pend('imageAlt', im.src)} canEdit={canEdit} onPropose={(v, n) => propose('imageAlt', v, n, im.src)} />
            )
          )}
        </div>
      )}
    </div>
  );
}
