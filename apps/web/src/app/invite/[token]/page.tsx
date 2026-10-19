'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { LogIn, UserPlus } from 'lucide-react';
import { apiGet, apiSend } from '@/lib/api';
import { PasswordInput, Shell } from '@/components/AuthViews';
import { Button, Card, ErrorBox, Skeleton, inputCls } from '@/components/ui';

interface Info { workspace: string; email: string; role: string; roleLabel: string; inviter: string | null; expiresAt: string; hasAccount: boolean }

/** Accepting an invitation: with a new account, or with the existing one (signing in if needed). */
export default function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [me, setMe] = useState<{ username: string; email: string | null } | null | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({ name: '', username: '', password: '' });
  const [login, setLogin] = useState({ username: '', password: '' });

  useEffect(() => {
    apiGet<Info>(`/api/v1/public/invitations/${encodeURIComponent(token)}`).then(i => {
      setInfo(i);
      setLogin(l => ({ ...l, username: i.email }));
    }, setError);
    apiGet<{ user: { username: string; email: string | null } }>('/api/v1/auth/me').then(r => setMe(r.user), () => setMe(null));
  }, [token]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      window.location.href = '/';
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const acceptExisting = () => run(() => apiSend('POST', `/api/v1/auth/invitations/${encodeURIComponent(token)}/accept`));

  if (!info) return <Shell>{error ? <Card title="Invitación"><ErrorBox error={error} /></Card> : <Skeleton rows={3} />}</Shell>;
  return (
    <Shell>
      <Card title={`Te invitaron a ${info.workspace}`}>
        <div className="space-y-3 text-xs">
          <p>{info.inviter ? `${info.inviter} te invitó` : 'Te invitaron'} a colaborar en <strong>{info.workspace}</strong> como <strong>{info.roleLabel}</strong>. La invitación es para <span className="font-mono">{info.email}</span>.</p>

          {me ? (
            <>
              <p className="text-slate-500">Tienes la sesión iniciada como <strong>{me.username}</strong>{me.email ? ` (${me.email})` : ''}.</p>
              <Button disabled={busy} onClick={acceptExisting} className="w-full justify-center">Aceptar con mi cuenta</Button>
            </>
          ) : info.hasAccount ? (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); run(async () => { await apiSend('POST', '/api/v1/auth/login', login); await apiSend('POST', `/api/v1/auth/invitations/${encodeURIComponent(token)}/accept`); }); }}>
              <p className="text-slate-500">Ya tienes una cuenta con ese correo: inicia sesión para aceptar.</p>
              <label className="block font-semibold space-y-1"><span>Usuario o correo</span><input required aria-label="Usuario o correo" className={inputCls} value={login.username} onChange={e => setLogin({ ...login, username: e.target.value })} /></label>
              <PasswordInput id="inv-login-pw" label="Contraseña" value={login.password} onChange={v => setLogin({ ...login, password: v })} autoComplete="current-password" />
              <Button type="submit" disabled={busy} className="w-full justify-center"><LogIn className="w-3.5 h-3.5" aria-hidden /> Entrar y aceptar</Button>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={e => { e.preventDefault(); run(() => apiSend('POST', `/api/v1/public/invitations/${encodeURIComponent(token)}/accept`, f)); }}>
              <p className="text-slate-500">Crea tu cuenta para entrar.</p>
              <label className="block font-semibold space-y-1"><span>Tu nombre</span><input required aria-label="Tu nombre" className={inputCls} value={f.name} onChange={e => setF({ ...f, name: e.target.value })} /></label>
              <label className="block font-semibold space-y-1"><span>Usuario</span><input required autoCapitalize="none" spellCheck={false} aria-label="Elige un usuario" className={inputCls} value={f.username} onChange={e => setF({ ...f, username: e.target.value })} /></label>
              <PasswordInput id="inv-pw" label="Contraseña (10+ caracteres, con número o símbolo)" value={f.password} onChange={v => setF({ ...f, password: v })} autoComplete="new-password" />
              <Button type="submit" disabled={busy} className="w-full justify-center"><UserPlus className="w-3.5 h-3.5" aria-hidden /> Crear cuenta y aceptar</Button>
            </form>
          )}
          <ErrorBox error={error} />
        </div>
      </Card>
    </Shell>
  );
}
