'use client';

import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, KeyRound, LogIn, UserPlus } from 'lucide-react';
import { apiGet, apiSend } from '@/lib/api';
import type { User } from '@/lib/types';
import { Button, Card, ErrorBox, inputCls } from './ui';

export function PasswordInput({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
  const [show, setShow] = useState(false);
  return (
    <label htmlFor={id} className="block text-xs font-semibold space-y-1">
      <span>{label}</span>
      <span className="relative block">
        <input id={id} type={show ? 'text' : 'password'} required autoComplete={autoComplete} className={`${inputCls} pr-9`} value={value} onChange={e => onChange(e.target.value)} />
        <button type="button" onClick={() => setShow(s => !s)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500">
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </span>
    </label>
  );
}

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#F4F6FB] text-slate-900 dark:bg-[#0F111A] dark:text-slate-100">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2.5 justify-center">
          <div className="flex flex-col items-center gap-1">
            <img src="/brand/logo-dark.png" alt="G.SEO" className="h-12 w-auto dark:hidden" />
            <img src="/brand/logo-white.png" alt="G.SEO" className="h-12 w-auto hidden dark:block" />
            <div className="text-[10px] text-slate-500 font-mono">SEO técnico, contenido e IA</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export function LoginView({ onLoggedIn, initialTicket }: { onLoggedIn: (u: User) => void; initialTicket?: string }) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>(initialTicket ? 'register' : 'login');
  const [cfg, setCfg] = useState<{ signup: boolean; email: boolean } | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reg, setReg] = useState({ ticket: initialTicket ?? '', name: '', email: '', username: '', password: '', workspaceName: '' });
  const [identifier, setIdentifier] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    apiGet<{ signup: boolean; email: boolean }>('/api/v1/auth/config').then(setCfg).catch(() => setCfg({ signup: false, email: false }));
  }, []);
  const go = (m: typeof mode) => {
    setMode(m);
    setError(null);
    setSent(false);
  };
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      try {
        const r = await apiSend<{ user: User }>('POST', '/api/v1/auth/login', { username, password });
        onLoggedIn(r.user);
      } catch (err) {
        setPassword('');
        throw err;
      }
    });
  };
  const register = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await apiSend<{ user: User }>('POST', '/api/v1/auth/register', { ...reg, workspaceName: reg.workspaceName || undefined });
      onLoggedIn(r.user);
    });
  };
  const forgot = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      await apiSend('POST', '/api/v1/auth/forgot', { identifier });
      setSent(true);
    });
  };

  if (mode === 'register')
    return (
      <Shell>
        <Card title="Crear cuenta">
          <form onSubmit={register} className="space-y-3">
            <p className="text-xs text-slate-500">El registro es solo con un código que te da el administrador. Tu cuenta tiene su propio espacio de trabajo, vacío: ahí agregas tus sitios e invitas a tus colaboradores.</p>
            <label className="block text-xs font-semibold space-y-1"><span>Código de registro</span><input required autoCapitalize="characters" spellCheck={false} aria-label="Código de registro" placeholder="GSEO-XXXX-XXXX-XXXX" className={`${inputCls} font-mono`} value={reg.ticket} onChange={e => setReg({ ...reg, ticket: e.target.value })} /></label>
            <label className="block text-xs font-semibold space-y-1"><span>Nombre</span><input required autoComplete="name" aria-label="Tu nombre" className={inputCls} value={reg.name} onChange={e => setReg({ ...reg, name: e.target.value })} /></label>
            <label className="block text-xs font-semibold space-y-1"><span>Correo</span><input required type="email" autoComplete="email" aria-label="Tu correo" className={inputCls} value={reg.email} onChange={e => setReg({ ...reg, email: e.target.value })} /></label>
            <label className="block text-xs font-semibold space-y-1"><span>Usuario</span><input required autoComplete="username" autoCapitalize="none" spellCheck={false} aria-label="Usuario nuevo" className={inputCls} value={reg.username} onChange={e => setReg({ ...reg, username: e.target.value })} /></label>
            <PasswordInput id="reg-password" label="Contraseña (10+ caracteres, con número o símbolo)" value={reg.password} onChange={v => setReg({ ...reg, password: v })} autoComplete="new-password" />
            <label className="block text-xs font-semibold space-y-1"><span>Nombre de tu espacio (opcional)</span><input aria-label="Nombre del espacio" placeholder="Por ejemplo, el nombre de tu agencia" className={inputCls} value={reg.workspaceName} onChange={e => setReg({ ...reg, workspaceName: e.target.value })} /></label>
            <ErrorBox error={error} />
            <Button type="submit" disabled={busy} className="w-full justify-center"><UserPlus className="w-3.5 h-3.5" aria-hidden /> {busy ? 'Creando…' : 'Crear cuenta'}</Button>
          </form>
        </Card>
        <p className="text-[11px] text-center text-slate-500"><button className="underline" onClick={() => go('login')}>Ya tengo cuenta</button></p>
      </Shell>
    );

  if (mode === 'forgot')
    return (
      <Shell>
        <Card title="Recuperar contraseña">
          {sent ? (
            <p role="status" className="text-xs">Si hay una cuenta con ese dato, te enviamos un correo con un enlace para elegir una contraseña nueva (válido 1 hora). Revisa también el spam.</p>
          ) : (
            <form onSubmit={forgot} className="space-y-3">
              <label className="block text-xs font-semibold space-y-1"><span>Tu correo o usuario</span><input required aria-label="Correo o usuario" className={inputCls} value={identifier} onChange={e => setIdentifier(e.target.value)} /></label>
              <ErrorBox error={error} />
              <Button type="submit" disabled={busy} className="w-full justify-center">{busy ? 'Enviando…' : 'Enviar enlace'}</Button>
            </form>
          )}
        </Card>
        <p className="text-[11px] text-center text-slate-500"><button className="underline" onClick={() => go('login')}>Volver a iniciar sesión</button></p>
      </Shell>
    );

  return (
    <Shell>
      <Card title="Iniciar sesión">
        <form onSubmit={submit} className="space-y-4">
          <label htmlFor="login-user" className="block text-xs font-semibold space-y-1">
            <span>Usuario</span>
            <input id="login-user" required autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder="usuario o correo" className={inputCls} value={username} onChange={e => setUsername(e.target.value)} />
          </label>
          <PasswordInput id="login-password" label="Contraseña" value={password} onChange={setPassword} autoComplete="current-password" />
          <ErrorBox error={error} />
          <Button type="submit" disabled={busy} className="w-full justify-center">
            <LogIn className="w-3.5 h-3.5" aria-hidden /> {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>
      <div className="text-[11px] text-center text-slate-500 space-y-1">
        {cfg?.email ? <p><button className="underline" onClick={() => go('forgot')}>¿Olvidaste tu contraseña?</button></p> : <p>¿Olvidaste tu contraseña? Pide a un Admin que la restablezca.</p>}
        {cfg?.signup && <p>¿Tienes un código de registro? <button className="underline font-semibold" onClick={() => go('register')}>Crear cuenta</button></p>}
      </div>
    </Shell>
  );
}

export function ChangePasswordForm({ forced, onDone }: { forced?: boolean; onDone: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [ok, setOk] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOk(false);
    if (next !== confirm) return setError(new Error('Las contraseñas nuevas no coinciden.'));
    try {
      await apiSend('POST', '/api/v1/auth/password', { currentPassword: current, newPassword: next });
      setCurrent('');
      setNext('');
      setConfirm('');
      setOk(true);
      onDone();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      {forced && <p className="text-xs text-amber-700 dark:text-amber-400">Tu contraseña es temporal. Elige una nueva para continuar.</p>}
      <PasswordInput id="pw-current" label={forced ? 'Contraseña temporal' : 'Contraseña actual'} value={current} onChange={setCurrent} autoComplete="current-password" />
      <PasswordInput id="pw-new" label="Nueva contraseña" value={next} onChange={setNext} autoComplete="new-password" />
      <PasswordInput id="pw-confirm" label="Repite la nueva contraseña" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <p className="text-[11px] text-slate-500">Mínimo 10 caracteres, con letras y al menos un número o símbolo. Al cambiarla se cierran tus otras sesiones.</p>
      <ErrorBox error={error} />
      {ok && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">✓ Contraseña actualizada.</p>}
      <Button type="submit"><KeyRound className="w-3.5 h-3.5" aria-hidden /> Guardar contraseña</Button>
    </form>
  );
}

export function ForcedPasswordView({ onDone, onLogout }: { onDone: () => void; onLogout: () => void }) {
  return (
    <Shell>
      <Card title="Cambia tu contraseña">
        <ChangePasswordForm forced onDone={onDone} />
      </Card>
      <p className="text-center">
        <button className="text-xs underline text-slate-500" onClick={onLogout}>Cerrar sesión</button>
      </p>
    </Shell>
  );
}
