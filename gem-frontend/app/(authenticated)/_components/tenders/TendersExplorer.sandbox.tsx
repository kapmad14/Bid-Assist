'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Star,
  X
} from 'lucide-react';

import { tenderClientStoreSandbox } from '@/services/tenderStore.sandbox.client';
import { Tender, TenderSource } from '@/types';
import { useRouter } from 'next/navigation';

export type ExplorerMode = "all" | "shortlisted" | "recommended";

type SortOption =
  | "newest"
  | "oldest"
  | "closing-soon"
  | "closing-latest";

type TabOption =
  | "Active"
  | "Closing Soon"
  | "Shortlisted";

export default function TendersExplorerSandbox({ mode }: { mode: ExplorerMode }) {
  return <TendersContentInner mode={mode} />;
}


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

/**
 * ✅ TEMP: This is your current tenders page logic
 * We are moving it here unchanged first.
 */
function TendersContentInner({ mode }: { mode: ExplorerMode }) {
  const BASE_PATH =
    mode === "shortlisted"
      ? "/sandbox/shortlisted"
      : mode === "recommended"
      ? "/sandbox/recommended"
      : "/sandbox/tenders";


  const searchParams = useSearchParams();
  const qpTab = searchParams?.get('tab');
  const qpRecommended = searchParams?.get('recommended') === 'true';
  const initialPage = Number(searchParams?.get("page") ?? 1);
  const fromDashboard = searchParams?.get('from') === 'dashboard'; // detect CTA entry
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();

  const [supabase, setSupabase] = useState<any>(null);

  useEffect(() => {
    import('@/lib/supabase-client').then(({ createClient }) => {
      setSupabase(createClient());
    });
  }, []);


  // Load shortlist from DB into client store on initial render
  useEffect(() => {
    tenderClientStoreSandbox.loadServerShortlist();
  }, []);


  useEffect(() => {
    // Autofocus ONLY when user comes via Dashboard CTA
    if (fromDashboard) {
      searchInputRef.current?.focus();
    }
  }, [fromDashboard]);

  // Suggested queries (appears only if search is empty)
  const exampleSearches = ["Fire extinguishers", "Security Services", "Office Furniture"];

  type SourceOption = TenderSource;

  const qpSource = searchParams?.get("source") as SourceOption | null;

  const initialSource: SourceOption =
    qpSource === "gem"
      ? "gem"
      : qpSource === "cpwd"
      ? "cpwd"
      : "all";

  const [sourceFilter, setSourceFilter] =
    useState<SourceOption>(initialSource);

  // ✅ Portal activation rules
  const isGem = sourceFilter === "gem";
  const isCpwd = sourceFilter === "cpwd";

  
    // ✅ Always build URLs scoped to the current explorer page
  const buildExplorerUrl = (page: number) => {
    const params = new URLSearchParams();
    params.set("page", String(page));

    if (sourceFilter !== "all") {
      params.set("source", sourceFilter);
    }

    return `${BASE_PATH}?${params.toString()}`;
  };


  const [tenders, setTenders] = useState<Tender[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [currentPage, setCurrentPage] = useState(initialPage);
  // Sync URL ?page=X → currentPage state
  useEffect(() => {
    const p = Number(searchParams?.get("page") ?? 1);

    // IMPORTANT: Only update state if the value is different.
    if (p !== currentPage) {
      setCurrentPage(p);
    }
  }, [searchParams, currentPage]);



  // Filters & UI state
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');

  // ✅ Item Search (applies only on item column, starts at 4 chars)
  const [itemInput, setItemInput] = useState<string>("");
  const [itemFilter, setItemFilter] = useState<string>("");

  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [activeTab, setActiveTab] = useState<TabOption>(() => {
    if (qpTab === 'Closing Soon') return 'Closing Soon';
    if (qpTab === 'Shortlisted') return 'Shortlisted';
    return 'Active';
    });
  const [emdNeeded, setEmdNeeded] = useState<'all' | 'yes' | 'no'>('all');
  const [reverseAuction, setReverseAuction] = useState<'all' | 'yes' | 'no'>('all');
  const [bidTypeFilter, setBidTypeFilter] = useState<'all' | 'single' | 'two'>('all');
  const [evaluationType, setEvaluationType] =
    useState<'all' | 'item' | 'total'>('all');
  // ✅ Autosuggest typing vs applied filter
  const [ministryInput, setMinistryInput] = useState<string>('');
  const [ministryFilter, setMinistryFilter] = useState<string>(''); // applied only after debounce/select
  // ✅ Department Autosuggest
  const [departmentInput, setDepartmentInput] = useState<string>("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("");

  const [locationInput, setLocationInput] = useState<string>("");
  const [locationFilter, setLocationFilter] = useState<string>("");

  const [departmentSuggestions, setDepartmentSuggestions] = useState<string[]>([]);
  const [showDepartmentDropdown, setShowDepartmentDropdown] = useState(false);

  const [departmentSelected, setDepartmentSelected] = useState(false);
  const [activeDepartmentIndex, setActiveDepartmentIndex] = useState(-1);

  // ✅ Refs
  const departmentDropdownRef = useRef<HTMLDivElement | null>(null);
  const departmentWrapperRef = useRef<HTMLDivElement | null>(null);


  const [ministrySuggestions, setMinistrySuggestions] = useState<string[]>([]);
  const [showMinistryDropdown, setShowMinistryDropdown] = useState(false);
  const [ministrySelected, setMinistrySelected] = useState(false);

  const [activeMinistryIndex, setActiveMinistryIndex] = useState(-1);
  // ✅ Ref for dropdown scrolling
  const ministryDropdownRef = useRef<HTMLDivElement | null>(null);
  const ministryWrapperRef = useRef<HTMLDivElement | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [debugError, setDebugError] = useState<string | null>(null);
  const [recommendedOnly, setRecommendedOnly] = useState(
    mode === "recommended" ? true : qpRecommended
  );


  useEffect(() => {
    if (mode === "all" && qpRecommended) {
        setRecommendedOnly(true);
    }
    }, [qpRecommended, mode]);


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

  // ✅ Step X: Item Search (debounced, only applies after 4 chars or cleared)
  useEffect(() => {
   const q = itemInput.trim();

   // Only apply when empty OR >= 3 chars
   if (q.length > 0 && q.length < 3) return;

   const t = setTimeout(() => {
     setItemFilter(q);
     setCurrentPage(1);
   }, 500);

   return () => clearTimeout(t);
  }, [itemInput]);

  // ✅ Reset keyboard selection whenever suggestions refresh
  useEffect(() => {
    setActiveMinistryIndex(-1);
  }, [ministrySuggestions]);

  useEffect(() => {
    setActiveDepartmentIndex(-1);
  }, [departmentSuggestions]);

  useEffect(() => {
  if (!isGem) {
      setReverseAuction("all");
    }
  }, [isGem]);


  // ✅ Step 4D: Auto-scroll highlighted option into view
  useEffect(() => {
    if (activeMinistryIndex < 0) return;

    const dropdown = ministryDropdownRef.current;
    if (!dropdown) return;

    const activeEl = dropdown.querySelector(
      `[data-ministry-index="${activeMinistryIndex}"]`
    ) as HTMLElement | null;

    activeEl?.scrollIntoView({
      block: "nearest",
    });
  }, [activeMinistryIndex]);

  useEffect(() => {
    if (activeDepartmentIndex < 0) return;

    const dropdown = departmentDropdownRef.current;
    if (!dropdown) return;

    const activeEl = dropdown.querySelector(
      `[data-department-index="${activeDepartmentIndex}"]`
    ) as HTMLElement | null;

    activeEl?.scrollIntoView({
      block: "nearest",
    });
  }, [activeDepartmentIndex]);


  // ✅ Step 4E: Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        ministryWrapperRef.current &&
        !ministryWrapperRef.current.contains(event.target as Node)
      ) {
        setShowMinistryDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        departmentWrapperRef.current &&
        !departmentWrapperRef.current.contains(event.target as Node)
      ) {
        setShowDepartmentDropdown(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);


  // ✅ Step 4B: Ministry autosuggest (trigger after 4 chars)
  useEffect(() => {
    if (!isGem) return; // ✅ MOVE HERE

    const q = ministryInput.trim();

    if (ministrySelected) return;

    if (q.length < 4) {
      setMinistrySuggestions([]);
      setShowMinistryDropdown(false);
      return;
    }

    const t = setTimeout(async () => {
      const results = await tenderClientStoreSandbox.getMinistrySuggestions(q);

      setMinistrySuggestions(results);
      setShowMinistryDropdown(results.length > 0);
    }, 250);

    return () => clearTimeout(t);
  }, [ministryInput, ministrySelected, isGem]);



  useEffect(() => {
    if (!isGem) return;
    const q = departmentInput.trim();

    // ✅ If already selected → do not reopen dropdown
    if (departmentSelected) return;

    if (q.length < 4) {
      setDepartmentSuggestions([]);
      setShowDepartmentDropdown(false);
      return;
    }

    const t = setTimeout(async () => {
      if (!isGem) return;
      const results = await tenderClientStoreSandbox.getDepartmentSuggestions(q);

      setDepartmentSuggestions(results);

      if (results.length > 0) {
        setShowDepartmentDropdown(true);
      }
    }, 250);

    return () => clearTimeout(t);
  }, [departmentInput, departmentSelected, isGem]);

  // ✅ STEP 4B.1D: Apply ministry filter only after user pauses typing
  useEffect(() => {
    const q = ministryInput.trim();

    // Only apply filter after 4 chars OR empty (clear)
    if (q.length > 0 && q.length < 4) return;

    const t = setTimeout(() => {
      setMinistryFilter(q);
      setCurrentPage(1);
    }, 500); // wait for typing stop

    return () => clearTimeout(t);
  }, [ministryInput]);

  useEffect(() => {
    const q = departmentInput.trim();

    if (q.length > 0 && q.length < 4) return;

    const t = setTimeout(() => {
      setDepartmentFilter(q);
      setCurrentPage(1);
    }, 500);

    return () => clearTimeout(t);
  }, [departmentInput]);

  // ✅ Location Search activates only after 4 chars (or clear)
  useEffect(() => {
    const q = locationInput.trim();

    if (q.length > 0 && q.length < 4) return;

    const t = setTimeout(() => {
      setLocationFilter(q);
      setCurrentPage(1);
    }, 500);

    return () => clearTimeout(t);
  }, [locationInput]);

    const logUserEvent = useCallback(
      async (eventType: string, eventValue?: any) => {
        try {
          // Supabase client is created immediately, so no null checks
          if (!supabase) return;
          const { data, error } = await supabase.auth.getUser();
          const user = data?.user;

          if (error || !user) return;

          await supabase.from('user_events').insert({
            user_id: user.id,
            event_type: eventType,
            event_value: eventValue ? JSON.stringify(eventValue) : null,
          });
        } catch (err) {
          console.error('Failed to log user event', err);
        }
      },
      [supabase]
    );


  // Reset page to 1 for filter changes

  const resetToFirstPage = () => {
    setCurrentPage(1);
    router.replace(buildExplorerUrl(1), { scroll: false });
    };

    const handleSetSortBy = (val: SortOption) => { setSortBy(val); resetToFirstPage(); };
    const handleSetActiveTab = (val: TabOption) => { setActiveTab(val); resetToFirstPage(); };
    const handleSetEmd = (val: 'all'|'yes'|'no') => { setEmdNeeded(val); resetToFirstPage(); };
    const handleSetReverseAuction = (val: 'all' | 'yes' | 'no') => { setReverseAuction(val); resetToFirstPage(); };
    const handleSetBidType = (val: 'all' | 'single' | 'two') => { setBidTypeFilter(val); resetToFirstPage(); };
    const handleSetEvaluationType = (val: 'all' | 'item' | 'total') => { setEvaluationType(val); resetToFirstPage(); };

    const handleClearAllFilters = () => {
    setSearchInput('');
    setSearchTerm('');
    setItemInput('');
    setItemFilter('');
    setSourceFilter("all");
    setSortBy('newest');
    setActiveTab('Active');
    setEmdNeeded('all');
    setReverseAuction('all');
    setBidTypeFilter('all');
    setEvaluationType('all');
    if (mode !== "recommended") {
        setRecommendedOnly(false);
    }
    setMinistryFilter('');
    setMinistryInput('');
    setLocationInput("");
    setLocationFilter("");
    setMinistrySelected(false);
    setDepartmentFilter('');
    setDepartmentInput('');
    setDepartmentSelected(false);
    resetToFirstPage();
    };


  // Fetch tenders (uses tenderClientStore)
  const fetchTenders = useCallback(async () => {
    setIsLoading(true);
    setDebugError(null);

    try {
      // ✅ Always derive these from mode
      const statusFilter: "open" | "closing-soon" | "shortlisted" =
      mode === "shortlisted"
          ? "shortlisted"
          : activeTab === "Closing Soon"
          ? "closing-soon"
          : "open";

      const recommendationsOnlyFinal =
        mode === "recommended"
            ? true
            : recommendedOnly;


      const { data, total } = await tenderClientStoreSandbox.getTenders({
        page: currentPage,
        limit: PAGE_SIZE,
        search: searchTerm,
        itemSearch: itemFilter,
        statusFilter,
        sortBy,
        emdFilter: emdNeeded,
        reverseAuction, // ← NEW
        bidType: bidTypeFilter,
        evaluationType,
        source: sourceFilter,
        recommendationsOnly: recommendationsOnlyFinal,
        ministry: ministryFilter,
        department: departmentFilter,
        location: locationFilter,
      });


      setTenders(data);
      setTotalRecords(total);

      void logUserEvent('SEARCH_EXECUTED', {
        searchTerm,
        statusFilter,
        sortBy,
        emdNeeded,
        evaluationType,
        recommendedOnly,
        source: sourceFilter,
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
   }, [
   mode,
   currentPage,
   searchTerm,
   sortBy,
   activeTab,
   emdNeeded,
   reverseAuction,
   sourceFilter,
   bidTypeFilter,
   evaluationType,
   recommendedOnly,
   ministryFilter,
   departmentFilter,
   locationFilter,
   itemFilter,
   logUserEvent,
   supabase
 ]);


  useEffect(() => {
    fetchTenders();
  }, [fetchTenders]);

  // ✅ Clamp invalid page after totalRecords changes (fix shortlist SyntaxError)
  useEffect(() => {
    const lastPage = Math.max(1, Math.ceil(totalRecords / PAGE_SIZE));

    if (currentPage > lastPage) {
      router.replace(buildExplorerUrl(lastPage), { scroll: false });
      setCurrentPage(lastPage);
    }
  }, [totalRecords]);


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
       await tenderClientStoreSandbox.toggleShortlist(tender.id!);
       // if viewing Shortlisted tab, refetch to reflect removal
       if (mode === "shortlisted") {
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
        if (!supabase) return;
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

  const formatCamelCase = (val?: string | null) => {
  if (!val) return null;

  return val
    .toLowerCase()
    .split(/[\s_]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
    };

  const getBidTypePill = (bidType?: unknown) => {
    // Defensive existence + type check
    if (!bidType || typeof bidType !== 'string') return null;

    const normalized = bidType.toLowerCase();

    if (normalized.includes('two')) {
        return {
        text: 'Two Packet Bid',
        classes: 'bg-purple-50 text-purple-700 border border-purple-100',
        };
    }

    if (normalized.includes('single')) {
        return {
        text: 'Single Packet Bid',
        classes: 'bg-blue-50 text-blue-700 border border-blue-100',
        };
    }

    // Unknown / unsupported bid type → do not render pill
    return null;
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
     return `Ending Today`;
  };

  /**
   * safeFormatDate
   *
   * - If `val` is a naive DB datetime string like "YYYY-MM-DD HH:mm:ss" (no tz),
   *   this function returns a deterministic formatted string using the same
   *   wall-clock date/time (no timezone conversion).
   *
   * - If `val` is an ISO string that already includes timezone info (Z or +HH:MM),
   *   we parse with Date and format using toLocaleString for readability.
   */
  const safeFormatDate = (val?: string | null, opts: 'date' | 'datetime' = 'date'): string => {
    if (!val) return 'N/A';
    const raw = String(val).trim();

    // Match common naive datetime: "YYYY-MM-DD HH:MM[:SS][.sss]" or "YYYY-MM-DDTHH:MM..."
    const naiveMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/);
    if (naiveMatch) {
      const [, yyyy, mm, dd, hh, mi] = naiveMatch;
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const mon = monthNames[Number(mm) - 1] ?? mm;
      if (opts === 'date') {
        // Return DD MMM YYYY (e.g., 19 Dec 2025)
        return `${dd} ${mon} ${yyyy}`;
      } else {
        // Return "DD MMM YYYY, HH:MM" preserving DB wall-clock time (no timezone shift)
        return `${dd} ${mon} ${yyyy}, ${hh}:${mi}`;
      }
    }

    // If the string contains timezone info (Z or +HH:MM), parse as an absolute instant
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(raw)) {
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) return 'N/A';
      if (opts === 'date') {
        return d.toLocaleDateString('en-IN');
      } else {
        return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
      }
    }

    // Last-resort: attempt to parse with Date (some DB formats might parse), and format
    const maybe = new Date(raw);
    if (!Number.isNaN(maybe.getTime())) {
      if (opts === 'date') return maybe.toLocaleDateString('en-IN');
      return maybe.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
    }

    // If nothing worked, return raw string as a fallback
    return raw;
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
    router.push(buildExplorerUrl(1));
  };

  return (
    <div className="flex flex-col lg:flex-row gap-8 pb-12">      
      {/* --- LEFT SIDEBAR FILTERS --- */}
      <div className="w-full lg:w-72 flex-shrink-0 space-y-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4" aria-hidden={isLoading}>
            <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
                <Filter className="w-5 h-5 text-[#0E121A]" />
                <h2 className="text-lg font-bold text-[#0E121A]">Filters</h2>
            </div>

            <button
                onClick={handleClearAllFilters}
                className="text-xs font-semibold text-blue-600 hover:underline"
            >
                Clear all
            </button>
            </div>

          {/* ✅ Source Filter (Sandbox Step 1) */}
          <div className="mb-4">
            <label
              htmlFor="source-filter"
              className="text-xs font-bold text-gray-700 uppercase mb-1 block"
            >
              Source
            </label>

            <select
              id="source-filter"
              value={sourceFilter}
              onChange={(e) => {
                const val = e.target.value as SourceOption;

                setSourceFilter(val);
                // ✅ Reset portal-specific filters
                setMinistryInput("");
                setMinistryFilter("");
                setDepartmentInput("");
                setDepartmentFilter("");
                setReverseAuction("all");


                // ✅ Reset pagination
                setCurrentPage(1);

                // ✅ Update URL immediately
                router.replace(buildExplorerUrl(1), { scroll: false });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg
                text-sm font-medium bg-white focus:border-[#F7C846]
                focus:ring-1 focus:ring-[#F7C846] outline-none"
            >
              <option value="all">All Sources</option>
              <option value="gem">GEM</option>
              <option value="cpwd">CPWD</option>
            </select>

            <p className="text-[11px] text-gray-500 mt-1">
              Select a source to unlock portal-specific filters.
            </p>
          </div>

          {/* Keyword Search */}
          <div className="mb-4">
            <label htmlFor="tender-search" className="text-xs font-bold text-gray-700 uppercase mb-1 block">General Search</label>
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

          {/* ✅ NEW: Item Search Filter (item column only) */}
          <div className="mb-4">
            <label
              htmlFor="item-filter"
              className="text-xs font-bold text-gray-700 uppercase mb-1 block"
            >
              Item Search
            </label>

            <div className="relative">
              <input
                id="item-filter"
                type="text"
                placeholder="Type 3+ letters..."
                value={itemInput}
                onChange={(e) => setItemInput(e.target.value)}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm font-medium
                  focus:border-[#F7C846] focus:ring-1 focus:ring-[#F7C846] outline-none"
              />

              {/* ✅ Clear (X) Button */}
              {itemInput.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    // ✅ Clear input + applied filter
                    setItemInput("");
                    setItemFilter("");

                    // ✅ Reset pagination
                    setCurrentPage(1);

                    // ✅ Refocus input
                    setTimeout(() => {
                      document.getElementById("item-filter")?.focus();
                    }, 50);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2
                    w-7 h-7 flex items-center justify-center
                    rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                  aria-label="Clear item search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        {/* ✅ NEW: Ministry + Department Filters (Step 3A - Simple Inputs) */}
        <div className="mb-4 space-y-3">

        {/* Ministry Filter */}
        <div ref={ministryWrapperRef} className="relative">
          <label
            htmlFor="ministry-filter"
            className="text-xs font-bold text-gray-700 uppercase mb-1 block"
          >
            Ministry
          </label>

          {/* ✅ Ministry Input */}
            <input
              id="ministry-filter"
              type="text"
              placeholder="Type 4+ letters..."
              value={ministryInput}
              disabled={!isGem}
              onChange={(e) => {
                if (!isGem) return;
                const val = e.target.value;

                setMinistryInput(val);

                // ✅ User typing again → unlock dropdown mode
                if (ministrySelected) {
                  setMinistrySelected(false);
                }
              }}

              onKeyDown={(e) => {
                if (!isGem) return;
                if (!showMinistryDropdown) return;

                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setActiveMinistryIndex((prev) =>
                    Math.min(prev + 1, ministrySuggestions.length - 1)
                  );
                }

                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setActiveMinistryIndex((prev) => Math.max(prev - 1, 0));
                }

                if (e.key === "Enter") {
                  e.preventDefault();

                  const selected = ministrySuggestions[activeMinistryIndex];
                  if (!selected) return;

                  setMinistryInput(selected);
                  setMinistryFilter(selected);
                  setMinistrySelected(true);

                  setShowMinistryDropdown(false);
                  setMinistrySuggestions([]);
                  setActiveMinistryIndex(-1);
                  setCurrentPage(1);
                }

                if (e.key === "Escape") {
                  setShowMinistryDropdown(false);
                }
              }}

              onFocus={() => {
                if (!isGem) return;
                // ✅ Do not reopen if locked
                if (ministrySelected) return;

                if (ministrySuggestions.length > 0) {
                  setShowMinistryDropdown(true);
                }
              }}

              // ✅ Add padding-right so X button does not overlap
              className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm font-medium focus:border-[#F7C846] focus:ring-1 focus:ring-[#F7C846] outline-none"
            />

              {!isGem && (
                <p className="text-[11px] text-gray-400 mt-1">
                  Activate <b>GEM</b> source to unlock this filter.
                </p>
              )}

            {/* ✅ Clear (X) Button */}
            {isGem && ministryInput.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  // ✅ Clear everything
                  setMinistryInput("");
                  setMinistryFilter("");

                  // ✅ Unlock selection mode
                  setMinistrySelected(false);

                  // ✅ Close dropdown cleanly
                  setShowMinistryDropdown(false);
                  setMinistrySuggestions([]);
                  setActiveMinistryIndex(-1);

                  // ✅ Reset pagination
                  setCurrentPage(1);

                  // ✅ Refocus input
                  setTimeout(() => {
                    document.getElementById("ministry-filter")?.focus();
                  }, 50);
                }}
                className="absolute right-3 top-[55%] -translate-y-1/4
                  w-7 h-7 flex items-center justify-center
                  rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                aria-label="Clear ministry"
              >
                <X className="w-4 h-4" />
              </button>
            )}


          {/* ✅ Dropdown */}
          {showMinistryDropdown &&
            !ministrySelected &&
            ministrySuggestions.length > 0 && (
            <div
              ref={ministryDropdownRef}
              className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto"
            >
              {ministrySuggestions.map((name, idx) => (
                <button
                  key={name}
                  type="button"
                  data-ministry-index={idx}
                  onClick={() => {
                    setMinistryInput(name);
                    setMinistryFilter(name);
                    setMinistrySelected(true);
                    setShowMinistryDropdown(false);
                    setMinistrySuggestions([]);
                    setActiveMinistryIndex(-1);
                    setCurrentPage(1);
                  }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                    idx === activeMinistryIndex ? "bg-gray-100 font-semibold" : ""
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>


        {/* Department Filter */}
        <div ref={departmentWrapperRef} className="relative">
          <label
            htmlFor="department-filter"
            className="text-xs font-bold text-gray-700 uppercase mb-1 block"
          >
            Department
          </label>
              <input
                id="department-filter"
                type="text"
                placeholder="Type 4+ letters..."
                value={departmentInput}
                disabled={!isGem}
                onChange={(e) => {
                  if (!isGem) return;
                  const val = e.target.value;
                  setDepartmentInput(val);

                  // ✅ Unlock if user types again
                  if (departmentSelected) {
                    setDepartmentSelected(false);
                  }
                }}

                onKeyDown={(e) => {
                  if (!isGem) return;
                  if (!showDepartmentDropdown) return;

                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setActiveDepartmentIndex((prev) =>
                      Math.min(prev + 1, departmentSuggestions.length - 1)
                    );
                  }

                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setActiveDepartmentIndex((prev) => Math.max(prev - 1, 0));
                  }

                  if (e.key === "Enter") {
                    e.preventDefault();
                    const selected = departmentSuggestions[activeDepartmentIndex];
                    if (!selected) return;

                    setDepartmentInput(selected);
                    setDepartmentFilter(selected);

                    // ✅ Lock selection
                    setDepartmentSelected(true);

                    setShowDepartmentDropdown(false);
                    setDepartmentSuggestions([]);
                    setActiveDepartmentIndex(-1);

                    setCurrentPage(1);
                  }

                  if (e.key === "Escape") {
                    setShowDepartmentDropdown(false);
                  }
                }}

                onFocus={() => {
                  if (!isGem) return;
                  if (departmentSelected) return;
                  if (departmentSuggestions.length > 0) {
                    setShowDepartmentDropdown(true);
                  }
                }}

                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg
                  text-sm font-medium focus:border-[#F7C846] focus:ring-1 focus:ring-[#F7C846] outline-none"
              />
              {!isGem && (
                <p className="text-[11px] text-gray-400 mt-1">
                  Activate <b>GEM</b> source to unlock this filter.
                </p>
              )}

              {/* ✅ Clear Button */}
              {isGem && departmentInput.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setDepartmentInput("");
                    setDepartmentFilter("");

                    setDepartmentSelected(false);

                    setShowDepartmentDropdown(false);
                    setDepartmentSuggestions([]);
                    setActiveDepartmentIndex(-1);

                    setCurrentPage(1);

                    setTimeout(() => {
                      document.getElementById("department-filter")?.focus();
                    }, 50);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/5
                    w-7 h-7 flex items-center justify-center
                    rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-800"
                  aria-label="Clear department"
                >
                  <X className="w-4 h-4" />
                </button>
              )}

              {/* ✅ Dropdown */}
              {showDepartmentDropdown &&
                !departmentSelected &&
                departmentSuggestions.length > 0 && (
                  <div
                    ref={departmentDropdownRef}
                    className="absolute z-30 mt-1 w-full bg-white border border-gray-200
                      rounded-lg shadow-lg max-h-56 overflow-auto"
                  >
                    {departmentSuggestions.map((name, idx) => (
                      <button
                        key={name}
                        type="button"
                        data-department-index={idx}
                        onClick={() => {
                          setDepartmentInput(name);
                          setDepartmentFilter(name);

                          setDepartmentSelected(true);

                          setShowDepartmentDropdown(false);
                          setDepartmentSuggestions([]);
                          setActiveDepartmentIndex(-1);

                          setCurrentPage(1);
                        }}
                        className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 ${
                          idx === activeDepartmentIndex
                            ? "bg-gray-100 font-semibold"
                            : ""
                        }`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                )}
            </div>

          </div>

        {/* ✅ NEW: Location Search (Address OR Pincode) */}
        <div className="relative">
          <label
            htmlFor="location-filter"
            className="text-xs font-bold text-gray-700 uppercase mb-1 block"
          >
            Location Search
          </label>

          <input
            id="location-filter"
            type="text"
            placeholder="Type 4+ letters or pincode..."
            value={locationInput}
            onChange={(e) => setLocationInput(e.target.value)}
            className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg
              text-sm font-medium focus:border-[#F7C846]
              focus:ring-1 focus:ring-[#F7C846] outline-none"
          />

          {/* ✅ Clear Button */}
          {locationInput.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setLocationInput("");
                setLocationFilter("");
                setCurrentPage(1);

                setTimeout(() => {
                  document.getElementById("location-filter")?.focus();
                }, 50);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/5
                w-7 h-7 flex items-center justify-center
                rounded-full hover:bg-gray-100 text-gray-500 hover:text-gray-800"
              aria-label="Clear location"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* ✅ Work Type (CPWD Only) */}
        <div className="mt-4">
          <label className="text-xs font-bold text-gray-700 uppercase mb-1 block">
            Work Type
          </label>

          <select
            disabled={!isCpwd}
            className={`w-full px-3 py-2 border rounded-lg text-sm font-medium outline-none
              ${isCpwd
                ? "border-gray-300 focus:border-[#F7C846] focus:ring-1 focus:ring-[#F7C846]"
                : "bg-gray-100 text-gray-400 cursor-not-allowed border-gray-200"}
            `}
          >
            <option value="">Select Work Type...</option>
            <option value="civil">Civil Works</option>
            <option value="electrical">Electrical Works</option>
            <option value="plumbing">Plumbing</option>
          </select>

          {!isCpwd && (
            <p className="text-[11px] text-gray-400 mt-1">
              Activate <b>CPWD</b> source to unlock Work Type.
            </p>
          )}
        </div>

          {/* Accordion Filters */}
          <div className="divide-y divide-gray-100">
             {/* EMD Needed - Radio Buttons */}
             <FilterSection title="EMD Needed" isOpen={false}>
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
             {/* Reverse Auction - Radio Buttons */}
             <div
                className={`rounded-lg ${
                  isGem ? "" : "opacity-50 pointer-events-none"
                }`}
              >
              <FilterSection title="Reverse Auction" isOpen={false}>
                <div className="space-y-2">
                  <label className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                    <input
                      type="radio"
                      name="reverseAuction"
                      value="all"
                      checked={reverseAuction === 'all'}
                      onChange={() => handleSetReverseAuction('all')}
                      className="w-4 h-4 text-[#F7C846] border-gray-300 accent-[#F7C846]"
                    />
                    Any
                  </label>

                  <label className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                    <input
                      type="radio"
                      name="reverseAuction"
                      value="yes"
                      checked={reverseAuction === 'yes'}
                      onChange={() => handleSetReverseAuction('yes')}
                      className="w-4 h-4 text-[#F7C846] border-gray-300 accent-[#F7C846]"
                    />
                    Yes
                  </label>

                  <label className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900 cursor-pointer">
                    <input
                      type="radio"
                      name="reverseAuction"
                      value="no"
                      checked={reverseAuction === 'no'}
                      onChange={() => handleSetReverseAuction('no')}
                      className="w-4 h-4 text-[#F7C846] border-gray-300 accent-[#F7C846]"
                    />
                    No
                  </label>
                </div>
              </FilterSection>
              </div>
              {/* ✅ Visible Callout */}
              {!isGem && (
                <p className="text-[11px] text-gray-400 mt-2 px-1">
                  Reverse Auction is available only when <b>GEM</b> source is selected.
                </p>
              )}              
          </div>
        </div>
      </div>
      
        {/* --- MAIN CONTENT AREA --- */}
      <div className="flex-1 min-w-0 flex flex-col" aria-busy={isLoading}>        
        {/* Top Controls */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm">
           {/* Tabs */}
           <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0" role="tablist" aria-label="Tender tabs">
                {mode !== "shortlisted" && (
                <div className="flex bg-gray-100 p-1 rounded-lg whitespace-nowrap">
                    {["Active", "Closing Soon"].map((tab) => (
                    <button
                        key={tab}
                        onClick={() => handleSetActiveTab(tab as TabOption)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                        activeTab === tab
                            ? "bg-gray-200 text-[#0E121A] shadow-sm"
                            : "text-gray-500 hover:text-gray-700"
                        }`}
                    >
                        {tab}
                    </button>
                    ))}
                </div>
                )}
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

        {/* Alert Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-4">
          <div className="flex items-center gap-3">

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

          </div>

          {/* Right-side kept intentionally empty (removed manual sync button) */}
          <div className="flex items-center gap-2">
            {/* no-op placeholder - removed manual sync */}
          </div>
        </div>

        {/* Scrollable Tender Container */}
        <div className="pr-2">
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
                    : activeTab === 'Closing Soon'
                    ? "No tenders closing soon match your criteria."
                    : `No ${activeTab.toLowerCase()} tenders found matching your criteria.`}
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
                      setItemInput('');
                      setItemFilter('');
                      setEmdNeeded('all');
                      setBidTypeFilter('all');
                      setEvaluationType('all');
                      if (mode !== "shortlisted") {
                      setActiveTab("Active");
                      }
                      if (mode !== "recommended") {
                      setRecommendedOnly(false);
                      }
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
            const urgent = isClosingSoon(tender.deadline?.toISOString() ?? null);
            const timeLeft = getTimeLeft(tender.deadline?.toISOString() ?? null);
            const hasEmd = (tender.emdAmount ?? 0) > 0;

            // ✅ Source detection per tender row
            const source = (tender.raw?.source ?? "gem") as TenderSource;
            const isGemTender = source === "gem";
            const isCpwdTender = source === "cpwd";


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
            // ✅ Preserve correct back navigation source
            const fromParam =
              mode === "shortlisted"
                ? "sandbox-shortlisted"
                : mode === "recommended"
                ? "sandbox-recommended"
                : "sandbox-tenders";


            const detailsHref = `/tenders/${tender.id}?from=${fromParam}&page=${currentPage}`;

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
                        className="text-lg font-semibold text-[#0E121A] group-hover:text-blue-700 transition-colors line-clamp-2 mb-4"
                        title={(tender.item || tender.category || tender.title) ?? undefined}
                      >
                        {tender.item || tender.category || tender.title || 'Untitled tender'}
                      </h3>

                      {/* Row: Bid number + Qty + optional urgent badge */}
                      <div className="flex items-center gap-3 mb-2">
                        <span className="bg-gray-100 text-gray-700 text-[10px] font-bold px-2 py-1 rounded uppercase tracking-wide border border-gray-200">
                          {tender.bidNumber || 'ID N/A'}
                        </span>

                        <span className="flex items-center gap-1 bg-gray-50 text-gray-600 text-[10px] font-bold px-2 py-1 rounded border border-gray-200">
                        <FileText className="w-3 h-3" aria-hidden />
                        {typeof tender.quantity === 'number'
                            ? `Quantity: ${tender.quantity}`
                            : 'Docs'}
                        </span>

                        {Array.isArray(tender.documentsRequired) && tender.documentsRequired.length > 0 && (
                        <span className="flex items-center gap-1 bg-gray-50 text-gray-600 text-[10px] font-bold px-2 py-1 rounded border border-gray-200">
                            📄 Docs Required: {tender.documentsRequired.length}
                        </span>
                        )}

                        {urgent && (
                          <span className="flex items-center gap-1 bg-orange-50 text-orange-700 text-[10px] font-bold px-2 py-1 rounded border border-orange-100">
                            <Clock className="w-3 h-3" aria-hidden /> {timeLeft}
                          </span>
                        )}
                      </div>

                      {/* Status pill */}
                        <div className="mb-3 flex flex-wrap items-center gap-2">
                        {/* Status pill */}
                        <span
                            className={`inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded ${computeStatus.classes}`}
                            title={computeStatus.text}
                        >
                            {computeStatus.text}
                        </span>

                        {/* Bid Type pill — rendered only if valid */}
                        {isGemTender && (() => {
                          const bidTypePill = getBidTypePill(tender?.bidType);
                          if (!bidTypePill) return null;

                          return (
                            <span
                              className={`inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded ${bidTypePill.classes}`}
                              title="Bid Type"
                            >
                              {bidTypePill.text}
                            </span>
                          );
                        })()}


                        {tender.evaluationMethod && (
                        <span
                            className="inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded
                            bg-slate-50 text-slate-700 border border-slate-200"
                            title="Evaluation Method"
                        >
                            {formatCamelCase(tender.evaluationMethod)}
                        </span>
                        )}

                        </div>
                    </div>

                    {/* Right Info (EMD, Reverse Auction badge moved here, & Shortlist) */}
                    <div className="flex flex-col items-end justify-between shrink-0 gap-3 min-w-[160px]">
                      {/* EMD */}
                      <div className="text-right">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-0.5">EMD Amount</p>
                        <p className="text-base font-semibold text-[#0E121A]">
                          {hasEmd ? formatCurrency(tender.emdAmount ?? 0) : 'Not Required'}
                        </p>
                      </div>

                      {/* Row containing Reverse Auction badge (if any) and Shortlist button.
                          We keep them together so Reverse Auction appears to the left of Shortlist. */}
                      <div className="flex items-center gap-3">
                        {/* Reverse Auction badge placed to the left of Shortlist */}
                        {isGemTender && tender.reverseAuctionEnabled && (
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
                        <p className="text-sm font-bold text-gray-900 line-clamp-1">
                        {(() => {
                            const addr = tender.organizationAddress?.trim();
                            const pin = tender.pincode?.trim();

                            if (addr && pin) return `${addr} - ${pin}`;
                            if (addr) return addr;
                            if (pin) return pin;

                            return tender.organizationName || 'Unknown Organisation';
                        })()}
                        </p>
                        <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                        {tender.department ? (
                            <span>{tender.department}</span>
                        ) : tender.organizationAddress || tender.pincode ? (
                            <>
                            <MapPin className="w-3 h-3" aria-hidden />
                            <span>
                                {tender.organizationAddress ?? ''}
                                {tender.pincode ? ` - ${tender.pincode}` : ''}
                            </span>
                            </>
                        ) : tender.organizationName ? (
                            <span>{tender.organizationName}</span>
                        ) : (
                            'Location not specified'
                        )}
                        </div>
                      </div>
                    </div>

                    {/* Dates & metadata — wider area to avoid wrap */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                      <div className="space-y-1 flex-1 min-w-[220px]">
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Calendar className="w-3 h-3" aria-hidden />
                          Start: <span className="font-medium text-gray-700">
                            {tender.startDate || tender.publishedDate || 'N/A'}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <Clock className="w-3 h-3 text-red-500" aria-hidden />
                          {/* make the end date non-wrapping */}
                          End: <span className="font-bold text-gray-900 whitespace-nowrap">{tender.endDate ?? 'N/A'}</span>
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
            {totalRecords > 0 && (
                <div className="py-8 flex justify-center">
                    <div className="flex items-center gap-2">
                    {/* Prev Button */}
                    <button
                        onClick={() => router.push(buildExplorerUrl(currentPage - 1))}
                        disabled={currentPage === 1}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-all
                        ${
                            currentPage === 1
                            ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                        }
                        `}
                    >
                        Prev
                    </button>

                    {/* Page Numbers */}
                    {(() => {
                        const pages: (number | string)[] = [];
                        const total = lastPage;

                        const add = (p: number | string) => pages.push(p);

                        add(1);

                        if (currentPage > 4) add("...");

                        const start = Math.max(2, currentPage - 2);
                        const end = Math.min(total - 1, currentPage + 2);

                        for (let i = start; i <= end; i++) add(i);

                        if (currentPage < total - 3) add("...");

                        if (total > 1) add(total);

                        return pages.map((p, idx) =>
                        p === "..." ? (
                            <span key={`ellipsis-${idx}`} className="px-2 text-gray-500">…</span>
                        ) : (
                            <button
                            key={`page-${p}`}
                            onClick={() => router.push(buildExplorerUrl(Number(p)))}
                            className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-all
                                ${
                                p === currentPage
                                    ? "bg-blue-600 text-white border-blue-600 shadow"
                                    : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                                }
                            `}
                            >
                            {p}
                            </button>
                        )
                        );
                    })()}

                    {/* Next Button */}
                    <button
                        onClick={() => router.push(buildExplorerUrl(Math.min(lastPage, currentPage + 1)))}
                        disabled={currentPage === lastPage}
                        className={`px-3 py-1.5 rounded-md border text-sm font-medium transition-all
                        ${
                            currentPage === lastPage
                            ? "bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed"
                            : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100"
                        }
                        `}
                    >
                        Next
                    </button>
                    </div>
                </div>
                )}
          </div>
      </div>
    </div>
  );
}