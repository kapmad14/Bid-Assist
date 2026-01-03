// services/tenderStore.client.ts
import { createClient } from '@/lib/supabase-client';
import type { Tender } from '@/types';

/**
 * Client-side Supabase instance (singleton)
 */
let supabaseClient: any = null;

async function getSupabase() {
  if (typeof window === "undefined") throw new Error("client-only");

  if (supabaseClient) return supabaseClient;

  const mod = await import('@/lib/supabase-client');
  const win = window as any;
  win.__tenderflow_supabase_client ??= mod.createClient();
  supabaseClient = win.__tenderflow_supabase_client;
  return supabaseClient;
}



type GetTendersParams = {
  page: number;
  limit: number;
  search?: string;
  statusFilter?: 'all' | 'open' | 'urgent' | 'closed' | 'closing-soon' | 'shortlisted';
  emdFilter?: 'all' | 'yes' | 'no';
  reverseAuction?: 'all' | 'yes' | 'no';
  bidType?: 'all' | 'single' | 'two';
  evaluationType?: 'all' | 'item' | 'total';
  sortBy?: 'newest' | 'oldest' | 'closing-soon' | 'closing-latest';
  recommendationsOnly?: boolean;
  source?: 'gem' | 'all';
};

class TenderClientStore {
  private shortlistedIds = new Set<string>();
  private storageKey = 'tenderflow_shortlist';
  private _isSyncingShortlist = false;


  public isShortlistCooldown = false;

    startShortlistCooldown(ms = 700) {
        this.isShortlistCooldown = true;
        setTimeout(() => {
            this.isShortlistCooldown = false;
        }, ms);
    }



  constructor() {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(this.storageKey);
        if (raw) this.shortlistedIds = new Set(JSON.parse(raw).map(String));
      } catch {}
    }
  }

  private saveLocal() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify([...this.shortlistedIds]));
    } catch {}
  }

  isShortlisted(id?: string | number | null) {
    if (!id) return false;
    return this.shortlistedIds.has(String(id));
  }

  getAllLocalShortlist() {
    return [...this.shortlistedIds];
  }

  // ---------------------------------------------------------
  // SHORTLIST (Optimistic local + server sync)
  // ---------------------------------------------------------
  async toggleShortlist(id: string | number) {
    this.startShortlistCooldown();     // ← NEW: block “Shortlisted” tab temporarily
    this._isSyncingShortlist = true;   // ← START sync window


    const sid = String(id);
    const was = this.shortlistedIds.has(sid);


    // Optimistic update
    if (was) this.shortlistedIds.delete(sid);
    else this.shortlistedIds.add(sid);

    this.saveLocal();

    try {
      const supabase = await getSupabase();
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) return { persisted: false, reason: 'unauthenticated' };

      const numericId = Number(id);

      if (!was) {
        // add
        const { error } = await supabase
          .from('user_shortlists')
          .insert({ user_id: user.id, tender_id: numericId });

        if (error && (error as any)?.code !== '23505') {
          // rollback
          this.shortlistedIds.delete(sid);
          this.saveLocal();
          return { persisted: false, reason: 'server-error-add' };
        }
        return { persisted: true };
      } else {
        // remove
        const { error } = await supabase
          .from('user_shortlists')
          .delete()
          .eq('user_id', user.id)
          .eq('tender_id', numericId);

        if (error) {
          this.shortlistedIds.add(sid);
          this.saveLocal();
          return { persisted: false, reason: 'server-error-remove' };
        }
        return { persisted: true };
      }
    } catch (err) {
      console.error('toggleShortlist error', err);
      return { persisted: false, reason: 'unexpected' };
    } finally {
      this._isSyncingShortlist = false;   // ← REQUIRED FIX
      this.startShortlistCooldown(300);
    }
  }
  

  // ---------------------------------------------------------
  // GET TENDERS
  // ---------------------------------------------------------

  async loadServerShortlist() {
    try {
        const supabase = await getSupabase();
        const { data: auth } = await supabase.auth.getUser();
        const user = auth?.user;

        if (!user?.id) return;

        const { data, error } = await supabase
        .from('user_shortlists')
        .select('tender_id');

        if (!error && data) {
        this.shortlistedIds = new Set(
            data.map((r: any) => String(r.tender_id))
        );
        this.saveLocal();
        }
    } catch (e) {
        console.error("Failed to load server shortlist:", e);
    }
    }

  async getTenders(params: GetTendersParams): Promise<{ data: Tender[]; total: number }> {
    const supabase = await getSupabase();
    const nowIso = new Date().toISOString();

    // ------------------------------------------
    // RECOMMENDATIONS (RPC)
    // ------------------------------------------
    if (params.recommendationsOnly) {
      const { data: auth } = await supabase.auth.getUser();
      const user = auth?.user;
      if (!user?.id) return { data: [], total: 0 };

      const from = (params.page - 1) * params.limit;

      const { data: rpcRows, error } = await supabase.rpc(
        'get_recommended_tenders_with_count',
        {
          p_user: user.id,
          p_limit: params.limit,
          p_offset: from
        }
      );

      if (error || !rpcRows) return { data: [], total: 0 };

      const first = rpcRows[0];
      const total = first ? Number(first.total_count) || 0 : 0;

      return {
        data: rpcRows.map((r: any) => {
          const { total_count, ...rest } = r;
          return this.mapRowToTender(rest);
        }),
        total
      };
    }

    // ------------------------------------------
    // STANDARD QUERY (no archive filtering)
    // ------------------------------------------
    let query = supabase.from('tenders').select('*', { count: 'exact' });

    // -------------------------
    // SEARCH (single OR block)
    // -------------------------
    if (params.search?.trim()) {
    const term = params.search.trim();
    const like = `%${term}%`;

    const cols = [
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

    const clauses = cols.map(c => `${c}.ilike.${like}`);
    query = query.or(clauses.join(','));
    }

    // ------------------------------------------
    // STATUS FILTERS (as earlier working logic)
    // ------------------------------------------
    if (params.statusFilter === 'closed') {
      query = query.lt('end_datetime', nowIso);
    }

    else if (params.statusFilter === 'open') {
    query = query.or(
        `end_datetime.gte.${nowIso},end_datetime.is.null`
    );
    }


    else if (params.statusFilter === 'urgent' || params.statusFilter === 'closing-soon') {
      const nextWeek = new Date();
      nextWeek.setDate(nextWeek.getDate() + 7);

      query
        .gte('end_datetime', nowIso)
        .lte('end_datetime', nextWeek.toISOString());
    }

    else if (params.statusFilter === 'shortlisted') {
        // Avoid querying while toggling
        if (this._isSyncingShortlist || this.isShortlistCooldown) {
            console.warn("⏳ Skipping shortlist fetch — shortlist still syncing.");
            return { data: [], total: 0 };
        }

        // Convert local shortlist → numeric IDs
        const allIds = this.getAllLocalShortlist()
            .map(id => Number(id))
            .filter(n => Number.isInteger(n) && n > 0);

        if (allIds.length === 0) {
            return { data: [], total: 0 };
        }

        // Total shortlist count for pagination UI
        const totalShortlisted = allIds.length;

        // Slice client-side for the current page
        const startIdx = (params.page - 1) * params.limit;
        const pageIds = allIds.slice(startIdx, startIdx + params.limit);

        if (pageIds.length === 0) {
            // Requested page out of range
            return { data: [], total: totalShortlisted };
        }

        // Fetch only this page's records
        const { data: rows, error } = await supabase
            .from('tenders')
            .select('*')
            .in('id', pageIds);

        if (error || !Array.isArray(rows)) {
            console.error("❌ Shortlist fetch error", {
                error,
                pageIds,
                totalShortlisted
            });
            return { data: [], total: totalShortlisted };
        }

        // EARLY RETURN — DO NOT CONTINUE TO query.range()
        return {
            data: rows.map(r => this.mapRowToTender(r)),
            total: totalShortlisted
        };
    }






    // ------------------------------------------
    // EMD FILTER
    // ------------------------------------------
    if (params.emdFilter === 'yes') query = query.gt('emd_amount', 0);
    else if (params.emdFilter === 'no') {
    query = query.or('emd_amount.is.null,emd_amount.eq.0');
    }



    // ------------------------------------------
    // Reverse Auction
    // ------------------------------------------
    if (params.reverseAuction === 'yes') query = query.eq('reverse_auction_enabled', true);
    else if (params.reverseAuction === 'no') query = query.eq('reverse_auction_enabled', false);

    // ------------------------------------------
    // Bid Type
    // ------------------------------------------
    if (params.bidType === 'single') {
    query = query.filter('bid_type', 'ilike', '%single%');
    }
    else if (params.bidType === 'two') {
    query = query.filter('bid_type', 'ilike', '%two%');
    }

    // ------------------------------------------
    // EVALUATION TYPE
    // ------------------------------------------
    if (params.evaluationType === 'item') {
    query = query.ilike('evaluation_method', '%item%');
    }
    else if (params.evaluationType === 'total') {
    query = query.ilike('evaluation_method', '%total%');
    }

    // ------------------------------------------
    // SORTING
    // ------------------------------------------
    if (params.sortBy === 'closing-soon') {
    query = query
        .order('end_datetime', { ascending: true })
        .order('id', { ascending: true });
    } 
    else if (params.sortBy === 'closing-latest') {
    query = query
        .order('end_datetime', { ascending: false })
        .order('id', { ascending: false });
    } 
    else if (params.sortBy === 'oldest') {
    query = query
        .order('bid_date', { ascending: true })
        .order('id', { ascending: true });
    } 
    else {
    query = query
        .order('bid_date', { ascending: false })
        .order('id', { ascending: false });
    }

    // ------------------------------------------
    // PAGINATION
    // ------------------------------------------
    const from = (params.page - 1) * params.limit;
    const to = from + params.limit - 1;

    let data: any[] | null = null;
    let qErr: any = null;
    let count: number | null = null;

    try {
    const res = await query.range(from, to);
    if (res.error) {
    console.error("🧨 SUPABASE RAW ERROR", {
        message: res.error.message,
        details: res.error.details,
        hint: res.error.hint,
        code: res.error.code,
    });
    }

    data = res.data ?? null;
    qErr = res.error ?? null;
    count = res.count ?? null;
    } catch (err) {
    console.error('❌ SUPABASE QUERY THREW EXCEPTION', err, {
        page: params.page,
        filter: params.statusFilter,
        search: params.search,
        shortlistSample: this.getAllLocalShortlist().slice(0, 12),
    });
    return { data: [], total: 0 };
    }

    if (qErr) {
    console.error("❌ REAL SUPABASE ERROR", qErr);
    return { data: [], total: 0 };
    }



    const safeRows: Tender[] = [];

    for (const r of data || []) {
    try {
        safeRows.push(this.mapRowToTender(r));
    } catch (e) {
        console.error("🔥 ROW MAPPING CRASH", r, e);
    }
    }

    return {
    data: safeRows,
    total: count || 0
    };
}
  // ---------------------------------------------------------
  // ROBUST MAPPER (restored from earlier working logic)
  // ---------------------------------------------------------
  mapRowToTender(row: any) {
    const safeDate = (v: any) => {
      if (!v) return null;
      const d = new Date(v);
      return Number.isNaN(d.getTime()) ? null : d;
    };

    const getFirst = (...keys: string[]) => {
      for (const k of keys) {
        if (row && row[k] != null) return row[k];
      }
      return null;
    };

    const quantity =
      row?.quantity ??
      row?.total_quantity ??
      row?.qty ??
      row?.totalQty ??
      null;


    // -----------------------
    // Date formatting helpers
    // -----------------------

    const formatStart = (raw: any) => {
        if (!raw) return null;

        // If Supabase returned a DATE column, it will be a Date object
        if (raw instanceof Date) {
            const y = raw.getFullYear().toString().slice(2);
            const m = String(raw.getMonth() + 1).padStart(2, "0");
            const d = String(raw.getDate()).padStart(2, "0");
            return `${d}/${m}/${y}`;
        }

        // If it's a string "YYYY-MM-DD"
        if (typeof raw === "string" && raw.includes("-")) {
            const [y, m, d] = raw.split("-");
            return `${d}/${m}/${y.slice(2)}`;
        }

        return null;
        };

    // Format TIMESTAMPTZ WITHOUT timezone shift → dd/mm/yy hh:mm
    const formatEnd = (raw: any) => {
    if (!raw) return null;

    // raw example: "2025-12-17T09:00:00+00:00"
    const match = raw.match(
        /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/
    );
    if (!match) return null;

    const [, y, m, d, hh, mm] = match;

    const date = `${d}/${m}/${y.slice(2)}`;
    const hours = Number(hh);
    const minutes = mm;

    // Convert to 12h format, because your UI displays AM/PM
    const suffix = hours >= 12 ? "pm" : "am";
    const hr12 = hours % 12 || 12;

    return `${date} ${hr12}:${minutes} ${suffix}`;
    };

    const startDate = formatStart(row.bid_date);
    const endDate = formatEnd(row.end_datetime);

    // Parse raw end_datetime into real Date (timezone-safe)
    const deadlineDate = row.end_datetime ? new Date(row.end_datetime) : null;

    // Compute status
    let status = 'Active';
    if (deadlineDate) {
    const now = new Date();
    if (deadlineDate < now) {
        status = 'Closed';
    } else {
        const diffDays = (deadlineDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
        if (diffDays <= 3) status = 'Closing Soon';
    }
    }

    return {
        id: row.id,
        gemBidId: row.gem_bid_id,
        bidNumber: getFirst('bid_number', 'gem_bid_id', 'bid_no', 'tender_number'),

        title: getFirst('item', 'item_title', 'b_category_name', 'item_category'),
        category: row.item_category ?? null,
        quantity,

        ministry: row.ministry ?? row.buyer_ministry ?? null,
        department: row.department ?? row.buyer_department ?? null,
        organizationName: row.organization_name ?? null,

        status,
        deadline: deadlineDate,  // IMPORTANT: keep real Date for UI logic

        // formatted for UI
        startDate,
        endDate,
        publishedDate: startDate,

        estimatedValue: row.estimated_value ?? null,
        emdAmount: row.emd_amount ?? null,
        reverseAuctionEnabled: row.reverse_auction_enabled ?? null,

        pageCount: row.page_count ?? null,
        pdfPublicUrl: row.pdf_public_url ?? null,
        pdfStoragePath: row.pdf_storage_path ?? null,
        documentsExtracted: row.documents_extracted ?? null,

        bidType: row.bid_type ?? null, 
        isShortlisted: this.shortlistedIds.has(String(row.id)),

        documentsRequired: row.documents_required ?? [],
        arbitrationClause: row.arbitration_clause ?? null,
        mediationClause: row.mediation_clause ?? null,
        evaluationMethod: row.evaluation_method ?? null,

        raw: row
        };

  }
}

// Export store
export const tenderClientStore = new TenderClientStore();
export default tenderClientStore;
