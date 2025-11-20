// services/tenderStore.ts
import { createClient } from '../lib/supabase-client';
import { Tender, TenderStatus } from '../types';

const supabase = createClient();

class TenderStore {
  private shortlistedIds: Set<string> = new Set();

  constructor() {
    // Attempt to load shortlist from localStorage (silent failure on server / SSR)
    try {
      if (typeof window !== 'undefined') {
        this.loadShortlist();
      }
    } catch (e) {
      console.error('Error initializing TenderStore shortlist:', e);
    }
  }

  private loadShortlist() {
    try {
      const stored = localStorage.getItem('tenderflow_shortlist');
      if (stored) {
        this.shortlistedIds = new Set(JSON.parse(stored));
      }
    } catch (e) {
      console.error('Failed to load shortlist', e);
      this.shortlistedIds = new Set();
    }
  }

  private saveShortlist() {
    try {
      localStorage.setItem('tenderflow_shortlist', JSON.stringify(Array.from(this.shortlistedIds)));
    } catch (e) {
      console.error('Failed to save shortlist', e);
    }
  }

  /**
   * Toggle shortlist locally. Kept async so callers can await and handle rollback flows if needed.
   * Currently only persists to localStorage (client-side).
   */
  async toggleShortlist(id: string): Promise<void> {
    try {
      if (!id) return;
      if (this.shortlistedIds.has(id)) {
        this.shortlistedIds.delete(id);
      } else {
        this.shortlistedIds.add(id);
      }
      this.saveShortlist();
      return;
    } catch (e) {
      console.error('toggleShortlist failed', e);
      throw e;
    }
  }

  isShortlisted(id: string): boolean {
    return this.shortlistedIds.has(id);
  }

  /**
   * (Optional) Fetch recommended tender ids for the current user from the recommendations table.
   * This keeps the old behavior if you want to call it directly.
   */
  async getRecommendedTenderIds(): Promise<number[]> {
    try {
      const userResp = await supabase.auth.getUser();
      const user = userResp?.data?.user;
      if (!user || !user.id) return [];

      const { data, error } = await supabase
        .from('recommendations')
        .select('tender_id')
        .eq('user_id', user.id);

      if (error) {
        console.error('Error fetching recommendations (ids):', error);
        return [];
      }

      return (data || [])
        .map((r: any) => {
          // preserve numeric type if tender_id is numeric; otherwise return as-is
          const n = Number((r as any).tender_id);
          return Number.isNaN(n) ? (r as any).tender_id : n;
        })
        .filter((v: any) => v !== undefined && v !== null);
    } catch (err) {
      console.error('getRecommendedTenderIds error:', err);
      return [];
    }
  }

  // Map DB row to UI Tender model
  private mapRowToTender(row: any): Tender {
    const now = new Date();
    const endDate = row?.bid_end_datetime ? new Date(row.bid_end_datetime) : null;
    let status = TenderStatus.OPEN;
    if (endDate && endDate < now) status = TenderStatus.CLOSED;

    return {
      id: row?.id != null ? String(row.id) : undefined,
      bidNumber: row?.bid_number || row?.gem_bid_id,
      title: row?.title || row?.b_category_name || 'Untitled Tender',
      authority: row?.organisation_name || 'GeM Portal',
      ministry: row?.buyer_ministry || row?.ministry,
      department: row?.buyer_department || row?.department,
      description: row?.product_description || row?.title || 'No description available',
      budget: row?.estimated_value ? `₹ ${row.estimated_value}` : 'Refer to Doc',
      emdAmount: row?.emd_amount_parsed != null
        ? (typeof row.emd_amount_parsed === 'number' ? row.emd_amount_parsed : parseFloat(row.emd_amount_parsed))
        : (row?.emd_amount ? parseFloat(row.emd_amount) : 0),
      deadline: row?.bid_end_datetime || row?.final_end_date || new Date().toISOString(),
      status,
      category: row?.item_category_parsed || row?.b_category_name || 'Goods',
      location: `${row?.city || ''} ${row?.state || ''}`.trim() || row?.pincode || 'India',
      city: row?.city,
      state: row?.state,
      pincode: row?.pincode,
      publishedDate: row?.bid_date || row?.created_at,
      sourceUrl: row?.detail_url || row?.source_url,
      capturedAt: row?.captured_at,
      isEnriched: !!row?.documents_extracted,
      pdfPath: row?.pdf_path,
      pdfStoragePath: row?.pdf_storage_path,
      pdfPublicUrl: row?.pdf_public_url,
      quantity: row?.total_quantity?.toString() || row?.total_quantity_parsed?.toString(),
      isShortlisted: this.shortlistedIds.has(row?.id?.toString ? row.id.toString() : String(row?.id)),
      boqItems: row?.boq_items || []
    } as Tender;
  }

  /**
   * Main listing method used by the UI.
   * Supports search, statusFilter, emdFilter, sortBy, pagination, and recommendationsOnly (via RPC).
   */
  async getTenders(params: {
    page: number;
    limit: number;
    search?: string;
    statusFilter?: 'all' | 'open' | 'urgent' | 'closed' | 'closing-soon' | 'shortlisted';
    emdFilter?: 'all' | 'yes' | 'no';
    sortBy?: 'newest' | 'oldest' | 'closing-soon' | 'closing-latest';
    recommendationsOnly?: boolean;
    source?: 'gem' | 'all';
  }): Promise<{ data: Tender[]; total: number; totalPages: number }> {
    try {
      // If recommendationsOnly: use server-side RPC to fetch paged recommended tenders + count
      // --- inside getTenders, replace the recommendationsOnly block with this ---
        if (params.recommendationsOnly) {
        try {
            const userResp = await supabase.auth.getUser();
            const user = userResp?.data?.user;
            if (!user || !user.id) {
            // not authenticated -> return empty
            return { data: [], total: 0, totalPages: 0 };
            }

            const from = (params.page - 1) * params.limit;

            const { data: rpcRows, error: rpcErr } = await supabase
            .rpc('get_recommended_tenders_with_count', {
                p_user: user.id,
                p_limit: params.limit,
                p_offset: from,
            });

            if (rpcErr) {
            console.error('RPC get_recommended_tenders_with_count error:', rpcErr);
            return { data: [], total: 0, totalPages: 0 };
            }

            // rpcRows may be null or [] when no recommendations
            if (!rpcRows || (Array.isArray(rpcRows) && rpcRows.length === 0)) {
            return { data: [], total: 0, totalPages: 0 };
            }

            // Normalize total_count: it should exist on the first row
            let total = 0;
            if (Array.isArray(rpcRows) && rpcRows.length > 0) {
            const first = rpcRows[0] as any;
            total = Number(first.total_count) || 0;
            } else if (rpcRows && typeof rpcRows === 'object' && 'total_count' in rpcRows) {
            total = Number((rpcRows as any).total_count) || 0;
            }

            // Remove the extra total_count property and map rows to Tender model
            const rows = (rpcRows as any[]).map(r => {
            // create a shallow copy without total_count to feed mapRowToTender
            const { total_count, ...tenderRow } = r;
            return this.mapRowToTender(tenderRow);
            });

            const totalPages = Math.ceil((total || 0) / params.limit);
            return { data: rows, total, totalPages };
        } catch (err) {
            console.error('Error fetching recommended tenders via combined RPC:', err);
            return { data: [], total: 0, totalPages: 0 };
        }
        }


      // Build a Supabase query for tenders
      let query = supabase.from('tenders').select('*', { count: 'exact' });

      // 1) Search
      if (params.search && params.search.trim()) {
        const term = params.search.trim();
        // Keep it simple: match title, gem_bid_id, item_category_parsed
        query = query.or(`title.ilike.%${term}%,gem_bid_id.ilike.%${term}%,item_category_parsed.ilike.%${term}%`);
      }

      // 2) Status filter
      const now = new Date().toISOString();
      if (params.statusFilter === 'shortlisted') {
        const ids = Array.from(this.shortlistedIds).map(id => {
          const n = Number(id);
          return Number.isNaN(n) ? id : n;
        });
        if (ids.length === 0) {
          return { data: [], total: 0, totalPages: 0 };
        }
        query = query.in('id', ids);
      } else if (params.statusFilter === 'closed') {
        query = query.lt('bid_end_datetime', now);
      } else if (params.statusFilter === 'open') {
        query = query.or(`bid_end_datetime.gte.${now},bid_end_datetime.is.null`);
      } else if (params.statusFilter === 'urgent' || params.statusFilter === 'closing-soon') {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        query = query.gte('bid_end_datetime', now).lte('bid_end_datetime', nextWeek.toISOString());
      }

      // 3) EMD filter
      if (params.emdFilter === 'yes') {
        query = query.gt('emd_amount_parsed', 0);
      } else if (params.emdFilter === 'no') {
        query = query.or('emd_amount_parsed.is.null,emd_amount_parsed.eq.0');
      }

      // 4) Sorting
      if (params.sortBy === 'closing-soon') {
        query = query.order('bid_end_datetime', { ascending: true, nullsFirst: false });
      } else if (params.sortBy === 'closing-latest') {
        query = query.order('bid_end_datetime', { ascending: false, nullsFirst: false });
      } else if (params.sortBy === 'oldest') {
        query = query.order('bid_date', { ascending: true });
      } else {
        query = query.order('bid_date', { ascending: false });
      }

      // 5) Pagination
      const from = (params.page - 1) * params.limit;
      const to = from + params.limit - 1;

      const { data, error, count } = await query.range(from, to);

      if (error) {
        console.error('Supabase Error details:', JSON.stringify(error, null, 2));
        throw new Error(`Supabase Error: ${error.message} (${error.code})`);
      }

      const mappedData = (data || []).map((row: any) => this.mapRowToTender(row));
      return {
        data: mappedData,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / params.limit)
      };
    } catch (err) {
      console.error('getTenders unexpected error:', err);
      return { data: [], total: 0, totalPages: 0 };
    }
  }

  async getTenderById(id: string): Promise<Tender | undefined> {
    try {
      const { data, error } = await supabase
        .from('tenders')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching tender by ID:', JSON.stringify(error, null, 2));
        return undefined;
      }
      if (!data) return undefined;
      return this.mapRowToTender(data);
    } catch (err) {
      console.error('getTenderById unexpected error:', err);
      return undefined;
    }
  }

  async getStats() {
    try {
      const { count: total } = await supabase.from('tenders').select('*', { count: 'exact', head: true });
      const now = new Date().toISOString();
      const { count: active } = await supabase.from('tenders').select('*', { count: 'exact', head: true }).gte('bid_end_datetime', now);

      return {
        total: total || 0,
        active: active || 0,
        gemCount: total || 0
      };
    } catch (e) {
      console.error('Error fetching stats:', e);
      return { total: 0, active: 0, gemCount: 0 };
    }
  }

  async updateTender(id: string, updates: Partial<Tender>) {
    try {
      const dbUpdates: any = {};
      if (updates.description) dbUpdates.product_description = updates.description;
      if (updates.isEnriched !== undefined) dbUpdates.documents_extracted = updates.isEnriched;

      if (Object.keys(dbUpdates).length === 0) return;

      const { error } = await supabase.from('tenders').update(dbUpdates).eq('id', id);
      if (error) console.error('Error updating tender:', error);
    } catch (err) {
      console.error('updateTender unexpected error:', err);
    }
  }

  async syncWithGeM() {
    // Stub: your existing sync flow goes here. Keep this as a stub to avoid accidental heavy ops.
    console.log('Sync triggered.');
    return { added: 0 };
  }
}

export const tenderStore = new TenderStore();
