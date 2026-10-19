'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { apiSend } from '@/lib/api';
import { PasswordInput, Shell } from '@/components/AuthViews';
import { Button, Card, ErrorBox } from '@/components/ui';

/** Choosing a new password from the emailed link. */
export default function ResetPage() {
  const { token } = useParams<{ token: string }>();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw !== pw2) return setError(new Error('Las contraseñas no coinciden.'));
    setBusy(true);
    setError(null);
    try {
      await apiSend('POST', '/api/v1/auth/reset', { token, password: pw });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <Card title="Elige una contraseña nueva">
        {done ? (
          <div className="space-y-3 text-xs">
            <p role="status">Listo: tu contraseña cambió y se cerraron tus otras sesiones.</p>
            <a href="/" className="inline-block px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold">Iniciar sesión</a>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <PasswordInput id="reset-pw" label="Contraseña nueva (10+ caracteres, con número o símbolo)" value={pw} onChange={setPw} autoComplete="new-password" />
            <PasswordInput id="reset-pw2" label="Repite la contraseña" value={pw2} onChange={setPw2} autoComplete="new-password" />
            <ErrorBox error={error} />
            <Button type="submit" disabled={busy} className="w-full justify-center">{busy ? 'Guardando…' : 'Guardar contraseña'}</Button>
          </form>
        )}
      </Card>
    </Shell>
  );
}
