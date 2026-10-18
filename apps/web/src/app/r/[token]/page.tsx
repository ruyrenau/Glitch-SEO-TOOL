'use client';

import React, { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { API_URL } from '@/lib/api';
import { ReportDocument } from '@/components/ReportDocument';

/** Public client report (no login): the secret token in the URL is the credential. */
export default function PublicReportPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<{ title: string; createdAt: string; snapshot: unknown } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [print, setPrint] = useState(false);
  useEffect(() => {
    setPrint(new URLSearchParams(window.location.search).get('print') === '1');
    fetch(`${API_URL}/api/v1/public/reports/${encodeURIComponent(token)}`, { credentials: 'omit', cache: 'no-store' })
      .then(async r => {
        const j = await r.json().catch(() => null);
        if (!r.ok) throw new Error(j?.error?.message ?? 'No se pudo abrir el reporte.');
        setData(j);
        document.title = j.title;
      })
      .catch(e => setError((e as Error).message));
  }, [token]);
  if (error) return <main className="min-h-screen flex items-center justify-center bg-white text-slate-700 p-6"><p className="text-sm">{error}</p></main>;
  if (!data) return <main className="min-h-screen flex items-center justify-center bg-white text-slate-500 p-6"><p className="text-sm">Cargando reporte…</p></main>;
  return <ReportDocument title={data.title} createdAt={data.createdAt} snapshot={data.snapshot} printMode={print} />;
}
