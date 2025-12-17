'use client';

import React, { useState, useEffect, Suspense, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { 
  Search, 
  MapPin, 
  Calendar, 
  ChevronRight, 
  Database, 
  Loader2, 
  RefreshCw, 
  Clock, 
  ChevronDown, 
  ChevronUp, 
  Building2, 
  FileText, 
  Filter,
  Star
} from 'lucide-react';

import { tenderStore } from '@/services/tenderStore';
import { Tender } from '@/types';
import { createClient } from '@/lib/supabase-client';
import { useRouter } from 'next/navigation';


const supabase = createClient();


type SortOption = 'newest' | 'oldest' | 'closing-soon' | 'closing-latest';
type TabOption = 'All' | 'Active' | 'Closing Soon' | 'Shortlisted' | 'Archived';

// Simple hover tooltip icon
const InfoTooltip = ({ text }: { text: string }) => (
  <div className="relative group inline-block ml-1 cursor-pointer">
    <span className="text-black text-[10px] font-bold border border-black/50 rounded-full px-[4px] leading-none">
      i
    </span>
    <div className="absolute left-1/2 -translate-x-1/2 mt-1 hidden group-hover:block whitespace-nowrap z-20
      bg-black text-white text-[10px] px-2 py-1 rounded shadow-lg">
      {text}
    </div>
  </div>
);


// --- Sub-Component: Filter Accordion ---
const FilterSection: React.FC<{ 
  title: string; 
  isOpen?: boolean; 
  children: React.ReactNode 
}> = ({ title, isOpen = false, children }) => {
  const [open, setOpen] = useState(isOpen);
  return (
    <div className="border-b border-gray-200 last:border-0">
      <button 
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between py-4 px-1 hover:bg-gray-50 transition-colors"
        type="button"
        aria-expanded={open}
      >
        <span className="font-bold text-[#0E121A] text-sm">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-gray-500" aria-hidden /> : <ChevronDown className="w-4 h-4 text-gray-500" aria-hidden />}
      </button>
      {open && <div className="pb-4 px-1 animate-fade-in">{children}</div>}
    </div>
  );
};

export default function TendersPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center">Loading...</div>}>
      <TendersContent />
    </Suspense>
  );
}

function TendersContent() {
  const searchParams = useSearchParams();
  const fromDashboard = searchParams?.get('from') === 'dashboard'; // detect CTA entry
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();


  useEffect(() => {
    // Autofocus ONLY when user comes via Dashboard CTA
    if (fromDashboard) {
      searchInputRef.current?.focus();
    }
  }, [fromDashboard]);

  // Suggested queries (appears only if search is empty)
  const exampleSearches = ["Fire extinguishers", "Security Services", "Office Furniture"];

  const qpSource = searchParams?.get?.('source') ?? null;
  const initialSource = qpSource === 'gem' ? 'gem' : 'all';

  const [tenders, setTenders] = useState<Tender[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);

  // Filters & UI state
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [activeTab, setActiveTab] = useState<TabOption>('Active');
  const [emdNeeded, setEmdNeeded] = useState<'all' | 'yes' | 'no'>('all');

  const [isSyncing, setIsSyncing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [recommendedOnly, setRecommendedOnly] = useState(false);

  // UI-only prompt state for unauthenticated recommended attempts
  const [showLoginPrompt, setShowLoginPrompt] = useState(false);

  const PAGE_SIZE = 10;
  const SEARCH_DEBOUNCE_MS = 400;

  // Debounce searchInput -> searchTerm
  useEffect(() => {
    const t = setTimeout(() => {
      setSearchTerm(searchInput);
      setCurrentPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [searchInput]);

  const logUserEvent = useCallback(
    async (eventType: string, eventValue?: any) => {
      try {
        const { data, error } = await supabase.auth.getUser();
        const user = data?.user;
        if (error || !user) {
          return;
        }

        await supabase.from('user_events').insert({
          user_id: user.id,
          event_type: eventType,
          event_value: eventValue ? JSON.stringify(eventValue) : null,
        });
      } catch (err) {
        console.error('Failed to log user event', err);
      }
    },
    []
  );
  // Reset page to 1 for filter changes
  const handleSetSortBy = (val: SortOption) => { setSortBy(val); setCurrentPage(1); };
  const handleSetActiveTab = (val: TabOption) => { setActiveTab(val); setCurrentPage(1); };
  const handleSetEmd = (val: 'all'|'yes'|'no') => { setEmdNeeded(val); setCurrentPage(1); };

  // Fetch tenders (uses tenderStore)
  const fetchTenders = useCallback(async () => {
    setIsLoading(true);
    setDebugError(null);

    try {
      // Map tabs to status filters expected by the store
      let statusFilter: 'all' | 'open' | 'urgent' | 'closed' | 'closing-soon' | 'shortlisted' = 'all';
      if (activeTab === 'Active') statusFilter = 'open';
      if (activeTab === 'Archived') statusFilter = 'closed';
      if (activeTab === 'Closing Soon') statusFilter = 'closing-soon';
      if (activeTab === 'Shortlisted') statusFilter = 'shortlisted';

      const { data, total } = await tenderStore.getTenders({
        page: currentPage,
        limit: PAGE_SIZE,
        search: searchTerm,
        statusFilter, 
        sortBy,
        emdFilter: emdNeeded,
        source: initialSource === 'gem' ? 'gem' : 'all',
        recommendationsOnly: recommendedOnly,
      });

      setTenders(data);
      setTotalRecords(total);

      void logUserEvent('SEARCH_EXECUTED', {
        searchTerm,
        statusFilter,
        sortBy,
        emdNeeded,
        recommendedOnly,
        source: initialSource === 'gem' ? 'gem' : 'all',
        page: currentPage,
        total,
      });
    } catch (err: any) {
      console.error("Fetch Error:", err);
      setDebugError(err?.message ?? JSON.stringify(err));
      setTenders([]);
      setTotalRecords(0);
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, searchTerm, sortBy, activeTab, emdNeeded, initialSource, recommendedOnly, logUserEvent]);


  useEffect(() => {
    void fetchTenders();
  }, [fetchTenders]);

  // Sync with GeM (calls tenderStore.syncWithGeM)
  const handleSyncGeM = async () => {
    setIsSyncing(true);
    try {
      await tenderStore.syncWithGeM();
      await fetchTenders();
    } catch (error) {
      console.error("Sync failed", error);
    } finally {
      setIsSyncing(false);
    }
  };

  // Shortlist toggle with optimistic update and rollback
  const toggleShortlist = async (e: React.MouseEvent, tender: Tender) => {
     e.preventDefault();
     e.stopPropagation();

     setTenders(current => 
        current.map(t => 
           t.id === tender.id ? { ...t, isShortlisted: !t.isShortlisted } : t
        )
     );

     try {
       await tenderStore.toggleShortlist(tender.id!);
       // if viewing Shortlisted tab, refetch to reflect removal
       if (activeTab === 'Shortlisted') {
         setTimeout(() => void fetchTenders(), 400);
       }
     } catch (err) {
       console.error('Failed to toggle shortlist', err);
       // rollback
       setTenders(current => 
         current.map(t => t.id === tender.id ? { ...t, isShortlisted: !t.isShortlisted } : t)
       );
     }
  };

  // Recommended toggle with login prompt behavior
    // Recommended toggle with auth-based login prompt
  const handleToggleRecommended = async () => {
      // If already on Recommended, just turn it off
      if (recommendedOnly) {
        setRecommendedOnly(false);
        setCurrentPage(1);
        return;
      }

      try {
        // Only check whether the user is authenticated
        const { data, error } = await supabase.auth.getUser();
        const user = data?.user;

        if (error || !user) {
          // Not authenticated → show login hint and do NOT enable filter
          setShowLoginPrompt(true);
          window.setTimeout(() => setShowLoginPrompt(false), 6000);
          return;
        }

        // User is authenticated → turn Recommended mode ON
        setRecommendedOnly(true);
        setCurrentPage(1);
      } catch (err) {
        console.error('Error checking auth for recommended view', err);
        setShowLoginPrompt(true);
        window.setTimeout(() => setShowLoginPrompt(false), 6000);
      }
    };


  // Helpers
  const isClosingSoon = (dateString?: string | null) => {
    if (!dateString) return false;
    const endDate = new Date(dateString);
    if (Number.isNaN(endDate.getTime())) return false;
    const today = new Date();
    // consider end of day to reduce off-by-one surprises
    const diffMs = (new Date(endDate)).setHours(23,59,59,999) - today.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    return diffDays <= 7 && diffDays > 0;
  };

  // NEW helper: strictly follow requested logic for non-clickable status badge
  const getTenderStatus = (dateString?: string | null): 'Closed' | 'Closing Soon' | 'Active' => {
    if (!dateString) {
      // If no date, treat as Active (you can change to 'Unknown' if preferred)
      return 'Active';
    }
    const end = new Date(dateString);
    if (Number.isNaN(end.getTime())) return 'Active';
    const now = new Date();
    // if end date has passed -> Closed
    if (end.getTime() < now.getTime()) return 'Closed';

    // compute full-day diff using end-of-day to avoid off-by-one errors
    const diffMs = (new Date(end)).setHours(23,59,59,999) - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 7) return 'Closing Soon';
    return 'Active';
  };

  const formatCurrency = (amount?: number | null) => {
    if (amount == null || Number.isNaN(amount)) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const getTimeLeft = (dateString?: string | null) => {
     if (!dateString) return "Unknown";
     const end = new Date(dateString).getTime();
     const now = Date.now();
     if (isNaN(end)) return "Unknown";
     const diff = end - now;
     if (diff < 0) return "Expired";
     const days = Math.floor(diff / (1000 * 60 * 60 * 24));
     if (days > 1) return `${days} days left`;
     if (days === 1) return `1 day left`;
     return `Ending soon`;
  };

  const safeFormatDate = (val?: string | null, opts: 'date' | 'datetime' = 'date') => {
    if (!val) return 'N/A';
    const d = new Date(val);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return opts === 'datetime' ? d.toLocaleString() : d.toLocaleDateString();
  };


  // Derived values & pagination helpers
  // compute proper showing range (start-end)
  const showingStart = useMemo(() => {
    if (totalRecords === 0) return 0;
    return (currentPage - 1) * PAGE_SIZE + 1;
  }, [currentPage, totalRecords]);

  const showingEnd = useMemo(() => {
    if (totalRecords === 0) return 0;
    return Math.min(totalRecords, currentPage * PAGE_SIZE);
  }, [currentPage, totalRecords]);

  const lastPage = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));
  const canGoNext = currentPage < lastPage;

  const handleImmediateSearch = () => {
    setSearchTerm(searchInput);
    setCurrentPage(1);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 pb-12">
      
      {/* --- LEFT SIDEBAR FILTERS --- */}
      <div className="w-full lg:w-72 flex-shrink-0 space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4" aria-hidden={isLoading}>
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-[#0E121A]" aria-hidden />
            <h2 className="text-lg font-bold text-[#0E121A]">Filters</h2>
          </div>

          {/* Keyword Search */}
          <div className="mb-4">
            <label htmlFor="tender-search" className="text-xs font-bold text-gray-700 uppercase mb-1 block">Keyword Search</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" aria-hidden />
                <input 
                  ref={searchInputRef}
                  id="tender-search"
                  type="text" 
                  placeholder="Search in tenders..."
                  className="w-full pl-9 pr-2 py-2 border border-gray-300 rounded-lg text-sm font-medium focus:border-[#F7C846] focus:ring-1 focus:ring-[#F7C846] outline-none"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleImmediateSearch();
                  }}
                  aria-label="Search tenders"
                />

                {/* NEW — Example queries for zero-thinking onboarding */}
                {fromDashboard && searchInput === "" && (
                  <div className="flex gap-2 mt-2 flex-wrap text-xs">
                    {exampleSearches.map((q) => (
                      <button
                        key={q}
                        onClick={() => setSearchInput(q)}
                        className="px-2 py-1 border border-gray-300 rounded text-gray-600 hover:bg-gray-100"
                      >
                        {q}
                      </button>
                    ))}
                  </div>
                )}

              </div>
              <button 
                onClick={handleImmediateSearch}
                className="bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-2 rounded-lg text-sm font-bold transition-colors"
                aria-label="Search now"
              >
                Go
              </button>
            </div>
          </div>

          {/* Accordion Filters */}
          <div className="divide-y divide-gray-100">
             {/* EMD Needed - Radio Buttons */}
             <FilterSection title="EMD Needed" isOpen>
                <div className="space-y-2">
                   <label className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                      <input 
                        type="radio" 
                        name="emdFilter" 
                        value="all"
                        checked={emdNeeded === 'all'}
                        onChange={() => handleSetEmd('all')}
                        className="w-4 h-4 text-[#F7C846] focus:ring-[#F7C846] border-gray-300 accent-[#F7C846]" 
                      />
                      Any
                   </label>
                   <label className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                      <input 
                        type="radio" 
                        name="emdFilter" 
                        value="yes"
                        checked={emdNeeded === 'yes'}
                        onChange={() => handleSetEmd('yes')}
                        className="w-4 h-4 text-[#F7C846] focus:ring-[#F7C846] border-gray-300 accent-[#F7C846]" 
                      />
                      Yes
                   </label>
                   <label className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                      <input 
                        type="radio" 
                        name="emdFilter" 
                        value="no"
                        checked={emdNeeded === 'no'}
                        onChange={() => handleSetEmd('no')}
                        className="w-4 h-4 text-[#F7C846] focus:ring-[#F7C846] border-gray-300 accent-[#F7C846]" 
                      />
                      No
                   </label>
                </div>
             </FilterSection>
          </div>
          {/* --- Guidance Banner for New Users --- */}
          <div className="mt-4 bg-gray-50 border border-gray-100 rounded-lg p-3 text-xs leading-relaxed text-gray-600">
            <p className="font-semibold text-gray-900">New here?</p>
            <ul className="list-disc pl-4 mt-1 space-y-1">
              <li>
                <span className="font-semibold">Shortlist</span> ⭐ — Save tenders to revisit later.
              </li>
              <li>
                <span className="font-semibold">Recommended for Me</span> 🔶 — Shows tenders based on items you’ve added in your <span className="underline font-medium">Catalogue</span>.
              </li>
            </ul>

            {/* Optional subtle CTA */}
            <div className="mt-2">
              <Link 
                href="/catalog"
                className="text-[11px] font-semibold text-[#0E121A] underline hover:text-black"
              >
                Add items to Catalogue →
              </Link>
            </div>
          </div>

        </div>
      </div>

      
      {/* --- MAIN CONTENT AREA --- */}
      <div className="flex-1 min-w-0" aria-busy={isLoading}>
        
        {/* Top Controls */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
           {/* Tabs */}
           <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0" role="tablist" aria-label="Tender tabs">
              <div className="flex bg-gray-100 p-1 rounded-lg whitespace-nowrap">
                {['Active', 'Closing Soon', 'Shortlisted', 'All', 'Archived'].map((tab) => {
                  const isShortlistedTab = tab === 'Shortlisted';
                  const disabled = isShortlistedTab && tenderStore.isShortlistCooldown;

                  return (
                    <button 
                      key={tab}
                      disabled={disabled}
                      onClick={() => {
                        if (!disabled) handleSetActiveTab(tab as TabOption);
                      }}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        activeTab === tab
                          ? 'bg-gray-200 text-[#0E121A] shadow-sm'
                          : disabled
                            ? 'text-gray-300 cursor-not-allowed'
                            : 'text-gray-500 hover:text-gray-700'
                      }`}
                      aria-disabled={disabled}
                      aria-pressed={activeTab === tab}
                      role="tab"
                      aria-current={activeTab === tab ? 'true' : undefined}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>
           </div>

           {/* Sort & Count */}
           <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
              <div className="relative">
                 <select 
                    value={sortBy}
                    onChange={(e) => handleSetSortBy(e.target.value as SortOption)}
                    className="appearance-none bg-white border border-gray-300 text-gray-700 py-2 pl-4 pr-8 rounded-lg text-sm font-medium focus:outline-none focus:ring-1 focus:ring-[#F7C846]"
                    aria-label="Sort tenders"
                 >
                    <option value="closing-soon">Bid End Date: Earliest</option>
                    <option value="closing-latest">Bid End Date: Latest</option>
                    <option value="newest">Published Date: Newest</option>
                 </select>
                 <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" aria-hidden />
              </div>

              <div className="text-sm text-gray-500 font-medium whitespace-nowrap hidden lg:block">
                 {totalRecords === 0 ? (
                   <>Showing <span className="font-bold text-gray-900">0</span> of <span className="font-bold text-gray-900">0</span> tenders</>
                 ) : (
                   <>Showing <span className="font-bold text-gray-900">{showingStart}</span> - <span className="font-bold text-gray-900">{showingEnd}</span> of <span className="font-bold text-gray-900">{totalRecords}</span> tenders</>
                 )}
              </div>
           </div>
        </div>

        {/* Alert Banner / Sync */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div className="flex items-center gap-3">
            {/* RECOMMENDED Toggle (replaces Save Free Alert) */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => void handleToggleRecommended()}
                aria-pressed={recommendedOnly}
                aria-label="Toggle recommended tenders"
                className={`flex items-center justify-center px-5 py-3 rounded-2xl font-medium transition focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                  recommendedOnly
                    ? 'bg-black text-white shadow'         // ACTIVE
                    : 'bg-[#F7C846] text-[#0E121A] shadow-md hover:brightness-95' // INACTIVE
                }`}
              >
                {recommendedOnly ? 'Showing Recommended' : 'Recommended for Me'}
              </button>

              {/* Tooltip for Recommended */}
              <InfoTooltip text="Shows tenders based on products in your Catalogue" />
            </div>

            {showLoginPrompt && (
              <div
                role="alert"
                className="mt-2 text-xs text-gray-700 bg-yellow-50 border border-yellow-100 p-2 rounded"
              >
                <div className="flex items-center gap-2">
                  <span className="text-sm">
                    Sign in to see your personalized recommendations.
                  </span>
                  <Link
                    href="/login"
                    className="ml-2 text-sm font-semibold text-[#0E121A] underline"
                  >
                    Sign in
                  </Link>
                </div>
              </div>
            )}

            {/* optional small hint when recommendedOnly is active */}
            {recommendedOnly && (
              <div className="text-xs text-gray-500 ml-2">
                Showing only tenders recommended for you
              </div>
            )}
          </div>


           <div className="flex items-center gap-2">
             <button
               onClick={handleSyncGeM}
               disabled={isSyncing}
               className={`flex items-center gap-2 text-[#0E121A] hover:text-[#F7C846] font-semibold text-sm transition-colors ${isSyncing ? 'opacity-50' : ''}`}
               aria-busy={isSyncing}
               aria-disabled={isSyncing}
             >
               <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} aria-hidden />
               {isSyncing ? 'Syncing...' : 'Refresh Data'}
             </button>
           </div>
        </div>

        {/* Tenders List */}
        {isLoading ? (
           <div className="py-20 text-center">
              <Loader2 className="w-10 h-10 text-gray-300 animate-spin mx-auto" aria-hidden />
              <p className="text-gray-400 mt-3 font-medium">Loading opportunities...</p>
           </div>
        ) : tenders.length === 0 ? (
           <div className="bg-white rounded-xl border border-dashed border-gray-300 p-12 text-center">
              <Database className="w-12 h-12 text-gray-300 mx-auto mb-4" aria-hidden />
              <h3 className="text-lg font-bold text-gray-900">No tenders found</h3>
              <p className="text-gray-500">
                {recommendedOnly
                  ? "No recommended tenders found for your account."
                  : (activeTab !== 'All' ? `No ${activeTab.toLowerCase()} tenders found matching your criteria.` : "Check your database connection or filters.")}
              </p>
              {debugError && (
                <div className="mt-4 p-3 bg-red-50 border border-red-100 rounded text-left text-xs text-red-700 font-mono overflow-auto max-w-lg mx-auto">
                   <strong>Debug Error:</strong> {debugError}
                </div>
              )}
              <div className="mt-6">
                  <button 
                    onClick={() => {
                      setSearchInput('');
                      setSearchTerm('');
                      setEmdNeeded('all');
                      setActiveTab('Active'); // reset to default
                      setRecommendedOnly(false);
                      setCurrentPage(1);
                    }}
                    className="text-blue-600 hover:underline font-semibold text-sm"
                  >
                    Clear all filters
                  </button>
              </div>
           </div>
        ) : (
           <div className="space-y-4">
          {tenders.map((tender, idx) => {
            const urgent = isClosingSoon(tender.deadline);
            const timeLeft = getTimeLeft(tender.deadline);
            const hasEmd = (tender.emdAmount ?? 0) > 0;

            const computeStatus = (() => {
              const now = new Date();
              const deadline = tender.deadline ? new Date(tender.deadline) : null;
              if (!deadline || Number.isNaN(deadline.getTime())) {
                return { text: 'Active', classes: 'bg-gray-50 text-gray-700 border border-gray-200' };
              }
              if (deadline.getTime() < now.getTime()) {
                return { text: 'Closed', classes: 'bg-red-600 text-white border-red-600' };
              }
              const diffMs = (new Date(deadline)).setHours(23,59,59,999) - now.getTime();
              const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
              if (diffDays <= 7 && diffDays > 0) {
                return { text: 'Closing Soon', classes: 'bg-orange-50 text-orange-700 border border-orange-100' };
              }
              return { text: 'Active', classes: 'bg-green-50 text-green-700 border border-green-100' };
            })();

            // fallback key and details URL
            const safeKey = tender.id ?? `${tender.bidNumber ?? 'unknown'}-${idx}`;
            const detailsHref = tender.id ? `/tenders/${tender.id}` : '#';

            // click handler for the card (uses router to avoid wrapping a button in <a>)
            const onCardClick = (e: React.MouseEvent) => {
              // ignore clicks from interactive children (they should stopPropagation themselves)
              // Only navigate when we have a valid tender id
              if (!tender.id) {
                e.preventDefault();
                return;
              }
              void logUserEvent('TENDER_VIEWED', { tenderId: tender.id, source: 'card' });
              router.push(detailsHref);
            };

            return (
              <div key={safeKey} className="relative">
                {/* card container */}
                <div
                  onClick={onCardClick}
                  role={tender.id ? 'button' : undefined}
                  tabIndex={tender.id ? 0 : undefined}
                  className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-5 group cursor-pointer"
                  onKeyDown={(e) => {
                    if ((e as unknown as KeyboardEvent).key === 'Enter' && tender.id) {
                      router.push(detailsHref);
                    }
                  }}
                >
                  <div className="flex flex-col md:flex-row justify-between gap-4 mb-4">
                    {/* Left Info */}
                    <div className="flex-1 pr-8">
                      {/* Title — show `item` first as requested */}
                      <h3
                        className="text-lg font-bold text-[#0E121A] group-hover:text-blue-700 transition-colors line-clamp-2 mb-2"
                        title={tender.item || tender.category || tender.title}
                      >
                        {tender.item || tender.category || tender.title || 'Untitled tender'}
                      </h3>

                      {/* Row: Bid number + Qty + optional urgent badge */}
                      <div className="flex items-center gap-3 mb-2">
                        <span className="bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide border border-gray-200">
                          {tender.bidNumber || 'ID N/A'}
                        </span>

                        <span className="flex items-center gap-1 bg-gray-50 text-gray-600 text-[10px] font-bold px-2 py-1 rounded border border-gray-200">
                          <FileText className="w-3 h-3" aria-hidden /> {tender.quantity ? `${tender.quantity} Qty` : 'Docs'}
                        </span>

                        {urgent && (
                          <span className="flex items-center gap-1 bg-orange-50 text-orange-700 text-[10px] font-bold px-2 py-1 rounded border border-orange-100">
                            <Clock className="w-3 h-3" aria-hidden /> {timeLeft}
                          </span>
                        )}
                      </div>

                      {/* Status pill */}
                      <div className="mb-3">
                        <span
                          className={`inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded max-w-max ${computeStatus.classes}`}
                          title={computeStatus.text}
                          aria-hidden
                        >
                          {computeStatus.text}
                        </span>
                      </div>
                    </div>

                    {/* Right Info (EMD, Reverse Auction badge moved here, & Shortlist) */}
                    <div className="flex flex-col items-end justify-between shrink-0 gap-3 min-w-[160px]">
                      {/* EMD */}
                      <div className="text-right">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-0.5">EMD Amount</p>
                        <p className="text-base font-semibold text-[#0E121A]">
                          {hasEmd ? formatCurrency(tender.emdAmount ?? 0) : 'N/A'}
                        </p>
                      </div>

                      {/* Row containing Reverse Auction badge (if any) and Shortlist button.
                          We keep them together so Reverse Auction appears to the left of Shortlist. */}
                      <div className="flex items-center gap-3">
                        {/* Reverse Auction badge placed to the left of Shortlist */}
                        {tender.reverseAuctionEnabled && (
                          <div className="inline-flex items-center gap-1 px-3 py-2 text-[11px] font-semibold bg-blue-50 text-blue-700 rounded border border-blue-100">
                            Reverse Auction
                          </div>
                        )}

                        {/* Shortlist Button: stopPropagation so card click does not fire */}
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (!tender.id) {
                              console.warn('Shortlist skipped: tender has no id', tender);
                              return;
                            }
                            void toggleShortlist(e, tender);
                          }}
                          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border text-xs font-bold transition-all justify-center ${
                            tender.isShortlisted ? 'bg-yellow-50 border-[#F7C846] text-yellow-700' : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                          }`}
                          aria-pressed={!!tender.isShortlisted}
                          aria-label={tender.isShortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
                        >
                          <Star className={`w-3 h-3 ${tender.isShortlisted ? 'fill-yellow-500 text-yellow-500' : ''}`} aria-hidden />
                          {tender.isShortlisted ? 'Shortlisted' : 'Shortlist'}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="border-t border-gray-100 pt-4 grid grid-cols-1 md:grid-cols-2 gap-y-3 gap-x-6">
                    {/* Organization */}
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 w-5 h-5 rounded bg-blue-50 flex items-center justify-center shrink-0">
                        <Building2 className="w-3 h-3 text-blue-600" aria-hidden />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-gray-900 line-clamp-1">{tender.ministry || tender.authority || 'Unknown'}</p>
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                          {/* show department first, fallback to location */}
                          {tender.department || tender.location || 'Location not specified'}
                        </div>
                      </div>
                    </div>

                    {/* Dates & metadata — wider area to avoid wrap */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1 flex-1 min-w-[220px]">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Calendar className="w-3 h-3" aria-hidden />
                          Start: <span className="font-medium text-gray-700">{safeFormatDate(tender.publishedDate, 'date')}</span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Clock className="w-3 h-3 text-red-500" aria-hidden />
                          {/* make the end date non-wrapping */}
                          End: <span className="font-bold text-gray-900 whitespace-nowrap">{safeFormatDate(tender.deadline, 'datetime')}</span>
                        </div>
                      </div>

                      <div className="mt-2 flex items-center gap-3 text-xs text-gray-500 md:mt-0">
                        {typeof tender.pageCount === 'number' && (
                          <div className="flex items-center gap-1">
                            <FileText className="w-3 h-3" aria-hidden />
                            <span>{tender.pageCount} pages</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}

           </div>
        )}

        {/* Pagination */}
        {totalRecords > 0 && (
           <div className="mt-8 flex justify-center">
              <div className="flex items-center gap-2">
                 <button 
                   onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                   disabled={currentPage === 1}
                   className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-600 disabled:opacity-50 hover:bg-gray-50"
                   aria-disabled={currentPage === 1}
                 >
                    Previous
                 </button>
                 <span className="text-sm font-medium text-gray-600 px-4">
                    Page {currentPage} / {lastPage}
                 </span>
                 <button 
                   onClick={() => setCurrentPage(p => Math.min(lastPage, p + 1))}
                   disabled={!canGoNext}
                   className="px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm font-bold text-gray-600 disabled:opacity-50 hover:bg-gray-50"
                   aria-disabled={!canGoNext}
                 >
                    Next
                 </button>
              </div>
           </div>
        )}

      </div>
    </div>
  );
}

