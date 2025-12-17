
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

export interface Tender {
  // may be missing for some rows (keep optional)
  id?: string;

  // mapping guarantees an item string (fallback to 'Untitled Tender')
  item: string;
  title?: string;

  // these are optional because mapping may fallback or return undefined
  authority?: string;
  ministry?: string | null;
  department?: string | null;

  description?: string;
  productDescription?: string;

  // budget may be null or missing
  budget?: string | null;
  emdAmount?: number;

  // deadline can be null when not present in DB
  deadline?: string | null;

  // status is set by mapping
  status: TenderStatus;

  category?: string;
  location?: string;
  city?: string;
  state?: string;
  pincode?: string | null;

  // publishedDate can be null if not available
  publishedDate?: string | null;

  // quantity may be null/undefined
  quantity?: string | null;

  pageCount?: number | null;
  reverseAuctionEnabled?: boolean;

  sourceUrl?: string;
  bidNumber?: string;
  docId?: string;
  capturedAt?: string | null;
  isEnriched?: boolean;

  pdfPath?: string;
  pdfStoragePath?: string;
  pdfPublicUrl?: string;
  pdfSha256?: string;
  downloadedAt?: string;

  isShortlisted?: boolean;
  boqItems?: BoqItem[];
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