'use client';

import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, LogIn } from 'lucide-react';
import { apiSend } from '@/lib/api';
import type { User } from '@/lib/types';
import { Button, Card, ErrorBox, inputCls } from './ui';

function PasswordInput({ id, label, value, onChange, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; autoComplete: string }) {
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

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-[#F4F6FB] text-slate-900 dark:bg-[#0F111A] dark:text-slate-100">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2.5 justify-center">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center font-black" aria-hidden>G</div>
          <div>
            <div className="font-bold">Glitch SEO Ops</div>
            <div className="text-[10px] text-slate-500 font-mono">Herramienta interna</div>
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export function LoginView({ onLoggedIn }: { onLoggedIn: (u: User) => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiSend<{ user: User }>('POST', '/api/v1/auth/login', { username, password });
      onLoggedIn(r.user);
    } catch (err) {
      setError(err);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell>
      <Card title="Iniciar sesión">
        <form onSubmit={submit} className="space-y-4">
          <label htmlFor="login-user" className="block text-xs font-semibold space-y-1">
            <span>Usuario</span>
            <input id="login-user" required autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} className={inputCls} value={username} onChange={e => setUsername(e.target.value)} />
          </label>
          <PasswordInput id="login-password" label="Contraseña" value={password} onChange={setPassword} autoComplete="current-password" />
          <ErrorBox error={error} />
          <Button type="submit" disabled={busy} className="w-full justify-center">
            <LogIn className="w-3.5 h-3.5" aria-hidden /> {busy ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>
      </Card>
      <p className="text-[11px] text-center text-slate-500">¿Olvidaste tu contraseña? Pide a un Admin que la restablezca.</p>
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
