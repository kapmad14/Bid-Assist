'use client';

import Link from 'next/link';
import { useEffect, useState, useMemo } from 'react';
import { createClient } from '@supabase/supabase-js';
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('newest');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [emdFilter, setEMDFilter] = useState<EMDFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchTenders() {
      try {
        const { data, error } = await supabase
          .from('tenders')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;
        setTenders(data || []);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchTenders();
  }, []);

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
    return diffDays <= 7 && diffDays > 0;
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

  // Apply filters and sorting
  const filteredAndSortedTenders = useMemo(() => {
    let result = [...tenders];

    // Search filter
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

    // Status filter
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

  const hasActiveFilters = searchQuery || sortBy !== 'newest' || statusFilter !== 'all' || emdFilter !== 'all';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg">Loading tenders...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-lg text-red-600">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header Section */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-3xl font-bold">All Tenders</h1>
          <p className="text-gray-600 mt-2">Browse and manage tender opportunities</p>
        </div>
        <Button className="bg-blue-600 hover:bg-blue-700">
          <Upload className="h-4 w-4 mr-2" />
          Upload Tender
        </Button>
      </div>

      {/* Search and Filters Bar */}
      <div className="space-y-4 mb-10">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
            <Input
              type="text"
              placeholder="Search by bid number, category, ministry..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {/* Sort By */}
          <Select value={sortBy} onValueChange={(value) => setSortBy(value as SortOption)}>
            <SelectTrigger className="w-full lg:w-[200px]">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="closing-soon">Closing Soon</SelectItem>
              <SelectItem value="closing-latest">Closing Latest</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
            <SelectTrigger className="w-full lg:w-[160px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="open">Open</SelectItem>
              <SelectItem value="urgent">Urgent</SelectItem>
              <SelectItem value="closed">Closed</SelectItem>
            </SelectContent>
          </Select>

          {/* EMD Filter */}
          <Select value={emdFilter} onValueChange={(value) => setEMDFilter(value as EMDFilter)}>
            <SelectTrigger className="w-full lg:w-[180px]">
              <SelectValue placeholder="EMD" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All EMD</SelectItem>
              <SelectItem value="required">EMD Required</SelectItem>
              <SelectItem value="not-required">No EMD</SelectItem>
            </SelectContent>
          </Select>

          {/* Clear Filters */}
          {hasActiveFilters && (
            <Button variant="outline" onClick={clearFilters} className="w-full lg:w-auto">
              <X className="h-4 w-4 mr-2" />
              Clear
            </Button>
          )}
        </div>

        {/* Results Count */}
        <div className="text-sm text-gray-500">
          Showing {filteredAndSortedTenders.length} of {tenders.length} tenders
        </div>
      </div>

      {/* Tenders Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mt-28">
        {filteredAndSortedTenders.map((tender) => {
          const status = getTenderStatus(tender);
          return (
            <Card key={tender.id} className="hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex justify-between items-start gap-2">
                  <CardTitle className="text-lg">{tender.bid_number}</CardTitle>
                  {status === 'closed' ? (
                    <Badge variant="destructive">Closed</Badge>
                  ) : status === 'urgent' ? (
                    <Badge variant="warning">Urgent</Badge>
                  ) : (
                    <Badge variant="success">Open</Badge>
                  )}
                </div>
                <p className="text-sm text-gray-600 mt-2 line-clamp-2">
                  {tender.item_category_parsed || 'Category not available'}
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-gray-500">Ministry</p>
                  <p className="font-medium text-sm">{tender.ministry || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Organization</p>
                  <p className="font-medium text-sm line-clamp-1">
                    {tender.organization_name_parsed || 'N/A'}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-gray-500">End Date</p>
                    <p className="font-medium text-sm">{formatDate(tender.bid_end_datetime)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-gray-500">Quantity</p>
                    <p className="font-medium text-sm">{tender.total_quantity_parsed || 'N/A'}</p>
                  </div>
                </div>
                <div>
                  <p className="text-xs text-gray-500">EMD Amount</p>
                  <p className="font-medium text-sm">{formatCurrency(tender.emd_amount_parsed)}</p>
                </div>

                {/* View Details Button */}
                <Link href={`/tenders/${tender.id}`}>
                  <Button className="w-full mt-4 bg-green-600 hover:bg-green-700 text-white">
                    View Tender Details
                  </Button>
                </Link>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* No Results Message */}
      {filteredAndSortedTenders.length === 0 && (
        <div className="text-center py-12">
          <p className="text-gray-500 text-lg">No tenders found</p>
          {hasActiveFilters && (
            <p className="text-gray-400 text-sm mt-2">
              Try adjusting your filters or search query
            </p>
          )}
        </div>
      )}
    </div>
  );
}
