// services/tenderStore.client.ts
// Client-only tender store: local shortlist, optimistic toggles, and client-side queries.

import { createClient } from '@/lib/supabase-client';
import type { Tender } from '@/types';

/**
 * getSupabase()
 * - Lazily create and return a browser-only Supabase client singleton.
 * - Throws if called on the server to avoid SSR misuse.
 */
function getSupabase() {
  if (typeof window === 'undefined') {
    throw new Error('getSupabase() called on the server — this module is client-only. Only call from browser code.');
  }
  // store the singleton on window so it's shared across module imports/hmr
  const win = window as any;
  if (!win.__tenderflow_supabase_client) {
    win.__tenderflow_supabase_client = createClient(
      // keep using env keys from your lib; createClient will read them.
    );
  }
  return win.__tenderflow_supabase_client;
}

type GetTendersParams = {
  page: number;
  limit: number;
  search?: string;
  statusFilter?: 'all' | 'open' | 'urgent' | 'closed' | 'closing-soon' | 'shortlisted';
  emdFilter?: 'all' | 'yes' | 'no';
  reverseAuction?: 'all' | 'yes' | 'no';
  sortBy?: 'newest' | 'oldest' | 'closing-soon' | 'closing-latest';
  recommendationsOnly?: boolean;
  source?: 'gem' | 'all';
};

class TenderClientStore {
  private shortlistedIds: Set<string> = new Set();
  private storageKey = 'tenderflow_shortlist';
  private _isShortlistCooldown = false;
  public  isShortlistCooldown = false;
  private _shortlistCooldownMs = 700;

  private startShortlistCooldown() {
    this._isShortlistCooldown = true;
    this.isShortlistCooldown = true;

    setTimeout(() => {
      this._isShortlistCooldown = false;
      this.isShortlistCooldown = false;
    }, this._shortlistCooldownMs);

  constructor() {
    // Load from localStorage (client-only)
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) this.shortlistedIds = new Set(arr.map(String));
        }
      } catch (e) {
        // ignore parse errors
        this.shortlistedIds = new Set();
      }
    }
  }

  private saveLocal() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(Array.from(this.shortlistedIds)));
    } catch {
      // ignore storage errors
    }
  }

  isShortlisted(id?: string | number | null) {
    if (!id) return false;
    return this.shortlistedIds.has(String(id));
  }

  getAllLocalShortlist(): string[] {
    return Array.from(this.shortlistedIds);
  }

  /**
   * Toggle shortlist locally and persist to server if possible.
   * Returns { persisted: boolean, reason?: string }
   */
  async toggleShortlist(id: string | number): Promise<{ persisted: boolean; reason?: string }> {
    this.startShortlistCooldown();
    const sid = String(id);
    const wasPresent = this.shortlistedIds.has(sid);

    // optimistic local flip
    if (wasPresent) this.shortlistedIds.delete(sid);
    else this.shortlistedIds.add(sid);
    this.saveLocal();

    try {
      // Check auth (call browser supabase at runtime)
      const supabase = getSupabase();
      const userResp = await supabase.auth.getUser();
      const user = userResp?.data?.user;
      if (!user || !user.id) {
        // unauthenticated — keep local only
        return { persisted: false, reason: 'unauthenticated' };
      }

      const numericId = Number(id);

      if (!wasPresent) {
        // we added locally -> insert on server
        const { error } = await supabase
          .from('user_shortlists')
          .insert({ user_id: user.id, tender_id: numericId })
          .maybeSingle();
        if (error) {
          // rollback
          this.shortlistedIds.delete(sid);
          this.saveLocal();
          // ignore unique violation
          const code = (error as any)?.code ?? (error as any)?.status;
          if (code === '23505') return { persisted: true }; // duplicate — treat as success
          return { persisted: false, reason: 'server-error-add' };
        }
        return { persisted: true };
      } else {
        // we removed locally -> delete on server
        const { error } = await supabase
          .from('user_shortlists')
          .delete()
          .eq('user_id', user.id)
          .eq('tender_id', numericId);
        if (error) {
          // rollback
          this.shortlistedIds.add(sid);
          this.saveLocal();
          return { persisted: false, reason: 'server-error-remove' };
        }
        return { persisted: true };
      }
    } catch (err) {
      console.error('toggleShortlist unexpected error', err);
      // rollback conservative: if we attempted to add then remove locally
      // but the safest approach is to leave local state as-is and let user retry.
      return { persisted: false, reason: 'unexpected' };
    }
  }

  /**
   * Get tenders (client-side). Returns { data: Tender[], total: number }.
   * This mirrors the server query but runs in the browser and uses the browser supabase client.
   */
  async getTenders(params: GetTendersParams): Promise<{ data: Tender[]; total: number }> {
    try {
      // Obtain browser supabase at runtime (avoid calling createClient on server)
      const supabase = getSupabase();
      const nowIso = new Date().toISOString();

      // recommendationsOnly: use RPC if available (requires auth)
      if (params.recommendationsOnly) {
        try {
          const userResp = await supabase.auth.getUser();
          const user = userResp?.data?.user;
          if (!user || !user.id) return { data: [], total: 0 };

          const from = (params.page - 1) * params.limit;
          const { data: rpcRows, error: rpcErr } = await supabase.rpc('get_recommended_tenders_with_count', {
            p_user: user.id,
            p_limit: params.limit,
            p_offset: from,
          });

          if (rpcErr || !rpcRows) return { data: [], total: 0 };

          let total = 0;
          if (Array.isArray(rpcRows) && rpcRows.length > 0) {
            total = Number((rpcRows[0] as any).total_count) || 0;
          } else if (rpcRows && typeof rpcRows === 'object' && 'total_count' in rpcRows) {
            total = Number((rpcRows as any).total_count) || 0;
          }

          const rows = (rpcRows as any[]).map((r: any) => {
            const { total_count, ...t } = r;
            return this.mapRowToTender(t);
          });

          return { data: rows, total };
        } catch (err) {
          console.error('getTenders (recommendationsOnly) error', err);
          return { data: [], total: 0 };
        }
      }

      // Standard query
      let query: any = supabase.from('tenders').select('*', { count: 'exact' });

      // Search handling: build conservative OR over known text columns
      if (params.search && params.search.trim()) {
        const term = params.search.trim();
        const like = `%${term}%`;

        // Conservative fallback whitelist (same set used elsewhere)
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

        const validColRegex = /^[a-z0-9_]+$/;
        const sanitizedCols = fallbackCols.filter(c => validColRegex.test(c));
        const orClauses = sanitizedCols.map(col => `${col}.ilike.${like}`);

        if (orClauses.length > 0) {
          try {
            query = query.or(orClauses.join(','));
          } catch (e) {
            console.warn('Skipping client search .or() due to supabase error', e);
          }
        }
      }

      // Status filters
      if (params.statusFilter === 'closed') {
        query = query.lt('bid_end_datetime', nowIso);
      } else if (params.statusFilter === 'open') {
        query = query.or(`bid_end_datetime.gte.${nowIso},bid_end_datetime.is.null`);
      } else if (params.statusFilter === 'urgent' || params.statusFilter === 'closing-soon') {
        const nextWeek = new Date();
        nextWeek.setDate(nextWeek.getDate() + 7);
        query = query.gte('bid_end_datetime', nowIso).lte('bid_end_datetime', nextWeek.toISOString());
      } else if (params.statusFilter === 'shortlisted') {
        // If the client wants shortlisted, use local shortlist to filter if possible (faster)
        // If user is authenticated you might prefer server RPC; for now use local shortlist as a fallback.
        const ids = this.getAllLocalShortlist();
        if (ids.length === 0) return { data: [], total: 0 };
        query = query.in('id', ids);
      }

      // EMD filter
      if (params.emdFilter === 'yes') query = query.gt('emd_amount', 0);
      else if (params.emdFilter === 'no') query = query.or('emd_amount.is.null,emd_amount.eq.0');

      // Reverse auction
      if (params.reverseAuction === 'yes') query = query.eq('reverse_auction_enabled', true);
      else if (params.reverseAuction === 'no') query = query.eq('reverse_auction_enabled', false);

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
        console.error('getTenders client query error:', error);
        return { data: [], total: 0 };
      }

      // Map rows -> normalized UI Tender objects
      const mapped = (data || []).map((r: any) => this.mapRowToTender(r));
      return { data: mapped, total: count || 0 };
    } catch (err) {
      console.error('getTenders unexpected error:', err);
      return { data: [], total: 0 };
    }
  }

  /**
   * Normalize a raw DB row into the UI Tender shape expected by the pages.
   * This function is intentionally tolerant of several common column-name variants.
   */
  private mapRowToTender(row: any): Tender {
    // small helpers
    const parseDate = (v: any) => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const getFirst = (...keys: any[]) => {
      for (const k of keys) {
        if (k == null) continue;
        if (typeof k === 'string' && row != null && row[k] != null) return row[k];
      }
      return undefined;
    };

    const rowId = row?.id != null ? String(row.id) : undefined;

    // bidNumber: prefer bid_number, then gem_bid_id, then other common names
    const bidNumber = getFirst('bid_number', 'gem_bid_id', 'bid_no', 'tender_number', 'tender_id') ?? null;

    // --- Robust date handling (preserve DB wall-clock time) ---
    // We keep raw strings for debugging, but also create Date objects deterministically.

    const startCandidates = ['start_datetime', 'start_date', 'bid_date', 'published_at', 'created_at'];
    let publishedDateRaw: string | null = null;
    for (const k of startCandidates) {
    const v = row?.[k];
    if (v != null && String(v).trim() !== '') {
        publishedDateRaw = String(v);
        break;
    }
    }
    if (!publishedDateRaw) publishedDateRaw = row?.bid_date || row?.created_at || null;

    const endCandidates = ['bid_end_datetime', 'end_datetime', 'end_date', 'bid_end_date', 'closing_datetime'];
    let deadlineRaw: string | null = null;
    for (const k of endCandidates) {
    const v = row?.[k];
    if (v != null && String(v).trim() !== '') {
        deadlineRaw = String(v);
        break;
    }
    }

    // Helper: parse DB timestamps WITHOUT shifting timezones
    const parseToLocalDate = (raw?: string | null): Date | null => {
    if (!raw) return null;
    const s = String(raw).trim();

    // If timezone info exists, rely on native parser.
    if (/[zZ]|[+-]\d{2}:\d{2}$/.test(s)) {
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    // Parse naive timestamp YYYY-MM-DD HH:MM[:SS]
    const m = s.match(
        /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/
    );
    if (m) {
        const [, Y, M, D, hh, mm, ss] = m;
        const d = new Date(
        Number(Y),
        Number(M) - 1,
        Number(D),
        Number(hh),
        Number(mm),
        ss ? Number(ss) : 0
        );
        return Number.isNaN(d.getTime()) ? null : d;
    }

    // Fallback
    const fallback = new Date(s);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
    };

    const publishedDateObj = parseToLocalDate(publishedDateRaw);
    const deadlineObj = parseToLocalDate(deadlineRaw);

    // Expose both raw and parsed
    const publishedDate = publishedDateRaw;
    const deadline = deadlineObj;


    // emdAmount: try multiple column names, strip non-digits and coerce to number
    const emdCandidates = ['emd_amount', 'emd', 'emd_amount_parsed', 'emd_value'];
    let emdAmount = 0;
    for (const k of emdCandidates) {
      const v = row?.[k];
      if (v == null || v === '') continue;
      if (typeof v === 'number') {
        emdAmount = v;
        break;
      }
      const numeric = Number(String(v).replace(/[^0-9.-]/g, ''));
      if (!Number.isNaN(numeric)) {
        emdAmount = numeric;
        break;
      }
    }

    // quantity: accept several possible fields
    const quantity = (row?.quantity ?? row?.total_quantity ?? row?.qty ?? row?.totalQty) ?? undefined;

    // basic status derivation
    let status = 'OPEN' as any;
    try {
      const endDateObj = deadline ? parseDate(deadline) : null;
      if (endDateObj && endDateObj < new Date()) status = 'CLOSED';
    } catch { /* ignore */ }

    // build normalized Tender object
    const mapped: any = {
      id: rowId,
      bidNumber: bidNumber ?? undefined,
      item: row?.item || row?.item_title || row?.b_category_name || row?.item_category || null,
      authority: row?.organization_name || row?.authority || null,
      ministry: row?.buyer_ministry || row?.ministry || null,
      department: row?.buyer_department || row?.department || null,
      budget: row?.estimated_value ?? row?.estimated_bid_value ?? null,
      emdAmount: emdAmount,
      deadline: deadline,
      status: status,
      category: row?.item_category || row?.b_category_name || null,
      location: `${row?.city || ''} ${row?.state || ''}`.trim() || row?.pincode || null,
      pincode: row?.pincode ?? null,
      publishedDate: publishedDate,
      sourceUrl: row?.detail_url || row?.source_url || null,
      capturedAt: row?.captured_at || null,
      isEnriched: !!row?.documents_extracted,
      pdfStoragePath: row?.pdf_storage_path || row?.pdf_path || null,
      pdfPublicUrl: row?.pdf_public_url || null,
      quantity: quantity != null ? String(quantity) : undefined,
      isShortlisted: rowId ? this.shortlistedIds.has(rowId) : false,
      boqItems: row?.boq_items || [],
      pageCount: row?.page_count ?? null,
      reverseAuctionEnabled: !!row?.reverse_auction_enabled,
      // include any raw fields that page might still use
      raw: row
    };

    return mapped as Tender;
  }
}

export const tenderClientStore = new TenderClientStore();
export default tenderClientStore;
