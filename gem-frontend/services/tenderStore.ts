'use client';

import { createClient } from '../lib/supabase-client';
import { Tender, TenderStatus } from '../types';

const supabase = createClient();

class TenderStore {
  // Local cache of shortlisted IDs (string form). Used for quick UI reads.
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

  /*******************************
   * LocalStorage helpers
   *******************************/
  private loadShortlist() {
    try {
      const stored = localStorage.getItem('tenderflow_shortlist');
      if (stored) {
        this.shortlistedIds = new Set(JSON.parse(stored));
      } else {
        this.shortlistedIds = new Set();
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

  /*******************************
   * Server-backed shortlist APIs
   *******************************/

  // Insert a shortlist record server-side (throws on error)
  async addShortlistServer(userId: string, tenderId: number | string) {
    const payload = { user_id: userId, tender_id: Number(tenderId) };
    const { error } = await supabase.from('user_shortlists').insert(payload).maybeSingle();
    if (error) {
      // ignore unique violation (already present)
      if ((error as any)?.code === '23505') return;
      throw error;
    }
  }

  // Remove a shortlist server-side (throws on error)
  async removeShortlistServer(userId: string, tenderId: number | string) {
    const { error } = await supabase
      .from('user_shortlists')
      .delete()
      .eq('user_id', userId)
      .eq('tender_id', Number(tenderId));
    if (error) throw error;
  }

  // Fetch shortlist tender ids for the authenticated user from server
  async getShortlistedTenderIdsForUser(): Promise<number[]> {
    try {
      const userResp = await supabase.auth.getUser();
      const user = userResp?.data?.user;
      if (!user || !user.id) return [];

      const { data, error } = await supabase
        .from('user_shortlists')
        .select('tender_id')
        .eq('user_id', user.id);

      if (error) {
        console.error('getShortlistedTenderIdsForUser error:', error);
        return [];
      }
      return (data || []).map((r: any) => Number(r.tender_id));
    } catch (err) {
      console.error('getShortlistedTenderIdsForUser unexpected error:', err);
      return [];
    }
  }

  // Sync local shortlistedIds with server (fetch user's shortlist and cache locally)
  // Call this after login or when you want to refresh the local cache
  async syncShortlistFromServer(): Promise<void> {
    try {
      const ids = await this.getShortlistedTenderIdsForUser();
      this.shortlistedIds = new Set(ids.map(String));
      this.saveShortlist();
    } catch (err) {
      console.error('syncShortlistFromServer error:', err);
    }
  }

  /**
   * Toggle shortlist locally AND attempt to persist to server if authenticated.
   * Returns a result object: { persisted: boolean, reason?: string }
   */
  async toggleShortlist(id: string): Promise<{ persisted: boolean; reason?: string }> {
    if (!id) return { persisted: false, reason: 'invalid-id' };

    // optimistic local flip
    try {
      if (this.shortlistedIds.has(id)) {
        this.shortlistedIds.delete(id);
      } else {
        this.shortlistedIds.add(id);
      }
      // persist local
      this.saveShortlist();
    } catch (e) {
      console.error('toggleShortlist local update failed', e);
      throw e;
    }

    // Try server-side persistence
    try {
      const userResp = await supabase.auth.getUser();
      const user = userResp?.data?.user;
      if (!user || !user.id) {
        // unauthenticated: local only
        return { persisted: false, reason: 'unauthenticated' };
      }

      const numericId = Number(id);

      if (this.shortlistedIds.has(id)) {
        // we just added it locally -> ensure server has it
        try {
          await this.addShortlistServer(user.id, numericId);
          return { persisted: true };
        } catch (err) {
          console.error('toggleShortlist addShortlistServer error:', err);
          // rollback local change to reflect server failure
          this.shortlistedIds.delete(id);
          this.saveShortlist();
          return { persisted: false, reason: 'server-error-add' };
        }
      } else {
        // we just removed it locally -> remove from server
        try {
          await this.removeShortlistServer(user.id, numericId);
          return { persisted: true };
        } catch (err) {
          console.error('toggleShortlist removeShortlistServer error:', err);
          // rollback local change back in case of server failure
          this.shortlistedIds.add(id);
          this.saveShortlist();
          return { persisted: false, reason: 'server-error-remove' };
        }
      }
    } catch (err) {
      console.error('toggleShortlist unexpected error:', err);
      return { persisted: false, reason: 'unexpected' };
    }
  }

  /*******************************
   * Recommendations helper (existing)
   *******************************/
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
          const n = Number(r.tender_id);
          return Number.isNaN(n) ? r.tender_id : n;
        })
        .filter((v: any) => v !== undefined && v !== null);
    } catch (err) {
      console.error('getRecommendedTenderIds error:', err);
      return [];
    }
  }

  /*******************************
   * Map DB row to UI Tender model
   *******************************/
  private mapRowToTender(row: any): Tender {
    const now = new Date();
    const endDate = row?.bid_end_datetime ? new Date(row.bid_end_datetime) : null;
    let status = TenderStatus.OPEN;
    if (endDate && endDate < now) status = TenderStatus.CLOSED;

    const rowId = row?.id != null ? String(row.id) : undefined;
    return {
      id: rowId,
      bidNumber: row?.bid_number || row?.gem_bid_id,
      title: row?.title || row?.b_category_name || 'Untitled Tender',
      // organisation_name → organization_name
      authority: row?.organization_name || 'GeM Portal',
      ministry: row?.buyer_ministry || row?.ministry,
      department: row?.buyer_department || row?.department,
      description: row?.product_description || row?.title || 'No description available',
      budget: row?.estimated_value ? `₹ ${row.estimated_value}` : 'Refer to Doc',
      // emd_amount_parsed → emd_amount (parsed as number if string)
      emdAmount: row?.emd_amount != null
        ? (typeof row.emd_amount === 'number' ? row.emd_amount : parseFloat(row.emd_amount))
        : 0,
      deadline: row?.bid_end_datetime || row?.final_end_date || new Date().toISOString(),
      status,
      // item_category → item_category
      category: row?.item_category || row?.b_category_name || 'Goods',
      // city/state are not DB columns, but leaving them doesn’t break anything if undefined
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
      // total_quantity_parsed → total_quantity
      quantity: row?.total_quantity?.toString(),
      isShortlisted: rowId ? this.shortlistedIds.has(rowId) : false,
      boqItems: row?.boq_items || []
    } as Tender;
  }

  /**
   * Main listing method used by the UI.
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
      // 1) recommendationsOnly branch (combined RPC)
      if (params.recommendationsOnly) {
        try {
          const userResp = await supabase.auth.getUser();
          const user = userResp?.data?.user;
          if (!user || !user.id) {
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

          if (!rpcRows || (Array.isArray(rpcRows) && rpcRows.length === 0)) {
            return { data: [], total: 0, totalPages: 0 };
          }

          let total = 0;
          if (Array.isArray(rpcRows) && rpcRows.length > 0) {
            const first = rpcRows[0] as any;
            total = Number(first.total_count) || 0;
          } else if (rpcRows && typeof rpcRows === 'object' && 'total_count' in rpcRows) {
            total = Number((rpcRows as any).total_count) || 0;
          }

          const rows = (rpcRows as any[]).map(r => {
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

      const nowIso = new Date().toISOString();

      // 2) statusFilter === 'shortlisted' (server-backed JSON RPC)
      if (params.statusFilter === 'shortlisted') {
        try {
          const userResp = await supabase.auth.getUser();
          const user = userResp?.data?.user;
          if (!user || !user.id) {
            return { data: [], total: 0, totalPages: 0 };
          }

          const from = (params.page - 1) * params.limit;

          const { data: rpcData, error: rpcErr } = await supabase.rpc('get_shortlisted_tenders_json', {
            p_user: user.id,
            p_limit: params.limit,
            p_offset: from,
          });

          if (rpcErr) {
            console.error('get_shortlisted_tenders_json error:', rpcErr);
            return { data: [], total: 0, totalPages: 0 };
          }

          // Normalize supabase rpc response shapes
          let payload: any = null;
          if (!rpcData) {
            payload = null;
          } else if (Array.isArray(rpcData) && rpcData.length > 0 && typeof rpcData[0] === 'object' && Object.keys(rpcData[0]).length === 1) {
            const val = rpcData[0];
            const key = Object.keys(val)[0];
            payload = (val as any)[key];
          } else {
            payload = rpcData as any;
          }

          if (!payload) return { data: [], total: 0, totalPages: 0 };

          const total = Number(payload.total || 0);
          const rows = Array.isArray(payload.rows) ? payload.rows : [];

          // Update local shortlist cache with returned row ids (optional)
          try {
            const idsFromServer = rows.map((r: any) => String(r.id));
            idsFromServer.forEach((x: string) => this.shortlistedIds.add(x));
            this.saveShortlist();
          } catch (e) {
            console.warn('Failed to merge shortlist ids from server into local cache', e);
          }

          const mapped = rows.map((r: any) => this.mapRowToTender(r));
          const totalPages = Math.ceil((total || 0) / params.limit);
          return { data: mapped, total, totalPages };
        } catch (err) {
          console.error('Error fetching server-side shortlisted tenders:', err);
          return { data: [], total: 0, totalPages: 0 };
        }
      }

      // 3) Standard query
      let query: any = supabase.from('tenders').select('*', { count: 'exact' });

      // Search (updated to only use existing columns, but still broad)
      if (params.search && params.search.trim()) {
        const term = params.search.trim();
        const like = `%${term}%`;

        // IMPORTANT: only columns that actually exist in your schema
        query = query.or(
          [
            `title.ilike.${like}`,
            `gem_bid_id.ilike.${like}`,
            `bid_number.ilike.${like}`,
            `item_category.ilike.${like}`,
            `b_category_name.ilike.${like}`,
            `buyer_ministry.ilike.${like}`,
            `buyer_department.ilike.${like}`,
            `ministry.ilike.${like}`,
            `department.ilike.${like}`,
            `organization_name.ilike.${like}`,
            `organization_address.ilike.${like}`,
            `pincode.ilike.${like}`,
            `local_content_requirement.ilike.${like}`,
            `payment_terms.ilike.${like}`,
            `warranty_period.ilike.${like}`,
            `past_performance.ilike.${like}`,
            `detail_url.ilike.${like}`
          ].join(',')
        );
      }

      // Status filters (open/closed/urgent)
      if (params.statusFilter === 'closed') {
        query = query.lt('bid_end_datetime', nowIso);
      } else if (params.statusFilter === 'open') {
        query = query.or(`bid_end_datetime.gte.${nowIso},bid_end_datetime.is.null`);
      } else if (params.statusFilter === 'urgent' || params.statusFilter === 'closing-soon') {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        query = query
          .gte('bid_end_datetime', nowIso)
          .lte('bid_end_datetime', nextWeek.toISOString());
      }

      // EMD filter (emd_amount_parsed → emd_amount)
      if (params.emdFilter === 'yes') {
        query = query.gt('emd_amount', 0);
      } else if (params.emdFilter === 'no') {
        query = query.or('emd_amount.is.null,emd_amount.eq.0');
      }

      // Sorting
      if (params.sortBy === 'closing-soon') {
        query = query.order('bid_end_datetime', { ascending: true, nullsFirst: false });
      } else if (params.sortBy === 'closing-latest') {
        query = query.order('bid_end_datetime', { ascending: false, nullsFirst: false });
      } else if (params.sortBy === 'oldest') {
        query = query.order('bid_date', { ascending: true });
      } else {
        query = query.order('bid_date', { ascending: false });
      }

      // Pagination
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

  /*******************************
   * Utility methods
   *******************************/
  isShortlisted(id: string | undefined | null): boolean {
    if (!id) return false;
    return this.shortlistedIds.has(String(id));
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
      const { count: active } = await supabase
        .from('tenders')
        .select('*', { count: 'exact', head: true })
        .gte('bid_end_datetime', now);

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
