
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
  id: string;              
  title: string;           
  authority: string;       
  ministry?: string;       
  department?: string;     
  description: string;     
  productDescription?: string; 
  budget: string;          
  emdAmount?: number;      
  deadline: string;        
  status: TenderStatus;
  category: string;
  location: string;
  city?: string;           
  state?: string;          
  pincode?: string;        
  publishedDate: string;   
  quantity?: string;       
  
  sourceUrl?: string;      
  bidNumber?: string;      
  docId?: string;          
  capturedAt?: string;     
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