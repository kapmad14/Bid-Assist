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
  ministry?: string;
  department?: string;
  itemSearch?: string;
};

class TenderClientStore {
  private shortlistedIds = new Set<string>();
  private storageKey = 'tenderflow_shortlist';
  private _isSyncingShortlist = false;

  // ✅ Recommended tender IDs cache (scoped per user)
  private recommendedIdsCache: {
    userId: string;
    ids: number[];
  } | null = null;

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
        // ✅ Step 1: Raw shortlist IDs
        const rawIds = data.map((r: any) => Number(r.tender_id));

        // ✅ Step 2: Check which tenders still exist + active
        const { data: validRows } = await supabase
          .from("tenders")
          .select("id")
          .in("id", rawIds)
          .gte("end_datetime", new Date().toISOString());

        // ✅ Force correct Set<string> typing
        const validIds: Set<string> = new Set(
          (validRows || []).map((r: any) => String(r.id))
        );

        // ✅ Step 3: Remove stale shortlist entries from server
        const staleIds = rawIds.filter(
          (id: number) => !validIds.has(String(id))
        );

        if (staleIds.length > 0) {
          console.warn("🧹 Cleaning stale shortlist IDs:", staleIds);

          await supabase
            .from("user_shortlists")
            .delete()
            .in("tender_id", staleIds);
        }

        // ✅ Step 4: Save only clean shortlist locally
        this.shortlistedIds = validIds;
        this.saveLocal();
        }
    } catch (e) {
        console.error("Failed to load server shortlist:", e);
    }
    }

    // ---------------------------------------------------------
    // ✅ AUTOSUGGEST (Step 4A)
    // Ministry + Department ranked suggestions
    // Triggered only when user types ≥4 characters (UI handles that)
    // ---------------------------------------------------------

    async getMinistrySuggestions(prefix: string): Promise<string[]> {
      const supabase = await getSupabase();
      const q = prefix.trim();

      if (q.length < 4) return [];

      const { data, error } = await supabase
        .from("tenders")
        .select("ministry")
        .ilike("ministry", `%${q}%`)
        .not("ministry", "is", null)
        .limit(200); // pull small pool, rank client-side

      if (error || !data) return [];

      // frequency rank
      const freq = new Map<string, number>();
      for (const row of data) {
        const name = row.ministry?.trim();
        if (!name) continue;
        freq.set(name, (freq.get(name) ?? 0) + 1);
      }

      return [...freq.entries()]
        .sort((a, b) => b[1] - a[1]) // highest frequency first
        .slice(0, 10)
        .map(([name]) => name);
    }

    async getDepartmentSuggestions(prefix: string): Promise<string[]> {
      const supabase = await getSupabase();
      const q = prefix.trim();

      // ✅ Department triggers after 4 chars
      if (q.length < 4) return [];

      const { data, error } = await supabase
        .from("tenders")
        .select("department")
        .ilike("department", `%${q}%`)
        .not("department", "is", null)
        .limit(400); // department has higher variety

      if (error || !data) return [];

      // ✅ Frequency rank + normalization
      const freq = new Map<string, number>();

      for (const row of data) {
        const raw = row.department;
        if (!raw) continue;

        const name = raw.trim();
        if (!name) continue;

        freq.set(name, (freq.get(name) ?? 0) + 1);
      }

      return [...freq.entries()]
        .sort((a, b) => b[1] - a[1]) // highest frequency first
        .slice(0, 10)
        .map(([name]) => name);
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

      // ✅ Always load recommended IDs per user
      if (
        !this.recommendedIdsCache ||
        this.recommendedIdsCache.userId !== user.id
      ) {
        const { data: recRows, error: recErr } = await supabase
          .from("recommendations")
          .select("tender_id")
          .eq("user_id", user.id);

        if (recErr || !recRows?.length) {
          console.warn("No recommendations found", recErr);
          return { data: [], total: 0 };
        }

        // ✅ Store cache scoped to this user
        this.recommendedIdsCache = {
          userId: user.id,
          ids: recRows
            .map((r: any): number => Number(r.tender_id))
            .filter((n: number) => Number.isInteger(n) && n > 0),
        };
      }

      const ids = this.recommendedIdsCache.ids;
      if (!ids || ids.length === 0) return { data: [], total: 0 };

      // ✅ Main query: tenders filtered to recommended set
      let query = supabase
        .from("tenders")
        .select("*", { count: "exact" })
        .in("id", ids)
        .eq("simple_extraction", "success");

      // ✅ Apply filters normally
      if (params.search?.trim()) {
        query = query.ilike("item", `%${params.search.trim()}%`);
      }
      // ✅ Item Search (item column only)
      if (params.itemSearch?.trim()) {
        query = query.ilike(
          "item",
          `%${params.itemSearch.trim()}%`
        );
      }

      if (params.ministry?.trim()) {
        query = query.ilike("ministry", `%${params.ministry.trim()}%`);
      }

      if (params.department?.trim()) {
        query = query.ilike("department", `%${params.department.trim()}%`);
      }

      if (params.emdFilter === "yes") query = query.gt("emd_amount", 0);
      if (params.emdFilter === "no") {
        query = query.or("emd_amount.is.null,emd_amount.eq.0");
      }

      if (params.reverseAuction === "yes") {
        query = query.eq("reverse_auction_enabled", true);
      }

      if (params.reverseAuction === "no") {
        query = query.eq("reverse_auction_enabled", false);
      }

      if (params.bidType === "single") {
        query = query.ilike("bid_type", "%single%");
      }

      if (params.bidType === "two") {
        query = query.ilike("bid_type", "%two%");
      }

      if (params.evaluationType === "item") {
        query = query.ilike("evaluation_method", "%item%");
      }

      if (params.evaluationType === "total") {
        query = query.ilike("evaluation_method", "%total%");
      }

      // ✅ Always newest tenders first
      query = query.order("bid_date", { ascending: false });

      // ✅ Pagination
      const from = (params.page - 1) * params.limit;
      const to = from + params.limit - 1;

      const { data: rows, count, error } = await query.range(from, to);
      if (error || !rows) return { data: [], total: 0 };

      return {
        data: rows.map((r: any) => this.mapRowToTender(r)),
        total: count || 0,
      };
    }
    
    // ------------------------------------------
    // STANDARD QUERY (no archive filtering)
    // ------------------------------------------
    let query = supabase.from('tenders').select('*', { count: 'exact' });
    // 🚨 CRITICAL FILTER — ONLY SHOW SUCCESSFULLY EXTRACTED TENDERS
    query = query.eq('simple_extraction', 'success');    

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

    // ✅ Item Search Filter (item column only)
    if (params.itemSearch?.trim()) {
      query = query.ilike(
        "item",
        `%${params.itemSearch.trim()}%`
      );
    }

    if (params.ministry?.trim()) {
      query = query.ilike("ministry", `%${params.ministry.trim()}%`);
    }

    if (params.department?.trim()) {
      query = query.ilike("department", `%${params.department.trim()}%`);
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

        // ✅ NEW: shortlist must behave like recommendations
        // Apply filters BEFORE pagination

        let shortlistQuery = supabase
          .from("tenders")
          .select("*", { count: "exact" })
          .in("id", allIds)
          .eq("simple_extraction", "success");

        // ✅ Keyword Search
        if (params.search?.trim()) {
          shortlistQuery = shortlistQuery.ilike(
            "item",
            `%${params.search.trim()}%`
          );
        }

        // ✅ Item Search (item column only)
        if (params.itemSearch?.trim()) {
          shortlistQuery = shortlistQuery.ilike(
            "item",
            `%${params.itemSearch.trim()}%`
          );
        }

        // ✅ Ministry Filter
        if (params.ministry?.trim()) {
          shortlistQuery = shortlistQuery.ilike(
            "ministry",
            `%${params.ministry.trim()}%`
          );
        }

        // ✅ Department Filter
        if (params.department?.trim()) {
          shortlistQuery = shortlistQuery.ilike(
            "department",
            `%${params.department.trim()}%`
          );
        }

        // ✅ EMD Filter
        if (params.emdFilter === "yes") {
          shortlistQuery = shortlistQuery.gt("emd_amount", 0);
        }

        if (params.emdFilter === "no") {
          shortlistQuery = shortlistQuery.or(
            "emd_amount.is.null,emd_amount.eq.0"
          );
        }

        // ✅ Reverse Auction Filter
        if (params.reverseAuction === "yes") {
          shortlistQuery = shortlistQuery.eq("reverse_auction_enabled", true);
        }

        if (params.reverseAuction === "no") {
          shortlistQuery = shortlistQuery.eq("reverse_auction_enabled", false);
        }

        // ✅ Bid Type Filter
        if (params.bidType === "single") {
          shortlistQuery = shortlistQuery.ilike("bid_type", "%single%");
        }

        if (params.bidType === "two") {
          shortlistQuery = shortlistQuery.ilike("bid_type", "%two%");
        }

        // ✅ Evaluation Method Filter
        if (params.evaluationType === "item") {
          shortlistQuery = shortlistQuery.ilike("evaluation_method", "%item%");
        }

        if (params.evaluationType === "total") {
          shortlistQuery = shortlistQuery.ilike("evaluation_method", "%total%");
        }

        // ✅ Always newest first (like recommendations)
        shortlistQuery = shortlistQuery.order("bid_date", {
          ascending: false,
        });

        // ✅ Pagination AFTER filtering
        const from = (params.page - 1) * params.limit;
        const to = from + params.limit - 1;

        const { data: rows, count, error } = await shortlistQuery.range(from, to);

        if (error || !Array.isArray(rows)) {
          console.error("❌ Shortlist fetch error", error);
          return { data: [], total: 0 };
        }

        return {
          data: rows.map((r) => this.mapRowToTender(r)),
          total: count || 0,
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
        organizationAddress: row.organization_address ?? null,
        pincode: row.pincode ?? null,

        status,
        deadline: deadlineDate,  // IMPORTANT: keep real Date for UI logic

        // formatted for UIX
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
