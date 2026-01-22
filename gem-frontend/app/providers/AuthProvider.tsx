'use client';

import { createClient } from '@/lib/supabase-client';
import { useEffect, useState, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import type { Session, User } from '@supabase/supabase-js';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabaseRef.current = createClient();
    const supabase = supabaseRef.current;

    supabase.auth
      .getSession()
      .then(({ data }: { data: { session: Session | null } }) => {
        setUser(data.session?.user ?? null);
        setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(
    (_event: string, session: Session | null) => {
        setUser(session?.user ?? null);
        setLoading(false);
    }
    );

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0E121A]">
        <Loader2 className="h-8 w-8 animate-spin text-white" />
      </div>
    );
  }

  return <>{children}</>;
}
