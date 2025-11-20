'use client';

import { useState, useMemo, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import {
  LayoutDashboard,
  FileText,
  Box,
  LogOut,
  Menu,
  X,
} from 'lucide-react';

/**
 * Sidebar: Black theme + best-practice updates
 *
 * - Black background, white text by default
 * - Memoized Supabase client (avoid recreating per render)
 * - Logout loading/error handling
 * - Semantic navigation using <Link>
 * - aria-current for active item + aria-labels
 * - Focus ring & keyboard accessible
 * - Persist collapse state in localStorage
 * - Extracted SidebarItem for clarity
 */

const menuItems = [
  { label: 'Dashboard', icon: LayoutDashboard, path: '/dashboard' },
  { label: 'Tenders', icon: FileText, path: '/tenders' },
  // changed to Box to visually differentiate Catalog
  { label: 'Catalog', icon: Box, path: '/catalog' },
];

function SidebarItem({ item, isCollapsed, isActive }) {
  const Icon = item.icon;
  // Use Link for semantic navigation; keeps client navigation and prefetch benefits
  return (
    <Link
      href={item.path}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all
        ${isActive ? 'bg-[#F7C846] text-black shadow-md' : 'text-white hover:bg-gray-800'}
        ${isCollapsed ? 'justify-center' : 'justify-start'}`}
      aria-current={isActive ? 'page' : undefined}
      title={isCollapsed ? item.label : undefined}
    >
      <Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
      {!isCollapsed && <span>{item.label}</span>}
      {isCollapsed && <span className="sr-only">{item.label}</span>}
    </Link>
  );
}

export default function Sidebar() {
  const router = useRouter();
  const pathname = usePathname() || '/dashboard';
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);

  // Persist collapse state in localStorage so preference survives refresh
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem('sidebarCollapsed') : null;
    if (saved === 'true') setIsCollapsed(true);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('sidebarCollapsed', isCollapsed ? 'true' : 'false');
    } catch {
      // ignore storage errors
    }
  }, [isCollapsed]);

  // Memoize supabase client so it isn't recreated each render
  const supabase = useMemo(() => createClient(), []);

  const handleLogout = async () => {
    setLogoutError(null);
    try {
      setIsLoggingOut(true);
      const { error } = await supabase.auth.signOut();
      if (error) {
        // set error and keep user on page
        setLogoutError(error.message || 'Sign out failed');
        setIsLoggingOut(false);
        return;
      }
      // Redirect to login (client navigation)
      router.push('/login');
    } catch (err: any) {
      console.error('Logout error', err);
      setLogoutError(err?.message ?? 'Unexpected error during sign out');
      setIsLoggingOut(false);
    }
  };

  return (
    <>
      <aside
        aria-label="Main sidebar"
        className={`fixed left-0 top-0 h-screen bg-black border-r border-gray-800 flex flex-col shadow-sm transition-all duration-300
          ${isCollapsed ? 'w-20' : 'w-64'}`}
      >
        {/* Header with Toggle */}
        <div className="p-6 border-b border-gray-800 flex items-center justify-between">
          {!isCollapsed ? (
            <h1 className="text-2xl font-bold text-white select-none">
              Tender<span className="text-[#F7C846]">Match</span>
            </h1>
          ) : (
            // provide a small visually-hidden label when collapsed for screen-readers
            <span className="sr-only">TenderMatch</span>
          )}

          <button
            onClick={() => setIsCollapsed((s) => !s)}
            className="p-2 hover:bg-gray-700 rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#F7C846]"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <Menu className="w-5 h-5 text-white" /> : <X className="w-5 h-5 text-white" />}
          </button>
        </div>

        {/* Menu Items */}
        <nav role="navigation" aria-label="Sidebar navigation" className="flex-1 px-4 py-6 space-y-2">
          {menuItems.map((item) => {
            const isActive = pathname === item.path || pathname.startsWith(item.path + '/');
            return (
              <SidebarItem key={item.path} item={item} isCollapsed={isCollapsed} isActive={isActive} />
            );
          })}
        </nav>

        {/* Logout Button */}
        <div className="p-4 border-t border-gray-800">
          <button
            onClick={handleLogout}
            disabled={isLoggingOut}
            aria-label="Logout"
            title={isCollapsed ? 'Logout' : ''}
            className={`w-full flex items-center gap-2 py-3 px-4 bg-gray-800 text-white text-sm font-medium rounded-xl hover:bg-gray-700 transition-all
              ${isCollapsed ? 'justify-center' : 'justify-start'} focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#F7C846] disabled:opacity-60 disabled:cursor-not-allowed`}
          >
            <LogOut className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
            {!isCollapsed && (
              <span>{isLoggingOut ? 'Signing out...' : 'Logout'}</span>
            )}

            {/* small inline spinner when logging out (icon hidden for collapsed mode to keep layout) */}
            {isLoggingOut && !isCollapsed && (
              <svg
                className="w-4 h-4 ml-auto animate-spin"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
                role="img"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"></path>
              </svg>
            )}
          </button>

          {/* logout error (non-intrusive) */}
          {logoutError && (
            <p className="mt-2 text-xs text-red-400" role="alert">
              {logoutError}
            </p>
          )}
        </div>
      </aside>

      {/* Spacer to push page content right */}
      <div className={`${isCollapsed ? 'w-20' : 'w-64'} flex-shrink-0 transition-all duration-300`} />
    </>
  );
}
