'use client';

import React from 'react';
import { useParams } from 'next/navigation';
import { LoginView } from '@/components/AuthViews';

/** Link of a sign-up ticket: the registration form with the code already filled in. */
export default function SignupPage() {
  const { code } = useParams<{ code: string }>();
  return <LoginView initialTicket={decodeURIComponent(code)} onLoggedIn={() => (window.location.href = '/')} />;
}
