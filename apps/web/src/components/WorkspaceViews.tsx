'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Copy, LogOut, Mail, Trash2 } from 'lucide-react';
import { apiGet, apiSend, fmt, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Role } from '@/lib/types';
import { Badge, Button, Card, Empty, ErrorBox, Skeleton, inputCls } from './ui';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface WorkspaceSummary { id: string; name: string; role: Role; roleLabel: string; sites: number; members: number; maxSites: number | null; maxCrawlUrls: number | null }

/** Sidebar selector: which workspace you are working in, and creating a new one. */
export function WorkspaceSwitcher() {
  const { workspaces, workspaceId } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!workspaces?.length) return null;
  const change = async (id: string) => {
    if (id === '__new') {
      const name = window.prompt('Nombre del nuevo espacio de trabajo (por ejemplo, el de un cliente):');
      if (!name?.trim()) return;
      setBusy(true);
      try {
        await apiSend('POST', '/api/v1/workspaces', { name: name.trim() });
        window.location.reload();
      } catch (e) {
        window.alert((e as Error).message);
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    await apiSend('POST', '/api/v1/auth/workspace', { workspaceId: id }).catch(() => undefined);
    window.location.reload();
  };
  return (
    <div className="mb-2">
      <label htmlFor="workspace-select" className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">Espacio de trabajo</label>
      <select id="workspace-select" disabled={busy} value={workspaceId} onChange={e => change(e.target.value)} className="w-full text-xs font-semibold rounded-lg p-2 border bg-slate-50 border-slate-200 dark:bg-slate-900 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500">
        {workspaces.map(w => <option key={w.id} value={w.id}>{w.name} · {w.roleLabel}</option>)}
        <option value="__new">+ Nuevo espacio…</option>
      </select>
    </div>
  );
}

/** Invitations by email and the workspace name (in "Usuarios"). */
export function InvitationsCard() {
  const { user: me, workspaces, workspaceId } = useAuth();
  const [list, setList] = useState<any[] | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('EDITOR');
  const [last, setLast] = useState<any>(null);
  const [name, setName] = useState(workspaces?.find(w => w.id === workspaceId)?.name ?? '');
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const load = useCallback(() => apiGet<any[]>('/api/v1/invitations').then(setList, setError), []);
  useEffect(() => {
    load();
  }, [load]);
  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    try {
      const r = await apiSend<any>('POST', '/api/v1/invitations', { email, role });
      setLast(r);
      setEmail('');
      await load();
    } catch (err) {
      setError(err);
    }
  };
  const ws = workspaces?.find(w => w.id === workspaceId);
  return (
    <>
      <Card title="Invitar colaboradores">
        <div className="text-xs space-y-3">
          <p className="text-slate-500">La persona recibe un enlace (válido 7 días) para unirse a este espacio con el rol que elijas. Si ya tiene cuenta en G.SEO, entra con ella y el espacio aparece en su selector.</p>
          <form onSubmit={invite} className="flex flex-wrap items-end gap-2">
            <label className="space-y-1"><span className="block font-semibold">Correo</span><input required type="email" aria-label="Correo del colaborador" className={`${inputCls} w-64`} value={email} onChange={e => setEmail(e.target.value)} /></label>
            <label className="space-y-1"><span className="block font-semibold">Rol</span><select aria-label="Rol del colaborador" className={inputCls} value={role} onChange={e => setRole(e.target.value as Role)}>{(['ADMIN', 'SEO_MANAGER', 'EDITOR', 'VIEWER', ...(me.role === 'OWNER' ? ['OWNER'] : [])] as Role[]).map(r => <option key={r} value={r}>{r === 'SEO_MANAGER' ? 'SEO Manager' : r.charAt(0) + r.slice(1).toLowerCase()}</option>)}</select></label>
            <Button type="submit"><Mail className="w-3.5 h-3.5" aria-hidden /> Invitar</Button>
          </form>
          {last && (last.emailed ? <p role="status" className="text-emerald-700">Invitación enviada a {last.email}.</p> : (
            <div role="status" className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-300 space-y-1">
              <p>El servidor no tiene correo configurado{last.emailError ? ` (${last.emailError})` : ''}: comparte este enlace con {last.email} por un canal seguro.</p>
              <div className="flex gap-2 items-center"><code className="font-mono text-[11px] break-all flex-1">{last.acceptUrl}</code><button aria-label="Copiar enlace de invitación" onClick={() => navigator.clipboard?.writeText(last.acceptUrl)}><Copy className="w-4 h-4" /></button></div>
            </div>
          ))}
          <ErrorBox error={error} />
          <h4 className="font-semibold">Invitaciones pendientes</h4>
          {!list ? <Skeleton rows={2} /> : !list.length ? <p className="text-slate-500">Ninguna.</p> : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {list.map(i => (
                <li key={i.id} className="py-1.5 flex items-center gap-2">
                  <span className="font-mono flex-1">{i.email}</span><Badge>{i.roleLabel}</Badge><span className="text-slate-500">vence {fmtDate(i.expiresAt)}</span>
                  <button aria-label={`Retirar invitación de ${i.email}`} onClick={() => apiSend('DELETE', `/api/v1/invitations/${i.id}`).then(load, setError)} className="text-rose-600"><Trash2 className="w-4 h-4" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Card title="Este espacio de trabajo">
        <div className="text-xs space-y-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1"><span className="block font-semibold">Nombre</span><input aria-label="Nombre del espacio de trabajo" className={`${inputCls} w-64`} value={name} onChange={e => setName(e.target.value)} /></label>
            <Button variant="secondary" disabled={!name.trim() || name === ws?.name} onClick={() => apiSend('PATCH', '/api/v1/workspace', { name }).then(() => setMsg('Nombre guardado.'), setError)}>Guardar nombre</Button>
          </div>
          {ws && <p className="text-slate-500">{fmt(ws.sites)} sitio(s){ws.maxSites !== null ? ` de ${fmt(ws.maxSites)} permitidos` : ''} · crawls de hasta {ws.maxCrawlUrls !== null ? fmt(ws.maxCrawlUrls) : '100,000'} URLs · {fmt(ws.members)} persona(s).</p>}
          {msg && <p role="status" className="text-emerald-700">{msg}</p>}
        </div>
      </Card>
    </>
  );
}

/** "Mi cuenta": profile and the workspaces you belong to. */
export function ProfileCard() {
  const { user, workspaces, workspaceId, refresh } = useAuth();
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email ?? '');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const save = async () => {
    setError(null);
    try {
      await apiSend('PATCH', '/api/v1/auth/profile', { name, email: email.trim() || null });
      setMsg('Datos guardados.');
      await refresh();
    } catch (e) {
      setError(e);
    }
  };
  const leave = async () => {
    if (!confirm('¿Salir de este espacio de trabajo? Perderás el acceso hasta que te vuelvan a invitar.')) return;
    try {
      await apiSend('POST', '/api/v1/workspace/leave');
      window.location.reload();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Card title="Mis datos y espacios">
      <div className="text-xs space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1"><span className="block font-semibold">Nombre</span><input aria-label="Mi nombre" className={`${inputCls} w-56`} value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="space-y-1"><span className="block font-semibold">Correo (para invitaciones y recuperar la contraseña)</span><input type="email" aria-label="Mi correo" className={`${inputCls} w-64`} value={email} onChange={e => setEmail(e.target.value)} /></label>
          <Button variant="secondary" onClick={save}>Guardar</Button>
        </div>
        {msg && <p role="status" className="text-emerald-700">{msg}</p>}
        <ErrorBox error={error} />
        <h4 className="font-semibold">Mis espacios de trabajo</h4>
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {(workspaces ?? []).map(w => <li key={w.id} className="py-1.5 flex items-center gap-2"><span className="flex-1">{w.name}{w.id === workspaceId && <Badge tone="good">actual</Badge>}</span><Badge>{w.roleLabel}</Badge><span className="text-slate-500">{fmt(w.sites)} sitios · {fmt(w.members)} personas</span></li>)}
        </ul>
        {(workspaces?.length ?? 0) > 1 && <Button variant="secondary" onClick={leave}><LogOut className="w-3.5 h-3.5" aria-hidden /> Salir de este espacio</Button>}
      </div>
    </Card>
  );
}

/** Instance administrator: every workspace, its usage and limits. */
export function AdminView() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [edit, setEdit] = useState<Record<string, { maxSites: string; maxCrawlUrls: string }>>({});
  const load = useCallback(() => apiGet<any[]>('/api/v1/admin/workspaces').then(setRows, setError), []);
  useEffect(() => {
    load();
  }, [load]);
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const save = async (w: any, extra: Record<string, unknown> = {}) => {
    setError(null);
    const e = edit[w.id];
    try {
      await apiSend('PATCH', `/api/v1/admin/workspaces/${w.id}`, { ...(e ? { maxSites: num(e.maxSites), maxCrawlUrls: num(e.maxCrawlUrls) } : {}), ...extra });
      await load();
    } catch (err) {
      setError(err);
    }
  };
  if (!rows) return error ? <ErrorBox error={error} /> : <Skeleton rows={4} />;
  return (
    <Card title="Administración de la instancia">
      <div className="text-xs space-y-3">
        <p className="text-slate-500">Todos los espacios de trabajo de este G.SEO, con su uso y sus límites. Deja un límite vacío para "sin límite". Suspender un espacio impide entrar a él (los datos se conservan). Las cuentas nuevas reciben los límites de las variables SIGNUP_MAX_SITES y SIGNUP_MAX_CRAWL_URLS; el registro se cierra con SIGNUP=closed.</p>
        <ErrorBox error={error} />
        {!rows.length ? <Empty>No hay espacios.</Empty> : (
          <div className="overflow-auto">
            <table className="w-full">
              <thead><tr className="text-slate-500 text-left border-b border-slate-200 dark:border-slate-800"><th className="py-1">Espacio</th><th>Dueños</th><th className="text-right">Sitios</th><th className="text-right">Personas</th><th>Máx. sitios</th><th>Máx. URLs por crawl</th><th></th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map(w => {
                  const e = edit[w.id] ?? { maxSites: w.maxSites === null ? '' : String(w.maxSites), maxCrawlUrls: w.maxCrawlUrls === null ? '' : String(w.maxCrawlUrls) };
                  return (
                    <tr key={w.id} className={w.disabled ? 'opacity-60' : ''}>
                      <td className="py-1.5">{w.name}{w.disabled && <Badge tone="bad">suspendido</Badge>}<div className="text-slate-400">{fmtDate(w.createdAt)}</div></td>
                      <td className="font-mono text-[11px]">{w.owners.join(', ')}</td>
                      <td className="text-right tabular-nums">{w.sites}</td>
                      <td className="text-right tabular-nums">{w.members}</td>
                      <td><input aria-label={`Máximo de sitios de ${w.name}`} className={`${inputCls} w-20`} value={e.maxSites} placeholder="sin límite" onChange={x => setEdit({ ...edit, [w.id]: { ...e, maxSites: x.target.value } })} /></td>
                      <td><input aria-label={`Máximo de URLs de ${w.name}`} className={`${inputCls} w-28`} value={e.maxCrawlUrls} placeholder="sin límite" onChange={x => setEdit({ ...edit, [w.id]: { ...e, maxCrawlUrls: x.target.value } })} /></td>
                      <td className="whitespace-nowrap space-x-1">
                        <Button variant="secondary" onClick={() => save(w)}>Guardar</Button>
                        <Button variant="secondary" onClick={() => confirm(w.disabled ? `¿Reactivar ${w.name}?` : `¿Suspender ${w.name}? Nadie podrá entrar a este espacio.`) && save(w, { disabled: !w.disabled })}>{w.disabled ? 'Reactivar' : 'Suspender'}</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
