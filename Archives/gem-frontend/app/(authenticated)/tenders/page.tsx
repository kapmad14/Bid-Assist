'use client';

import Link from 'next/link';
import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@/lib/supabase-client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X, Upload } from 'lucide-react';

interface Tender {
  id: number;
  bid_number: string;
  item_category_parsed: string;
  ministry: string;
  department: string;
  organization_name_parsed: string;
  bid_end_datetime: string;
  bid_date: string;
  emd_amount_parsed: string;
  total_quantity_parsed: string;
  organization_type: string;
  pincode: string;
}

type SortOption = 'newest' | 'oldest' | 'closing-soon' | 'closing-latest';
type StatusFilter = 'all' | 'open' | 'urgent' | 'closed';
type EMDFilter = 'all' | 'required' | 'not-required';

export default function TendersPage() {
  const supabase = createClient();
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [emdFilter, setEMDFilter] = useState<EMDFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Recommendations toggle + loading indicator
  const [showRecommendationsOnly, setShowRecommendationsOnly] = useState<boolean>(false);
  const [loadingRecommendations, setLoadingRecommendations] = useState<boolean>(false);

  // Pagination
  const [page, setPage] = useState<number>(0);
  const pageSize = 12; // show 12 tenders per page

  useEffect(() => {
    async function fetchTenders() {
      setLoading(true);
      setError(null);
      try {
        // If recommendations toggle is OFF -> original behaviour (fetch all tenders paginated)
        if (!showRecommendationsOnly) {
          // apply server-side pagination via range
          const start = page * pageSize;
          const end = start + pageSize - 1;

          const { data, error } = await supabase
            .from('tenders')
            .select('*')
            .order('created_at', { ascending: false })
            .range(start, end);

          if (error) throw error;
          setTenders(data || []);
          setLoading(false);
          return;
        }

        // ----------------- Recommendations branch (server-side) -----------------
        // 1) get current user
        const userResp = await supabase.auth.getUser();
        const userData = (userResp as any).data;
        const userErr = (userResp as any).error;
        if (userErr || !userData?.user) {
          // if no user, show nothing for recommendations
          setTenders([]);
          setLoading(false);
          return;
        }
        const userId = userData.user.id;

        // 2) fetch active catalog item ids for this user
        setLoadingRecommendations(true);
        const catalogResp = await supabase
          .from('catalog_items')
          .select('id')
          .eq('user_id', userId)
          .neq('status', 'paused'); // only active items
        const { data: catalogItems, error: catErr } = catalogResp as any;
        if (catErr) throw catErr;

        const activeCatalogIds = (catalogItems || []).map((c: any) => c.id);
        if (activeCatalogIds.length === 0) {
          setTenders([]);
          setLoadingRecommendations(false);
          setLoading(false);
          return;
        }

        // 3) fetch recommendations for user and those catalog items
        const recsResp = await supabase
          .from('recommendations')
          .select('tender_id')
          .eq('user_id', userId)
          .in('catalog_item_id', activeCatalogIds);
        const { data: recs, error: recErr } = recsResp as any;
        if (recErr) throw recErr;

        // convert tender ids to numbers (tenders.id is numeric)
        const matchedTenderIds = (recs || []).map((r: any) => Number(r.tender_id)).filter(Boolean);

        if (!matchedTenderIds || matchedTenderIds.length === 0) {
          setTenders([]);
          setLoadingRecommendations(false);
          setLoading(false);
          return;
        }

        // 4) fetch tenders by matched IDs with pagination
        const start = page * pageSize;
        const end = start + pageSize - 1;

        const { data: matchedTenders, error: matchedErr } = await supabase
          .from('tenders')
          .select('*')
          .in('id', matchedTenderIds)
          .order('created_at', { ascending: false })
          .range(start, end);

        if (matchedErr) throw matchedErr;
        setTenders(matchedTenders || []);
        setLoadingRecommendations(false);
        setLoading(false);
      } catch (err: any) {
        setError(err?.message || String(err));
        setTenders([]);
        setLoading(false);
        setLoadingRecommendations(false);
      }
    }

    fetchTenders();
    // whenever key UI state changes, the effect reruns; page is included so paging works
  }, [supabase, showRecommendationsOnly, page]);

  // whenever filters/search/sort/recommendation toggle changes, reset page to 0
  useEffect(() => {
    setPage(0);
  }, [searchQuery, sortBy, statusFilter, emdFilter, showRecommendationsOnly]);

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  const formatCurrency = (amount: string) => {
    if (!amount) return 'N/A';
    const num = parseFloat(amount);
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(num);
  };

  const isClosingSoon = (dateString: string) => {
    if (!dateString) return false;
    const endDate = new Date(dateString);
    const today = new Date();
    const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    return diffDays <= 7 && diffDays > 0; // urgent = 7 days
  };

  const isClosed = (dateString: string) => {
    if (!dateString) return false;
    const endDate = new Date(dateString);
    const today = new Date();
    return endDate < today;
  };

  const getTenderStatus = (tender: Tender): 'open' | 'urgent' | 'closed' => {
    if (isClosed(tender.bid_end_datetime)) return 'closed';
    if (isClosingSoon(tender.bid_end_datetime)) return 'urgent';
    return 'open';
  };

  const hasEMD = (tender: Tender): boolean => {
    return tender.emd_amount_parsed && parseFloat(tender.emd_amount_parsed) > 0;
  };

  // Apply filters and sorting (unchanged except client-side overlay)
  const filteredAndSortedTenders = useMemo(() => {
    let result = [...tenders];

    // Search filter (client-side)
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((tender) => {
        return (
          tender.bid_number?.toLowerCase().includes(query) ||
          tender.item_category_parsed?.toLowerCase().includes(query) ||
          tender.ministry?.toLowerCase().includes(query) ||
          tender.organization_name_parsed?.toLowerCase().includes(query)
        );
      });
    }

    // Status filter (client-side overlay)
    if (statusFilter !== 'all') {
      result = result.filter((tender) => getTenderStatus(tender) === statusFilter);
    }

    // EMD filter
    if (emdFilter !== 'all') {
      result = result.filter((tender) => {
        const hasEMDAmount = hasEMD(tender);
        return emdFilter === 'required' ? hasEMDAmount : !hasEMDAmount;
      });
    }

    // Sorting
    result.sort((a, b) => {
      switch (sortBy) {
        case 'newest':
          return new Date(b.bid_date || '').getTime() - new Date(a.bid_date || '').getTime();
        case 'oldest':
          return new Date(a.bid_date || '').getTime() - new Date(b.bid_date || '').getTime();
        case 'closing-soon':
          return new Date(a.bid_end_datetime || '').getTime() - new Date(b.bid_end_datetime || '').getTime();
        case 'closing-latest':
          return new Date(b.bid_end_datetime || '').getTime() - new Date(a.bid_end_datetime || '').getTime();
        default:
          return 0;
      }
    });

    return result;
  }, [tenders, searchQuery, sortBy, statusFilter, emdFilter]);

  const clearFilters = () => {
    setSearchQuery('');
    setSortBy('newest');
    setStatusFilter('all');
    setEMDFilter('all');
  };

  const hasActiveFilters = !!(searchQuery || sortBy !== 'newest' || statusFilter !== 'all' || emdFilter !== 'all');

  // Pagination controls helpers
  const goPrev = () => setPage((p) => Math.max(0, p - 1));
  const goNext = () => setPage((p) => p + 1);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-gray-900 font-medium">Loading tenders...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-600 font-medium">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header Section */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold text-[#0E121A]">All Tenders</h1>
          <p className="text-gray-700 font-medium mt-2">Browse and manage tender opportunities</p>
        </div>
        <Button className="bg-[#F7C846] hover:bg-[#F7C846]/90 text-[#0E121A] font-semibold shadow-md">
          <Upload className="h-4 w-4 mr-2" />
          Upload Tender
        </Button>
      </div>

      {/* Search and Filters Bar */}
      <div className="space-y-4 mb-10">
        <div className="flex flex-col lg:flex-row gap-4 overflow-visible"> {/* allow dropdowns to escape */}
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 h-5 w-5" />
            <Input
              type="text"
              placeholder="Search by bid number, category, ministry..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 border-2 border-gray-300 text-gray-900 placeholder-gray-500 font-semibold h-12 min-h-[48px] leading-none rounded-lg"
            />
          </div>

          {/* Sort By */}
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
            <SelectTrigger
              className="w-full lg:w-[200px] border-2 border-gray-300 font-bold text-gray-900 h-12 min-h-[48px] leading-none bg-white rounded-lg flex items-center"
              aria-label="Sort by"
            >
              <SelectValue placeholder="Newest First" />
            </SelectTrigger>
            <SelectContent className="bg-white z-50 mt-2 shadow-lg rounded-lg max-h-60 overflow-auto">
              <SelectItem value="newest" className="font-semibold py-3">Newest First</SelectItem>
              <SelectItem value="oldest" className="font-semibold py-3">Oldest First</SelectItem>
              <SelectItem value="closing-soon" className="font-semibold py-3">Closing Soon</SelectItem>
              <SelectItem value="closing-latest" className="font-semibold py-3">Closing Latest</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="w-full lg:w-[160px] border-2 border-gray-300 font-bold text-gray-900 h-12 min-h-[48px] leading-none bg-white rounded-lg flex items-center" aria-label="Filter by status">
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent className="bg-white z-50 mt-2 shadow-lg rounded-lg max-h-60 overflow-auto">
              <SelectItem value="all" className="font-semibold py-3">All Status</SelectItem>
              <SelectItem value="open" className="font-semibold py-3">Open</SelectItem>
              <SelectItem value="urgent" className="font-semibold py-3">Urgent</SelectItem>
              <SelectItem value="closed" className="font-semibold py-3">Closed</SelectItem>
            </SelectContent>
          </Select>

          {/* EMD Filter */}
          <Select value={emdFilter} onValueChange={(value) => setEMDFilter(value as EMDFilter)}>
            <SelectTrigger className="w-full lg:w-[180px] border-2 border-gray-300 font-bold text-gray-900 h-12 min-h-[48px] leading-none bg-white rounded-lg flex items-center" aria-label="Filter by EMD">
              <SelectValue placeholder="All EMD" />
            </SelectTrigger>
            <SelectContent className="bg-white z-50 mt-2 shadow-lg rounded-lg max-h-60 overflow-auto">
              <SelectItem value="all" className="font-semibold py-3">All EMD</SelectItem>
              <SelectItem value="required" className="font-semibold py-3">EMD Required</SelectItem>
              <SelectItem value="not-required" className="font-semibold py-3">No EMD</SelectItem>
            </SelectContent>
          </Select>

          {/* Recommended toggle (keeps original look but forces visibility) */}
          <div className="flex items-center gap-2 px-2 z-40">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showRecommendationsOnly}
                onChange={(e) => {
                  setShowRecommendationsOnly(e.target.checked);
                }}
                aria-label="Show recommended tenders only"
                className="w-4 h-4 accent-[#0E121A]"
              />
              <span className="font-semibold text-[#0E121A] leading-none select-none">
                Recommended for me
              </span>
            </label>
            {loadingRecommendations && <span className="text-sm text-gray-500">loading…</span>}
          </div>


          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button
              variant="outline"
              onClick={clearFilters}
              className="w-full lg:w-auto border-2 border-gray-300 font-bold text-gray-900 h-12 min-h-[48px] leading-none bg-white hover:bg-gray-50 rounded-lg flex items-center justify-center"
              type="button"
            >
              <X className="h-4 w-4 mr-2" />
              Clear
            </Button>
          )}
        </div>

        {/* Results Count */}
        <div className="text-sm text-gray-900 font-bold">
          Showing {filteredAndSortedTenders.length} items (page {page + 1})
        </div>
      </div>

      {/* Tenders Grid - Clickable Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {filteredAndSortedTenders.map((tender) => {
          const status = getTenderStatus(tender);
          return (
            <Link key={tender.id} href={`/tenders/${tender.id}`}>
              <Card className="hover:shadow-xl hover:scale-[1.02] transition-all cursor-pointer h-full border-gray-200">
                <CardHeader>
                  <div className="flex justify-between items-start gap-2">
                    <CardTitle className="text-lg text-[#0E121A]">{tender.bid_number}</CardTitle>
                    {status === 'closed' ? (
                      <Badge variant="destructive" className="font-semibold">Closed</Badge>
                    ) : status === 'urgent' ? (
                      <Badge variant="warning" className="font-semibold">Urgent</Badge>
                    ) : (
                      <Badge variant="success" className="font-semibold">Open</Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-700 font-medium mt-2 line-clamp-2">
                    {tender.item_category_parsed || 'Category not available'}
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="text-xs text-gray-600 font-medium">Ministry</p>
                    <p className="font-semibold text-sm text-gray-900">{tender.ministry || 'N/A'}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-medium">Organization</p>
                    <p className="font-semibold text-sm text-gray-900 line-clamp-1">
                      {tender.organization_name_parsed || 'N/A'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <p className="text-xs text-gray-600 font-medium">End Date</p>
                      <p className="font-semibold text-sm text-gray-900">{formatDate(tender.bid_end_datetime)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-600 font-medium">Quantity</p>
                      <p className="font-semibold text-sm text-gray-900">{tender.total_quantity_parsed || 'N/A'}</p>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs text-gray-600 font-medium">EMD Amount</p>
                    <p className="font-semibold text-sm text-gray-900">{formatCurrency(tender.emd_amount_parsed)}</p>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      {/* No Results Message */}
      {filteredAndSortedTenders.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-700 text-lg font-medium">No tenders found</p>
          {hasActiveFilters && (
            <p className="text-gray-600 text-sm mt-2">
              Try adjusting your filters or search query
            </p>
          )}
        </div>
      )}

      {/* Pagination Footer */}
      {/* Pagination Footer (visible + accessible) */}
      <div
        className="mt-8 py-4 px-2 flex items-center justify-between bg-transparent z-50"
        style={{ color: '#0E121A' }}
        aria-label="pagination-footer"
      >
        <div className="text-sm font-medium" style={{ color: '#0E121A' }}>
          Page <span className="font-semibold">{page + 1}</span>
        </div>

        <div className="flex gap-2">
          <button
            onClick={goPrev}
            disabled={page === 0}
            aria-disabled={page === 0}
            className="border px-3 py-2 rounded bg-white hover:bg-gray-50 active:scale-[0.995]"
            style={{
              opacity: page === 0 ? 0.6 : 1,
              cursor: page === 0 ? 'not-allowed' : 'pointer',
              color: '#0E121A',
            }}
          >
            Prev
          </button>

          <button
            onClick={goNext}
            className="border px-3 py-2 rounded bg-white hover:bg-gray-50 active:scale-[0.995]"
            style={{ color: '#0E121A' }}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
