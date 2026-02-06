'use client';

import { createClient } from '@/lib/supabase-client';
import { useEffect, useState, useRef, createContext, useContext } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { Session, User } from '@supabase/supabase-js';

type AuthContextType = {
  user: User | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter(); // ✅ add this
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabaseRef.current = createClient();
    const supabase = supabaseRef.current;

    // ✅ Initial load
    supabase.auth
    .getSession()
    .then(({ data }: { data: { session: Session | null } }) => {
        setUser(data.session?.user ?? null);
        setLoading(false);
    });


    // ✅ Listen for login/signup/logout
    const { data: sub } = supabase.auth.onAuthStateChange(
    (event: string, session: Session | null) => {
        setUser(session?.user ?? null);
        setLoading(false);

        if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        router.refresh();
        }
    }
    );


    return () => {
      sub.subscription.unsubscribe();
    };
  }, [router]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0E121A]">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
