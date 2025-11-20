// services/tenderStore.ts
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
  async addShortlistServer(userId: string, tenderId: number | string) {
    const payload = { user_id: userId, tender_id: Number(tenderId) };
    const { error } = await supabase.from('user_shortlists').insert(payload).maybeSingle();
    if (error) {
      // ignore unique violation (already present)
      if ((error as any)?.code === '23505') return;
      throw error;
    }
  }

  async removeShortlistServer(userId: string, tenderId: number | string) {
    const { error } = await supabase
      .from('user_shortlists')
      .delete()
      .eq('user_id', userId)
      .eq('tender_id', Number(tenderId));
    if (error) throw error;
  }

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

  async syncShortlistFromServer(): Promise<void> {
    try {
      const ids = await this.getShortlistedTenderIdsForUser();
      this.shortlistedIds = new Set(ids.map(String));
      this.saveShortlist();
    } catch (err) {
      console.error('syncShortlistFromServer error:', err);
    }
  }

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
      isShortlisted: rowId ? this.shortlistedIds.has(rowId) : false,
      boqItems: row?.boq_items || []
    } as Tender;
  }

  /**
   * Main listing method used by the UI.
   * Supports search, statusFilter, emdFilter, sortBy, pagination, recommendationsOnly and server-backed shortlisted fetch.
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
      // 1) recommendationsOnly branch (existing combined RPC)
      if (params.recommendationsOnly) {
        try {
          const userResp = await supabase.auth.getUser();
          const user = userResp?.data?.user;
          if (!user || !user.id) {
            return { data: [], total: 0, totalPages: 0 };
          }

          const from = (params.page - 1) * params.limit;

          // NOTE: this assumes you already have a suitable RPC created for recommendations.
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

      // 2) If statusFilter === 'shortlisted' use server-backed JSON RPC (robust)
      const now = new Date().toISOString();
      if (params.statusFilter === 'shortlisted') {
        try {
          const userResp = await supabase.auth.getUser();
          const user = userResp?.data?.user;
          if (!user || !user.id) {
            return { data: [], total: 0, totalPages: 0 };
          }

          const from = (params.page - 1) * params.limit;

          // This RPC should return a json object: { total: <int>, rows: [ ... tender rows ... ] }
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
            // shape: [{ get_shortlisted_tenders_json: { total:..., rows: [...] } }]
            const val = rpcData[0];
            const key = Object.keys(val)[0];
            payload = (val as any)[key];
          } else {
            // shape likely: { total:..., rows: [...] }
            payload = rpcData as any;
          }

          if (!payload) return { data: [], total: 0, totalPages: 0 };

          const total = Number(payload.total || 0);
          const rows = Array.isArray(payload.rows) ? payload.rows : [];

          // Update local shortlist cache with returned row ids (optional, keeps local cache fresh)
          try {
            const idsFromServer = rows.map((r: any) => String(r.id));
            // merge server ids into local set (do not clear local completely because user may have local-only shortlists)
            idsFromServer.forEach((x: string) => this.shortlistedIds.add(x));
            this.saveShortlist();
          } catch (e) {
            // non-fatal
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

      // 3) Fallback: build standard supabase query for tenders
      let query: any = supabase.from('tenders').select('*', { count: 'exact' });

      /*****************************************************
       * SEARCH: broadened to match multiple text columns
       *
       * Matches (ILIKE %term%) against columns that exist in your schema:
       * - title (text)
       * - bid_number (text)
       * - gem_bid_id (text)
       * - item_category_parsed (text)
       * - b_category_name (text)
       * - organisation_name (text)
       * - organization_name_parsed (text)
       * - buyer_ministry (text)
       * - buyer_department (text)
       * - ministry (text)
       * - department (text)
       * - pincode (text)
       * - state (text)
       * - city (text)
       *
       * Note: We avoid numeric columns (e.g., total_quantity, estimated_value) to prevent type errors with ilike.
       *****************************************************/
      if (params.search && params.search.trim()) {
        const term = params.search.trim().replace(/[%_]/g, ''); // sanitize wildcard chars

        const orConditions = [
            `title.ilike.%${term}%`,
            `bid_number.ilike.%${term}%`,
            `gem_bid_id.ilike.%${term}%`,
            `item_category_parsed.ilike.%${term}%`,
            `b_category_name.ilike.%${term}%`,
            `organisation_name.ilike.%${term}%`,
            `organization_name_parsed.ilike.%${term}%`,
            `buyer_ministry.ilike.%${term}%`,
            `buyer_department.ilike.%${term}%`,
            `ministry.ilike.%${term}%`,
            `department.ilike.%${term}%`,
            `pincode.ilike.%${term}%`,
            `organization_address.ilike.%${term}%`
            ];


        query = query.or(orConditions.join(','));
      }

      // Status filters (open/closed/urgent)
      if (params.statusFilter === 'closed') {
        query = query.lt('bid_end_datetime', now);
      } else if (params.statusFilter === 'open') {
        query = query.or(`bid_end_datetime.gte.${now},bid_end_datetime.is.null`);
      } else if (params.statusFilter === 'urgent' || params.statusFilter === 'closing-soon') {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        query = query.gte('bid_end_datetime', now).lte('bid_end_datetime', nextWeek.toISOString());
      } else if (params.statusFilter === 'all' || !params.statusFilter) {
        // nothing
      } else {
        // handled earlier shortlisted branch
      }

      // EMD filter
      if (params.emdFilter === 'yes') {
        query = query.gt('emd_amount_parsed', 0);
      } else if (params.emdFilter === 'no') {
        query = query.or('emd_amount_parsed.is.null,emd_amount_parsed.eq.0');
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

/*
Optional DB performance suggestion (run in Supabase SQL editor if you want to speed up text searches):

-- Create trigram / GIN indexes on the richest text fields (optional & helpful)
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS trgm_tenders_title ON public.tenders USING gin (title gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS trgm_tenders_item_category_parsed ON public.tenders USING gin (item_category_parsed gin_trgm_ops);
-- CREATE INDEX IF NOT EXISTS trgm_tenders_organisation_name ON public.tenders USING gin (organisation_name gin_trgm_ops);

Rationale: these GIN trgm indexes make ILIKE '%term%' queries much faster for large tables.
*/
