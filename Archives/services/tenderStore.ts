
import { createClient } from '../lib/supabase-client';
import { Tender, TenderStatus } from '../types';

const supabase = createClient();

class TenderStore {
  private shortlistedIds: Set<string> = new Set();

  constructor() {
    this.loadShortlist();
  }

  private loadShortlist() {
    try {
      const stored = localStorage.getItem('tenderflow_shortlist');
      if (stored) {
        this.shortlistedIds = new Set(JSON.parse(stored));
      }
    } catch (e) {
      console.error("Failed to load shortlist", e);
    }
  }

  private saveShortlist() {
    try {
      localStorage.setItem('tenderflow_shortlist', JSON.stringify(Array.from(this.shortlistedIds)));
    } catch (e) {
      console.error("Failed to save shortlist", e);
    }
  }

  toggleShortlist(id: string) {
    if (this.shortlistedIds.has(id)) {
      this.shortlistedIds.delete(id);
    } else {
      this.shortlistedIds.add(id);
    }
    this.saveShortlist();
  }

  isShortlisted(id: string): boolean {
    return this.shortlistedIds.has(id);
  }
  
  // Map DB row to UI Tender model
  private mapRowToTender(row: any): Tender {
    // Determine status based on dates
    const now = new Date();
    const endDate = row.bid_end_datetime ? new Date(row.bid_end_datetime) : null;
    let status = TenderStatus.OPEN;
    if (endDate && endDate < now) status = TenderStatus.CLOSED;

    return {
      id: row.id?.toString(),
      // User requested bid_number (e.g. 7585086) priority over gem_bid_id
      bidNumber: row.bid_number || row.gem_bid_id,
      title: row.title || row.b_category_name || 'Untitled Tender',
      authority: row.organisation_name || 'GeM Portal',
      ministry: row.buyer_ministry || row.ministry,
      department: row.buyer_department || row.department,
      description: row.product_description || row.title || "No description available",
      budget: row.estimated_value ? `₹ ${row.estimated_value}` : 'Refer to Doc',
      // User requested emd_amount_parsed priority
      emdAmount: row.emd_amount_parsed ? parseFloat(row.emd_amount_parsed) : (row.emd_amount ? parseFloat(row.emd_amount) : 0),
      deadline: row.bid_end_datetime || new Date().toISOString(),
      status: status,
      // User requested item_category_parsed for the main title area
      category: row.item_category_parsed || row.b_category_name || "Goods",
      location: `${row.city || ''} ${row.state || ''}`.trim() || row.pincode || 'India',
      city: row.city,
      state: row.state,
      pincode: row.pincode,
      publishedDate: row.bid_date || row.created_at,
      sourceUrl: row.detail_url || row.source_url,
      capturedAt: row.captured_at,
      isEnriched: row.documents_extracted || false,
      pdfPath: row.pdf_path,
      pdfStoragePath: row.pdf_storage_path,
      pdfPublicUrl: row.pdf_public_url,
      quantity: row.total_quantity?.toString() || row.total_quantity_parsed?.toString(),
      isShortlisted: this.shortlistedIds.has(row.id?.toString()),
      boqItems: row.boq_items || []
    };
  }

  async getTenders(params: { 
    page: number; 
    limit: number; 
    search?: string; 
    statusFilter?: 'all' | 'open' | 'urgent' | 'closed' | 'closing-soon' | 'shortlisted';
    emdFilter?: 'all' | 'yes' | 'no';
    sortBy?: 'newest' | 'oldest' | 'closing-soon' | 'closing-latest';
    recommendationsOnly?: boolean;
    source?: 'gem' | 'all';
  }): Promise<{ data: Tender[], total: number, totalPages: number }> {
    
    let query = supabase
      .from('tenders')
      .select('*', { count: 'exact' });

    // 1. Search
    if (params.search && params.search.trim()) {
      const term = params.search.trim();
      // Use a simpler OR filter to prevent syntax errors with special characters
      query = query.or(`title.ilike.%${term}%,gem_bid_id.ilike.%${term}%,item_category_parsed.ilike.%${term}%`);
    }

    // 2. Status Filter
    const now = new Date().toISOString();
    
    if (params.statusFilter === 'shortlisted') {
       const ids = Array.from(this.shortlistedIds);
       if (ids.length === 0) {
          return { data: [], total: 0, totalPages: 0 };
       }
       // Cast IDs to numbers if your DB uses integer IDs, or keep strings if UUID
       // Assuming 'id' in DB is bigint (number) based on provided schema
       query = query.in('id', ids);
    } else if (params.statusFilter === 'closed') {
       query = query.lt('bid_end_datetime', now);
    } else if (params.statusFilter === 'open') {
       // Use simpler logic for Open: either future date OR null date
       query = query.or(`bid_end_datetime.gte.${now},bid_end_datetime.is.null`);
    } else if (params.statusFilter === 'urgent' || params.statusFilter === 'closing-soon') {
       const nextWeek = new Date();
       nextWeek.setDate(nextWeek.getDate() + 7);
       query = query.gte('bid_end_datetime', now).lte('bid_end_datetime', nextWeek.toISOString());
    }

    // 3. EMD Filter
    if (params.emdFilter === 'yes') {
       query = query.gt('emd_amount_parsed', 0);
    } else if (params.emdFilter === 'no') {
       query = query.or('emd_amount_parsed.is.null,emd_amount_parsed.eq.0');
    }

    // 4. Sorting
    if (params.sortBy === 'closing-soon') {
      query = query.order('bid_end_datetime', { ascending: true, nullsFirst: false });
    } else if (params.sortBy === 'closing-latest') {
      query = query.order('bid_end_datetime', { ascending: false, nullsFirst: false });
    } else if (params.sortBy === 'oldest') {
      query = query.order('bid_date', { ascending: true });
    } else {
      // Default: Newest first
      query = query.order('bid_date', { ascending: false });
    }

    // 5. Pagination
    const from = (params.page - 1) * params.limit;
    const to = from + params.limit - 1;
    
    const { data, error, count } = await query.range(from, to);

    if (error) {
      console.error('Supabase Error details:', JSON.stringify(error, null, 2));
      throw new Error(`Supabase Error: ${error.message} (${error.code})`);
    }

    const mappedData = (data || []).map(row => this.mapRowToTender(row));

    return { 
      data: mappedData, 
      total: count || 0, 
      totalPages: Math.ceil((count || 0) / params.limit) 
    };
  }

  async getTenderById(id: string): Promise<Tender | undefined> {
    const { data, error } = await supabase
      .from('tenders')
      .select('*')
      .eq('id', id)
      .single();
    
    if (error) {
       console.error("Error fetching tender by ID:", JSON.stringify(error, null, 2));
       return undefined;
    }
    if (!data) return undefined;
    return this.mapRowToTender(data);
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
      console.error("Error fetching stats:", e);
      return { total: 0, active: 0, gemCount: 0 };
    }
  }

  async updateTender(id: string, updates: Partial<Tender>) {
    const dbUpdates: any = {};
    if (updates.description) dbUpdates.product_description = updates.description;
    if (updates.isEnriched !== undefined) dbUpdates.documents_extracted = updates.isEnriched;
    
    if (Object.keys(dbUpdates).length === 0) return;

    const { error } = await supabase.from('tenders').update(dbUpdates).eq('id', id);
    if (error) console.error('Error updating tender:', error);
  }

  async syncWithGeM() {
     console.log("Sync triggered.");
     return { added: 0 };
  }
}

export const tenderStore = new TenderStore();
