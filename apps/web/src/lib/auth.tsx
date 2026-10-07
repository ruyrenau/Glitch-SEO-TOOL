'use client';

import React, { createContext, useContext } from 'react';
import type { Permission, User } from './types';

interface AuthValue {
  user: User;
  can: (p: Permission) => boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside AuthContext');
  return v;
}

export const AuthProvider = ({ value, children }: { value: AuthValue; children: React.ReactNode }) => <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
