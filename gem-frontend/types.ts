// ✅ Tender Sources (used for unified explorer)
export type TenderSource = "all" | "gem" | "cpwd";

export enum TenderStatus {
  OPEN = 'Open',
  CLOSED = 'Closed',
  AWARDED = 'Awarded',
}

export interface BoqItem {
  item_title: string;
  quantity: number;
  unit: string;
  category: string;
  specifications: string;
  delivery_days: number;
}

// FILE: src/types.ts  (or wherever your project stores this)
export interface Tender {
  id: number;
  gemBidId: string;
  bidNumber: string | null;

  item?: string | null;   // <-- add this
  title: string | null;            // maps from t.item
  category: string | null;         // maps from item_category
  quantity: number | null;

  ministry: string | null;
  department: string | null;
  organizationName: string | null;

  organizationAddress: string | null;
  pincode: string | null;

  startDate: string | null;
  endDate: string | null;
  publishedDate?: string | null;

  estimatedValue: number | null;
  emdAmount: number | null;
  reverseAuctionEnabled: boolean | null;

  pageCount: number | null;
  pdfPublicUrl: string | null;
  pdfStoragePath: string | null;
  documentsExtracted: boolean | null;

  isShortlisted?: boolean;
  deadline: Date | null;        // <-- ADD THIS LINE

  bidType?: string | null;

  // 🔽 REQUIRED for Bid Conditions UI
  documentsRequired?: string[];
  arbitrationClause?: boolean | null;
  mediationClause?: boolean | null;
  evaluationMethod?: string | null;

  raw?: any;

}


export interface TenderAnalysis {
  summary: string;
  riskScore: number; 
  keyRequirements: string[];
  eligibilityCriteria: string[];
  riskFactors: string[];
  winProbabilityComment: string;
}

export interface ProposalDraft {
  coverLetter: string;
  technicalApproach: string;
}

export interface TenderParserResponse {
  bid_number: string | null;
  bid_date: string | null;
  bid_end_datetime: string | null;
  total_quantity: number | null;
  item_category: string | null;
  
  mse_turnover_exemption: boolean | null;
  startup_turnover_exemption: boolean | null;
  oem_avg_turnover: number | null;
  required_experience_years: number | null;
  mse_experience_exemption: boolean | null;
  startup_experience_exemption: boolean | null;
  past_performance_percentage: number | null;
  emd_required: boolean | null;
  emd_amount: number | null;
  emd_exemption_mse: boolean | null;
  
  ministry: string | null;
  department: string | null;
  organization_name: string | null;
  organization_type: string | null;
  organization_address: string | null;
  pincode: string | null;
  
  mse_preference: boolean | null;
  mii_preference: boolean | null;
  make_in_india_preference: boolean | null;
  local_content_requirement: string | null;
  bid_type: string | null;
  participation_fee: number | null;
  
  epbg_required: boolean | null;
  epbg_percentage: number | null;
  payment_terms: string | null;
  advance_payment_percentage: number | null;
  warranty_required: boolean | null;
  warranty_period: string | null;
  
  boq_items: BoqItem[];
  
  _metadata?: {
    parsed_at: string;
    model: string;
  };
}

export type GemResult = {
  id?: number;

  bid_number: string;
  bid_detail_url?: string | null;
  bid_hover_url?: string | null;

  has_reverse_auction?: boolean | null;
  ra_number?: string | null;
  ra_detail_url?: string | null;
  ra_hover_url?: string | null;

  quantity?: number | null;
  ministry?: string | null;
  department?: string | null;
  organisation_address?: string | null;

  start_datetime?: string | null;   // ISO strings from Supabase
  end_datetime?: string | null;

  tech_participated?: number | null;
  tech_qualified?: number | null;

  l1_seller: string | null;
  l1_item: string | null;
  l1_price: number | null;
  l2_seller?: string | null;
  l2_item?: string | null;
  l2_price?: number | null;
  l3_seller?: string | null;
  l3_item?: string | null;
  l3_price?: number | null;

  extraction_status?: 'pending' | 'success' | 'failed';
  scraped_on?: string;
  created_at?: string;

  pdf_public_url?: string | null;
};
