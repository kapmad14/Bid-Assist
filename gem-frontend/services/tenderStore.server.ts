// services/tenderStore.server.ts
// Server-only: use inside Server Components or API routes only.

import { createServerSupabaseClient as createServerClient } from '../lib/supabase-server';
import type { Tender } from '../types';

/**
 * Get a server-side supabase client.
 * The createServerSupabaseClient helper should use next/headers() etc.
 */
function getServerClient() {
  // createServerClient may be async in your helper; if so, adapt to await.
  // If your helper is exported as async function, change call sites accordingly.
  return createServerClient();
}

/**
 * Fetch tenders for server-side rendering.
 * Returns the same shape your UI expects: { data: Tender[], total, totalPages }
 */
export async function getTendersServer(params: {
  page: number;
  limit: number;
  search?: string;
  statusFilter?: 'all' | 'open' | 'urgent' | 'closed' | 'closing-soon' | 'shortlisted';
  emdFilter?: 'all' | 'yes' | 'no';
  reverseAuction?: 'all' | 'yes' | 'no';
  sortBy?: 'newest' | 'oldest' | 'closing-soon' | 'closing-latest';
  recommendationsOnly?: boolean;
  source?: 'gem' | 'all';
}): Promise<{ data: Tender[]; total: number; totalPages: number }> {
  const supabase = await getServerClient();

  // Minimal safe implementation: server RPC + basic query fallback.
  // You can copy your existing query logic here. Below is a simplified version.
  const nowIso = new Date().toISOString();

  if (params.recommendationsOnly) {
    // Use your RPC if available
    const userResp = await supabase.auth.getUser();
    const user = userResp?.data?.user;
    if (!user || !user.id) return { data: [], total: 0, totalPages: 0 };

    const from = (params.page - 1) * params.limit;
    const { data: rpcRows, error: rpcErr } = await supabase.rpc('get_recommended_tenders_with_count', {
      p_user: user.id,
      p_limit: params.limit,
      p_offset: from,
    });

    if (rpcErr || !rpcRows) return { data: [], total: 0, totalPages: 0 };

    let total = 0;
    if (Array.isArray(rpcRows) && rpcRows.length > 0) {
      total = Number((rpcRows[0] as any).total_count) || 0;
    } else if (rpcRows && typeof rpcRows === 'object' && 'total_count' in rpcRows) {
      total = Number((rpcRows as any).total_count) || 0;
    }

    const rows = (rpcRows as any[]).map((r: any) => {
      const { total_count, ...t } = r;
      return t;
    });

    // Minimal mapping: keep as raw rows and let client map or map to Tender shape here
    const mapped = rows.map((r: any) => r as Tender);
    return { data: mapped, total, totalPages: Math.ceil(total / params.limit) };
  }

  // Standard query path (server-side)
  let query: any = supabase.from('tenders').select('*', { count: 'exact' });

  // apply filters (copy over the filters you used before)
  if (params.statusFilter === 'closed') {
    query = query.lt('bid_end_datetime', nowIso);
  } else if (params.statusFilter === 'open') {
    query = query.or(`bid_end_datetime.gte.${nowIso},bid_end_datetime.is.null`);
  } else if (params.statusFilter === 'urgent' || params.statusFilter === 'closing-soon') {
    const nextWeek = new Date();
    nextWeek.setDate(nextWeek.getDate() + 7);
    query = query.gte('bid_end_datetime', nowIso).lte('bid_end_datetime', nextWeek.toISOString());
  }

  // emd filter
  if (params.emdFilter === 'yes') query = query.gt('emd_amount', 0);
  if (params.emdFilter === 'no') query = query.or('emd_amount.is.null,emd_amount.eq.0');

  // reverse auction
  if (params.reverseAuction === 'yes') query = query.eq('reverse_auction_enabled', true);
  if (params.reverseAuction === 'no') query = query.eq('reverse_auction_enabled', false);

  // sorting
  if (params.sortBy === 'closing-soon') {
    query = query.order('bid_end_datetime', { ascending: true });
  } else if (params.sortBy === 'closing-latest') {
    query = query.order('bid_end_datetime', { ascending: false });
  } else if (params.sortBy === 'oldest') {
    query = query.order('bid_date', { ascending: true });
  } else {
    query = query.order('bid_date', { ascending: false });
  }

  // pagination
  const from = (params.page - 1) * params.limit;
  const to = from + params.limit - 1;
  const { data, error, count } = await query.range(from, to);

  if (error) {
    console.error('Server getTenders error:', error);
    return { data: [], total: 0, totalPages: 0 };
  }

  // Map rows to Tender type if needed; here we cast
  const mapped = (data || []).map((r: any) => r as Tender);
  return { data: mapped, total: count || 0, totalPages: Math.ceil((count || 0) / params.limit) };
}

/** Simple server helpers you may want exported */
export async function getTenderByIdServer(id: string): Promise<Tender | undefined> {
  const supabase = await getServerClient();
  const { data, error } = await supabase.from('tenders').select('*').eq('id', id).single();
  if (error || !data) return undefined;
  return data as Tender;
}

export async function getStatsServer() {
  const supabase = await getServerClient();
  const { count: total } = await supabase.from('tenders').select('*', { count: 'exact', head: true });
  const now = new Date().toISOString();
  const { count: active } = await supabase
    .from('tenders')
    .select('*', { count: 'exact', head: true })
    .or(`bid_end_datetime.gte.${now},bid_end_datetime.is.null`);
  return {
    total: total || 0,
    active: active || 0,
    gemCount: total || 0,
  };
}

export async function getRecommendedTenderIdsServer(): Promise<number[]> {
  const supabase = await getServerClient();
  const userResp = await supabase.auth.getUser();
  const user = userResp?.data?.user;
  if (!user || !user.id) return [];
  const { data, error } = await supabase.from('recommendations').select('tender_id').eq('user_id', user.id);
  if (error || !data) return [];
  return (data || []).map((r: any) => Number(r.tender_id)).filter((n: number) => !Number.isNaN(n));
}
