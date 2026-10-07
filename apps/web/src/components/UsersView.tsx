'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { apiGet, apiSend, fmtDate } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Role, User } from '@/lib/types';
import { Badge, Button, Card, ErrorBox, Skeleton, inputCls } from './ui';
import { ChangePasswordForm } from './AuthViews';

const ROLES: Array<{ id: Role; label: string; what: string }> = [
  { id: 'OWNER', label: 'Owner', what: 'Todo, incluida la gestión de otros Owners.' },
  { id: 'ADMIN', label: 'Admin', what: 'Todo excepto modificar Owners: sitios, credenciales, borrados y usuarios.' },
  { id: 'SEO_MANAGER', label: 'SEO Manager', what: 'Importa logs y sitemaps, ejecuta crawls, gestiona issues y alertas, contenido y envíos.' },
  { id: 'EDITOR', label: 'Editor', what: 'Datasets, plantillas, generación, revisión y envío de borradores a WordPress.' },
  { id: 'VIEWER', label: 'Viewer', what: 'Solo lectura.' }
];

export function AccountView() {
  const { user, refresh } = useAuth();
  return (
    <div className="space-y-6">
      <Card title="Mi cuenta">
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
          <div><dt className="text-slate-500">Nombre</dt><dd className="font-semibold">{user.name}</dd></div>
          <div><dt className="text-slate-500">Usuario</dt><dd className="font-mono">{user.username}</dd></div>
          <div><dt className="text-slate-500">Rol</dt><dd><Badge>{user.roleLabel}</Badge></dd></div>
        </dl>
      </Card>
      <Card title="Cambiar contraseña">
        <div className="max-w-sm">
          <ChangePasswordForm onDone={refresh} />
        </div>
      </Card>
    </div>
  );
}

export function UsersView() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [form, setForm] = useState({ username: '', name: '', email: '', password: '', role: 'EDITOR' as Role });

  const load = useCallback(async () => {
    try {
      setUsers(await apiGet<User[]>('/api/v1/users'));
    } catch (err) {
      setError(err);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      await load();
    } catch (err) {
      setError(err);
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    act(async () => {
      await apiSend('POST', '/api/v1/users', { ...form, email: form.email || undefined });
      setForm({ username: '', name: '', email: '', password: '', role: 'EDITOR' });
    }, `Usuario creado. Comparte la contraseña temporal por un canal seguro; se le pedirá cambiarla al entrar.`);
  };

  const reset = (u: User) => {
    const pw = window.prompt(`Nueva contraseña temporal para ${u.username} (mínimo 10 caracteres, con número o símbolo):`);
    if (!pw) return;
    act(() => apiSend('POST', `/api/v1/users/${u.id}/reset-password`, { password: pw }), `Contraseña restablecida para ${u.username}. Sus sesiones se cerraron.`);
  };

  const assignable = ROLES.filter(r => r.id !== 'OWNER' || me.role === 'OWNER');

  return (
    <div className="space-y-6">
      <Card title="Usuarios del workspace">
        <ErrorBox error={error} />
        {msg && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400 mb-3">{msg}</p>}
        {!users ? (
          <Skeleton rows={3} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Usuarios</caption>
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                  <th scope="col" className="py-2">Nombre</th>
                  <th scope="col">Usuario</th>
                  <th scope="col">Rol</th>
                  <th scope="col">Último acceso</th>
                  <th scope="col">Estado</th>
                  <th scope="col" className="text-right"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {users.map(u => {
                  const self = u.id === me.id;
                  const locked = self || (u.role === 'OWNER' && me.role !== 'OWNER');
                  return (
                    <tr key={u.id}>
                      <td className="py-2 font-semibold">{u.name}{self && <span className="text-slate-500 font-normal"> (tú)</span>}</td>
                      <td className="font-mono">{u.username}</td>
                      <td>
                        <select aria-label={`Rol de ${u.username}`} className={inputCls} disabled={locked} value={u.role} onChange={e => act(() => apiSend('PATCH', `/api/v1/users/${u.id}`, { role: e.target.value }), `Rol de ${u.username} actualizado.`)}>
                          {(locked ? ROLES : assignable).map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                        </select>
                      </td>
                      <td className="text-slate-500">{fmtDate(u.lastLoginAt)}</td>
                      <td>{u.disabled ? <Badge tone="bad">desactivado</Badge> : u.mustChangePassword ? <Badge tone="warn">contraseña temporal</Badge> : <Badge tone="good">activo</Badge>}</td>
                      <td className="text-right space-x-2 whitespace-nowrap">
                        {!locked && <Button variant="secondary" onClick={() => reset(u)}>Restablecer contraseña</Button>}
                        {!locked && (
                          <Button variant="secondary" onClick={() => act(() => apiSend('PATCH', `/api/v1/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? `${u.username} reactivado.` : `${u.username} desactivado y sus sesiones cerradas.`)}>
                            {u.disabled ? 'Reactivar' : 'Desactivar'}
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="Invitar usuario">
        <form onSubmit={create} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          <label className="font-semibold space-y-1"><span>Nombre</span><input required className={inputCls} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="font-semibold space-y-1"><span>Usuario (para iniciar sesión)</span><input required pattern="[a-zA-Z0-9._\-]{3,40}" autoCapitalize="none" className={inputCls} value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
          <label className="font-semibold space-y-1"><span>Email (opcional)</span><input type="email" className={inputCls} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label className="font-semibold space-y-1"><span>Contraseña temporal</span><input required type="text" autoComplete="off" className={inputCls} value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
          <label className="font-semibold space-y-1 md:col-span-2">
            <span>Rol</span>
            <select className={inputCls} value={form.role} onChange={e => setForm({ ...form, role: e.target.value as Role })}>
              {assignable.map(r => <option key={r.id} value={r.id}>{r.label} — {r.what}</option>)}
            </select>
          </label>
          <div className="md:col-span-2"><Button type="submit"><UserPlus className="w-3.5 h-3.5" aria-hidden /> Crear usuario</Button></div>
        </form>
      </Card>

      <Card title="Qué puede hacer cada rol">
        <dl className="space-y-2 text-xs">
          {ROLES.map(r => (
            <div key={r.id} className="flex gap-2"><dt className="font-semibold w-28 shrink-0">{r.label}</dt><dd className="text-slate-600 dark:text-slate-400">{r.what}</dd></div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
