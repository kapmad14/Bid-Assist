// Generated TypeScript interfaces for Supabase database schema
// Based on your actual database structure

export interface AppUser {
  id: string;
  auth_uid: string | null;
  tenant_id: string | null;
  email: string;
  display_name: string | null;
  role: string;
  created_at: string;
  raw_user: Record<string, any>;
}

export interface UserCatalog {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  file_path: string;
  created_at: string;
  updated_at: string;
}

export interface CatalogItem {
  id: string;
  catalog_id: string;
  sku_id: string;
  title: string;
  vendor: string;
  attributes: Record<string, any>;
  price_min: number;
  price_max: number;
  created_at: string;
}

export interface Tender {
  id: number;
  gem_bid_id: string;
  doc_id: string;
  title: string;
  capture_file: string;
  detail_url: string;
  b_category_name: string | null;
  total_quantity: number | null;
  buyer_ministry: string | null;
  buyer_department: string | null;
  organisation_name: string | null;
  is_ra: boolean;
  final_start_date: string | null;
  final_end_date: string | null;
  estimated_value: number | null;
  emd_amount: number | null;
  min_avg_annual_turnover: number | null;
  required_experience_years: number | null;
  past_performance: string | null;
  pdf_path: string;
  pdf_storage_path: string | null;
  pdf_storage_url: string | null;
  pdf_sha256: string;
  last_fail_reason: string | null;
  downloaded_at: string;
  source_date: string;
  created_at: string;
  updated_at: string;
  captured_at: string;
  pdf_public_url: string | null;
  owner_id: string | null;
}

export interface BOQLine {
  id: number;
  gem_bid_id: string;
  line_no: number;
  description: string;
  quantity: number;
  pdf_path: string | null;
  parsed_at: string;
  catalog_id: string;
  tender_id: string | null;
  meta Record<string, any>;
}

export interface MatchingJob {
  id: string;
  catalog_id: string;
  user_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  logs: any[];
  created_at: string;
  updated_at: string;
}

export interface Recommendation {
  id: string;
  catalog_id: string;
  user_id: string;
  tender_id: string | null;
  catalog_item_id: string;
  boq_line_id: number | null;
  score: number;
  note: string;
  status: string;
  created_at: string;
}

export interface Database {
  public: {
    Tables: {
      app_users: {
        Row: AppUser;
        Insert: Omit<AppUser, 'id' | 'created_at'>;
        Update: Partial<Omit<AppUser, 'id'>>;
      };
      user_catalogs: {
        Row: UserCatalog;
        Insert: Omit<UserCatalog, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<UserCatalog, 'id'>>;
      };
      catalog_items: {
        Row: CatalogItem;
        Insert: Omit<CatalogItem, 'id' | 'created_at'>;
        Update: Partial<Omit<CatalogItem, 'id'>>;
      };
      tenders: {
        Row: Tender;
        Insert: Omit<Tender, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Tender, 'id'>>;
      };
      boq_lines: {
        Row: BOQLine;
        Insert: Omit<BOQLine, 'id' | 'parsed_at'>;
        Update: Partial<Omit<BOQLine, 'id'>>;
      };
      matching_jobs: {
        Row: MatchingJob;
        Insert: Omit<MatchingJob, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<MatchingJob, 'id'>>;
      };
      recommendations: {
        Row: Recommendation;
        Insert: Omit<Recommendation, 'id' | 'created_at'>;
        Update: Partial<Omit<Recommendation, 'id'>>;
      };
    };
  };
}

