'use client';

import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { createClient } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
import { LogOut } from 'lucide-react';

export function Header() {
  const router = useRouter();
  const supabase = createClient();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <header className="bg-black border-b border-neutral-800 px-4 py-3">
      <div className="container mx-auto flex justify-between items-center">
        <Image
          src="/logo/tenderbot-header.png"
          alt="tenderbot app"
          height={36}
          width={180}
          priority
        />

        <Button
          variant="ghost"
          onClick={handleLogout}
          className="text-sm px-2 py-1 text-white hover:bg-white/10"
        >
          <LogOut className="h-4 w-4 mr-2" />
          Logout
        </Button>
      </div>
    </header>
  );
}
