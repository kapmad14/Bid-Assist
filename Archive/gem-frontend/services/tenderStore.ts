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

    // publishedDate: primary from start_datetime (date-only), then bid_date, then created_at
    // safer published date parsing (date-only YYYY-MM-DD) from start_datetime
    const publishedDateFromStart = row?.start_datetime
      ? (() => {
          const d = new Date(row.start_datetime);
          return Number.isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
        })()
      : null;

    // safer deadline handling: do NOT default to now — return null when missing
    const deadlineVal = row?.bid_end_datetime || row?.end_datetime || null;

    // safer emdAmount coercion
    const emdAmountVal = row?.emd_amount != null
      ? (typeof row.emd_amount === 'number' ? row.emd_amount : (Number.isNaN(Number(row.emd_amount)) ? 0 : Number(row.emd_amount)))
      : 0;

    // safe quantity coercion
    const quantityVal = row?.quantity != null ? String(row.quantity) : undefined;

    return {
      id: rowId,
      bidNumber: row?.bid_number || row?.gem_bid_id,
      item: row?.item || row?.b_category_name || 'Untitled Tender',
      authority: row?.organization_name || 'GeM Portal',
      ministry: row?.buyer_ministry || row?.ministry,
      department: row?.buyer_department || row?.department,
      //description: row?.product_description || row?.item || 'No description available',
      budget: row?.estimated_value ? `₹ ${row.estimated_value}` : 'Refer to Doc',
      emdAmount: emdAmountVal,
      deadline: deadlineVal,
      status,
      category: row?.item_category || row?.b_category_name || 'Goods',
      location: `${row?.city || ''} ${row?.state || ''}`.trim() || row?.pincode || 'India',
      //city: row?.city,
      //state: row?.state,
      pincode: row?.pincode,
      publishedDate: publishedDateFromStart || row?.bid_date || row?.created_at || null,
      sourceUrl: row?.detail_url || row?.source_url,
      capturedAt: row?.captured_at,
      isEnriched: !!row?.documents_extracted,
      //pdfPath: row?.pdf_path,
      pdfStoragePath: row?.pdf_storage_path || row?.pdf_path,
      pdfPublicUrl: row?.pdf_public_url,
      quantity: quantityVal,
      isShortlisted: rowId ? this.shortlistedIds.has(rowId) : false,
      boqItems: row?.boq_items || [],
      pageCount: row?.page_count ?? null,
      reverseAuctionEnabled: !!row?.reverse_auction_enabled
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
    reverseAuction?: 'all' | 'yes' | 'no'; // <--- NEW
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

      // Search — use a safe whitelist of known columns to avoid "column ... does not exist" errors
      // ---------- Replace existing search handling with this ----------
      if (params.search && params.search.trim()) {
        const term = params.search.trim();
        const like = `%${term}%`;

        // lightweight module-level cache on globalThis to avoid repeated info_schema queries
        if (typeof (globalThis as any)._cachedTextColumns === 'undefined') {
          (globalThis as any)._cachedTextColumns = null;
        }

        // populate cache once per process if empty
        if (!(globalThis as any)._cachedTextColumns) {
          try {
            const { data: cols, error: colsErr } = await supabase
              .from('information_schema.columns')
              .select('column_name,data_type')
              .eq('table_name', 'tenders');

            if (!colsErr && Array.isArray(cols)) {
              const textTypes = new Set(['character varying', 'varchar', 'text', 'character', 'tsvector']);
              const textCols = cols
                .filter((c: any) => c && c.column_name && textTypes.has((c.data_type || '').toLowerCase()))
                .map((c: any) => String(c.column_name));

              (globalThis as any)._cachedTextColumns = textCols.length > 0 ? textCols : null;
            } else {
              (globalThis as any)._cachedTextColumns = null;
            }
          } catch (e) {
            console.warn('Failed to fetch tenders text columns from information_schema; will use fallback whitelist.', e);
            (globalThis as any)._cachedTextColumns = null;
          }
        }

        // Conservative fallback whitelist (only columns that exist in your table)
        const fallbackCols = [
          'gem_bid_id',
          'detail_url',
          'pdf_storage_path',
          'pdf_sha256',
          'pdf_public_url',
          'bid_number',
          'item_category',
          'ministry',
          'department',
          'organization_name',
          'organization_type',
          'organization_address',
          'pincode',
          'bid_type',
          'extraction_status',
          'item_description',
          'consignee_address',
          'scrape_run_id',
          'item',
          'estimated_bid_value',
          'turnover_requirement',
          'oem_authorization_required',
          'warranty_terms',
          'payment_terms',
          'delivery_terms',
          'simple_extraction'
        ];

        // allowedCols = discovered text columns OR fallback if discovery failed
        const allowedCols: string[] = (globalThis as any)._cachedTextColumns && Array.isArray((globalThis as any)._cachedTextColumns) && (globalThis as any)._cachedTextColumns.length > 0
          ? (globalThis as any)._cachedTextColumns
          : fallbackCols;

        // Defensive sanitization: only allow simple lowercase underscore column names
        const validColRegex = /^[a-z0-9_]+$/;
        const sanitizedCols = allowedCols.filter((c) => typeof c === 'string' && validColRegex.test(c));

        try { console.debug('Tender search will use columns:', sanitizedCols); } catch (e) {}

        // Build .or() clauses only from sanitized columns
        const orClauses = sanitizedCols.map(col => `${col}.ilike.${like}`);

        if (orClauses.length > 0) {
          try {
            query = query.or(orClauses.join(','));
          } catch (e) {
            console.warn('Skipping search .or() due to invalid clauses or supabase error', e);
            // continue without search filter
          }
        } else {
          console.warn('No valid text columns found for tender search; skipping text search filter.');
        }
      }
      // ---------- End replacement ----------



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

      // Reverse auction filter
      if (params.reverseAuction === 'yes') {
        query = query.eq('reverse_auction_enabled', true);
      } else if (params.reverseAuction === 'no') {
        query = query.eq('reverse_auction_enabled', false);
      }
      // else 'all' or undefined -> no additional filter

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
        // Safely stringify objects (handles circular refs), but guard every step.
        const getCircularReplacer = () => {
          const seen = new WeakSet();
          return (key: string, value: any) => {
            if (typeof value === "object" && value !== null) {
              if (seen.has(value)) return "[Circular]";
              seen.add(value);
            }
            if (typeof value === "function" || typeof value === "symbol") return String(value);
            return value;
          };
        };

        // Defensive logging: never allow logging itself to throw.
        try {
          let safeStr: string | null = null;
          try {
            safeStr = JSON.stringify(error, getCircularReplacer(), 2);
          } catch (stringifyErr) {
            // If stringify fails, try a simple String() conversion
            try {
              safeStr = String(error);
            } catch {
              safeStr = null;
            }
          }

          if (safeStr) {
            try {
              // Use a single string argument to reduce console formatting surprises
              console.error(`Supabase Error details (safe): ${safeStr}`);
            } catch (consoleErr) {
              // swallow console errors — we don't want to break control flow
              try { console.log('Supabase Error (logged fallback)'); } catch {}
            }
          } else {
            try {
              // Last-resort: attempt to print selected safe fields
              const preview: any = {};
              try { preview.message = (error && error.message) ? error.message : undefined; } catch {}
              try { preview.code = (error && (error.code ?? error.status)) ? (error.code ?? error.status) : undefined; } catch {}
              try { preview.details = (error && error.details) ? error.details : undefined; } catch {}
              console.error('Supabase Error (preview):', preview);
            } catch {
              try { console.log('Supabase Error: <unserializable object>'); } catch {}
            }
          }
        } catch {
          // final no-op — absolutely no throws allowed from logging
        }

        // Defensive extraction for thrown message
        let errMsg = 'Unknown Supabase error';
        try {
          if (error && (error.message || error.msg || error.error)) {
            errMsg = error.message || error.msg || error.error;
          } else {
            errMsg = String(error);
          }
        } catch {
          // fallback unchanged
        }

        let errCode = 'no-code';
        try {
          if (error && (error.code ?? error.status)) {
            errCode = (error.code ?? error.status);
          }
        } catch {
          // ignore
        }

        throw new Error(`Supabase Error: ${errMsg} (${errCode})`);
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
        .or(`bid_end_datetime.gte.${now},bid_end_datetime.is.null`);


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
