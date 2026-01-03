'use client';
export const dynamic = 'force-dynamic';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

import {
  ArrowLeft,
  Download,
  FileText,
  Loader2,
  Eye,
  ExternalLink,
  FileSpreadsheet,
  File,
  Image as ImageIcon,
  Star,
} from 'lucide-react';

import { tenderClientStore as tenderStore } from '@/services/tenderStore.client';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

interface Tender {
  id: number;
  bid_number: string | null;
  item: string | null;
  ministry: string | null;
  department: string | null;
  organization_name: string | null;
  end_datetime: string | null;
  bid_date: string | null;
  emd_amount: string | number | null;
  total_quantity: string | number | null;
  organization_type: string | null;
  pincode: string | null;
  state: string | null;
  city: string | null;
  product_description?: string | null;

  // BoQ items from tenders table
  boq_items?: any | null;

  // PDF-related fields
  pdf_storage_path: string | null;
  pdf_public_url: string | null;

  gem_bid_id: string | null;
  // any other fields are allowed but unused
  [key: string]: any;
}

interface ExtractedDocument {
  id: string;
  filename: string;
  fileSize: string;
  fileType: string;
  storageUrl: string;
  extractedAt: string;
}

export default function TenderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const pageFromList = searchParams.get('page') ?? '1';
  const tenderIdParam = params?.id;
  const tenderIdNum = tenderIdParam ? Number(tenderIdParam) : NaN;

  // ✅ Supabase client (dynamic import to avoid Turbopack SSR evaluation issues)
  const [supabase, setSupabase] = useState<any>(null);

  useEffect(() => {
    import('@/lib/supabase-client').then(({ createClient }) => {
      setSupabase(createClient());
    });
  }, []);

  // Sync shortlist from DB so detail page always shows correct state
  useEffect(() => {
    tenderStore.loadServerShortlist();
  }, []);


  const [tender, setTender] = useState<Tender | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // PDF preview state
  const [selectedDocUrl, setSelectedDocUrl] = useState<string | null>(null);

  // Document extraction states
  const [isExtracting, setIsExtracting] = useState(false);
  const [urlsExtracted, setUrlsExtracted] = useState(false);
  const [extractedDocs, setExtractedDocs] = useState<ExtractedDocument[]>([]);
  const [clickedDocs, setClickedDocs] = useState<Set<string>>(new Set());
  const [docsCollapsed, setDocsCollapsed] = useState(true);

  // Shortlist state (client-side, optimistic)
  const [isShortlisted, setIsShortlisted] = useState<boolean>(false);
  const shortlistPendingRef = useRef(false);

  // prevent setting state after unmount / race conditions
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const initPreviewUrlFromTender = (row: Tender | null) => {
    if (!row) {
      setSelectedDocUrl(null);
      return;
    }

    // 1️⃣ Prefer pdf_public_url if present
    if (row.pdf_public_url) {
      const url = String(row.pdf_public_url);
      if (/^https?:\/\//i.test(url)) {
        setSelectedDocUrl(encodeURI(url));
        return;
      }
    }

    // 2️⃣ Fallback: derive from pdf_storage_path via supabase.storage.getPublicUrl
    if (row.pdf_storage_path) {
      try {
        if (supabase) {
          const { data } = supabase.storage
            .from('gem-pdfs')
            .getPublicUrl(String(row.pdf_storage_path));

          if (data?.publicUrl && /^https?:\/\//i.test(data.publicUrl)) {
            setSelectedDocUrl(encodeURI(data.publicUrl));
            return;
          }
        }

      } catch (e) {
        console.warn('Failed to derive public URL from pdf_storage_path', e);
      }
    }

    // 3️⃣ If nothing works, clear URL
    setSelectedDocUrl(null);
  };

  useEffect(() => {
    async function fetchTender() {
      setLoading(true);
      setError(null);

      if (!tenderIdParam || Number.isNaN(tenderIdNum)) {
        setError('Invalid tender id');
        setLoading(false);
        return;
      }

      try {
        if (!supabase) return;  // ⬅️ REQUIRED: prevents calling supabase=null

        const { data, error } = await supabase
          .from('tenders')
          .select('*')
          .eq('id', tenderIdNum)
          .single();


        if (error) throw error;
        if (!mountedRef.current) return;

        const row = data as Tender;
        setTender(row);

        // initialize shortlist state from tenderStore (local cache)
        try {
          const idStr = row?.id != null ? String(row.id) : '';
          setIsShortlisted(tenderStore.isShortlisted(idStr));
        } catch {
          // ignore local cache errors
        }

        // 🔑 Initialize Bid Document Preview URL
        initPreviewUrlFromTender(row);
      } catch (err: any) {
        if (!mountedRef.current) return;
        setError(err?.message || 'Failed to load tender');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    fetchTender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderIdParam, supabase]);

  // Auto-load additional documents on page load
  useEffect(() => {
    if (!tender?.id) return;
    handlePreviewAdditionalDocs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tender?.id]);


  const formatDate = (dateString?: string | null, opts: "date" | "datetime" = "datetime") => {
    if (!dateString) return "N/A";
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return "N/A";

    if (opts === "date") {
      return d.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "2-digit",
      });
    }

    return d.toLocaleString("en-IN", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  };


  const formatCurrency = (amount?: string | number | null) => {
    if (amount === null || amount === undefined || amount === '') return 'Not Required';
    const num = typeof amount === 'number' ? amount : parseFloat(String(amount));
    if (Number.isNaN(num)) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(num);
  };

  const getTenderStatus = () => {
    const raw = tender?.end_datetime;
    if (!raw) return 'Unknown';

    const end = new Date(raw);
    if (isNaN(end.getTime())) return 'Unknown';

    const now = new Date();
    if (end < now) return 'Closed';

    const diffMs = end.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    return diffDays <= 7 ? 'Closing Soon' : 'Active';
  };

  const getBidTypePill = (bidType?: unknown) => {
    if (!bidType || typeof bidType !== 'string') return null;

    const normalized = bidType.toLowerCase();

    if (normalized.includes('two')) {
      return {
        text: 'Two Packet Bid',
        classes: 'bg-purple-50 text-purple-700 border border-purple-100',
      };
    }

    if (normalized.includes('single')) {
      return {
        text: 'Single Packet Bid',
        classes: 'bg-blue-50 text-blue-700 border border-blue-100',
      };
    }

    return null;
  };


  const handleShortlistToggle = async () => {
    if (!tender?.id || shortlistPendingRef.current) return;
    shortlistPendingRef.current = true;

    // optimistic update
    setIsShortlisted(prev => !prev);
    try {
      const result = (await tenderStore.toggleShortlist(
        String(tender.id),
      )) as any;
      if (
        result &&
        result.persisted === false &&
        result.reason?.startsWith('server-error')
      ) {
        // rollback
        setIsShortlisted(prev => !prev);
      }
    } catch (err) {
      console.error('Shortlist toggle failed:', err);
      setIsShortlisted(prev => !prev);
    } finally {
      shortlistPendingRef.current = false;
    }
  };

  const handleDownload = (url: string | null) => {
    if (url) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

const getFilePriority = (fileType: string): number => {
  const type = fileType.toLowerCase();

  if (type === 'pdf') return 1;

  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(type)) return 2;

  if (['doc', 'docx', 'txt'].includes(type)) return 3;

  if (['xls', 'xlsx', 'csv'].includes(type)) return 4;

  return 5;
};

const handlePreviewAdditionalDocs = async () => {
  if (!tender?.id) return;

  setIsExtracting(true);

  try {
    const response = await fetch(`/api/tender-documents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenderId: tender.id }),
    });

    if (!response.ok) {
      console.error(
        'Tender documents API error:',
        response.status,
        await response.text().catch(() => 'Non-JSON error'),
      );
      return;
    }

    const data = await response.json();

    if (data?.success) {
      const formattedDocs = (data.documents || []).map(
        (doc: any, idx: number) => ({
          id: String(doc.order_index ?? idx),
          filename: doc.filename || `document-${idx + 1}`,
          fileSize: 'N/A',
          fileType:
            (doc.filename || '')
              .split('.')
              .pop()
              ?.toLowerCase() || 'unknown',
          storageUrl: doc.url ? encodeURI(String(doc.url)) : '',
          extractedAt: new Date().toISOString(),
        }),
      );

      const sortedDocs = [...formattedDocs].sort((a, b) => {
        const pA = getFilePriority(a.fileType);
        const pB = getFilePriority(b.fileType);

        if (pA !== pB) return pA - pB;

        // secondary: stable alphabetical sort
        return a.filename.localeCompare(b.filename);
      });
      setExtractedDocs(sortedDocs);

      setUrlsExtracted(true);

    } else {
      console.error('Unexpected API response:', data);
    }
  } catch (error) {
    console.error('Network error while fetching tender documents:', error);
  } finally {
    setIsExtracting(false);
  }
};


  const canPreview = (fileType: string): boolean => {
    const previewableTypes = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'];
    return previewableTypes.includes(fileType.toLowerCase());
  };

  const handleDocumentAction = (docId: string, url: string, fileType: string) => {
    setClickedDocs(prev => {
      const copy = new Set(prev);
      copy.add(docId);
      return copy;
    });
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const getFileIcon = (fileType: string) => {
    const type = fileType.toLowerCase();
    if (type === 'xlsx' || type === 'xls' || type === 'csv') {
      return <FileSpreadsheet className="h-5 w-5 text-green-600" />;
    } else if (type === 'pdf') {
      return <FileText className="h-5 w-5 text-red-600" />;
    } else if (['jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'].includes(type)) {
      return <ImageIcon className="h-5 w-5 text-blue-600" />;
    }
    return <File className="h-5 w-5 text-gray-600" />;
  };

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center justify-center">
          <Loader2
            className="w-8 h-8 text-[#F7C846] animate-spin"
            aria-hidden
          />
        </div>
      </div>
    );
  }

  if (error || !tender) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-center text-lg text-red-600 font-medium">
          Error loading tender: {error || 'Tender not found'}
        </p>
        <div className="text-center mt-4">
          <Button
            onClick={() => router.push(`/tenders?page=${pageFromList}`)}
            variant="outline"
            className="border-2 border-gray-300 font-bold text-gray-900 hover:bg-gray-50"
          >
            <ArrowLeft className="h-5 w-5 mr-2" aria-hidden />
            Back to All Tenders
          </Button>
        </div>
      </div>
    );
  }

  const status = getTenderStatus();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top bar with Back button */}
      <div className="bg-white border-b-2 border-gray-200 px-4 py-4 shadow-sm">
        <div className="container mx-auto">
          <Button
            onClick={() => router.push(`/tenders?page=${pageFromList}`)}
            variant="outline"
            className="border-2 border-gray-300 font-bold text-gray-900 hover:bg-gray-50"
          >
            <ArrowLeft className="h-5 w-5 mr-2" aria-hidden />
            Back to All Tenders
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column - Tender Details & Actions */}
          <div className="lg:col-span-1 space-y-4">
            {/* Tender Details Card */}
            <Card className="border-2 border-gray-200">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-base font-bold text-gray-900">
                      Tender Details
                    </CardTitle>
                  </div>
                    <span
                      className={`inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded
                        ${
                          status === 'Closed'
                            ? 'bg-red-600 text-white border border-red-600'
                            : status === 'Closing Soon'
                            ? 'bg-orange-50 text-orange-700 border border-orange-100'
                            : 'bg-green-50 text-green-700 border border-green-100'
                        }
                      `}
                    >
                      {status}
                    </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-gray-600 font-semibold">
                    Bid Number
                  </p>
                  <p className="font-bold text-sm text-gray-900">
                    {tender.bid_number || 'N/A'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-semibold">
                    Closing Date
                  </p>
                  <p className="font-bold text-sm text-gray-900">
                    {formatDate(tender.end_datetime, "datetime")}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-semibold">
                    Item
                  </p>
                  <p className="font-bold text-sm text-gray-900 line-clamp-5">
                    {tender.item || 'N/A'}
                  </p>
                </div>
                  <div className="flex items-start justify-between gap-4">
                    {/* EMD */}
                    <div className="space-y-4">
                      {/* EMD */}
                      <div>
                        <p className="text-xs text-gray-600 font-semibold">
                          EMD Amount
                        </p>
                        <p className="font-bold text-sm text-gray-900">
                          {formatCurrency(tender.emd_amount)}
                        </p>
                      </div>

                      {/* Pills below EMD */}
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Reverse Auction pill */}
                        {tender.reverse_auction_enabled && (
                          <span className="inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded
                            bg-blue-50 text-blue-700 border border-blue-100">
                            Reverse Auction
                          </span>
                        )}

                        {/* Bid Type pill */}
                        {(() => {
                          const pill = getBidTypePill(tender.bid_type);
                          if (!pill) return null;

                          return (
                            <span
                              className={`inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded ${pill.classes}`}
                            >
                              {pill.text}
                            </span>
                          );
                        })()}
                      </div>
                    </div>


                    {/* Shortlist */}
                    <button
                      onClick={handleShortlistToggle}
                      aria-pressed={isShortlisted}
                      aria-label={
                        isShortlisted
                          ? 'Remove from shortlist'
                          : 'Add to shortlist'
                      }
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-bold transition-all h-fit ${
                        isShortlisted
                          ? 'bg-yellow-50 border-[#F7C846] text-yellow-700'
                          : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <Star
                        className={`w-3 h-3 ${
                          isShortlisted
                            ? 'fill-yellow-500 text-yellow-500'
                            : ''
                        }`}
                        aria-hidden
                      />
                      <span>
                        {isShortlisted ? 'Shortlisted' : 'Shortlist'}
                      </span>
                    </button>
                  </div>
              </CardContent>
            </Card>
            {/* Bid Conditions */}
            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900">
                  Bid Conditions
                </CardTitle>
              </CardHeader>

              <CardContent className="space-y-4">
                {/* Clause pills */}
                <div className="flex flex-wrap gap-2">
                  {tender.arbitration_clause && (
                    <span className="inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded
                      bg-green-50 text-green-700 border border-green-100">
                      Arbitration
                    </span>
                  )}

                  {tender.mediation_clause && (
                    <span className="inline-flex items-center text-[11px] font-semibold px-3 py-1 rounded
                      bg-green-50 text-green-700 border border-green-100">
                      Mediation
                    </span>
                  )}

                  {!tender.arbitration_clause && !tender.mediation_clause && (
                    <span className="text-xs text-gray-500">
                      No dispute resolution clauses specified
                    </span>
                  )}
                </div>

                {/* Evaluation Method */}
                <div>
                  <p className="text-xs text-gray-600 font-semibold">Evaluation Method</p>
                  <p className="font-bold text-sm text-gray-900">
                    {tender.evaluation_method || 'Not specified'}
                  </p>
                </div>

                {/* Documents Required placeholder – next step */}
                <div>
                  <p className="text-xs text-gray-600 font-semibold mb-1">Documents Required</p>

                  {Array.isArray(tender.documents_required) && tender.documents_required.length > 0 ? (
                    <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto pr-1">
                      {tender.documents_required.slice(0, 8).map((doc: string, idx: number) => (
                        <span
                          key={idx}
                          className="inline-flex items-center text-[11px] font-semibold px-2 py-1 rounded
                            bg-gray-100 text-gray-700 border border-gray-200"
                          title={doc}
                        >
                          {doc}
                        </span>
                      ))}

                      {tender.documents_required.length > 8 && (
                        <span className="text-[11px] text-gray-500 self-center">
                          +{tender.documents_required.length - 8} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">No mandatory documents specified</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Documents + Preview */}
          <div className="lg:col-span-2 space-y-4">
            {/* Additional Documents List */}
              <Card id="documents-section" className="border-2 border-gray-200">
                <CardHeader
                  role="button"
                  tabIndex={0}
                  onClick={() => setDocsCollapsed(prev => !prev)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDocsCollapsed(prev => !prev);
                    }
                  }}
                  className="
                    border-b
                    cursor-pointer
                    select-none
                    transition-colors
                    hover:bg-gray-50
                    focus:outline-none
                    focus:ring-2
                    focus:ring-blue-500
                  "
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CardTitle className="text-base font-bold text-gray-900">
                        Additional Documents
                      </CardTitle>
                      <Badge variant="success" className="text-xs font-semibold">
                        {isExtracting
                          ? 'Loading…'
                          : `${extractedDocs.length} document${extractedDocs.length !== 1 ? 's' : ''}`}
                      </Badge>
                    </div>

                    <span className="text-xs font-semibold text-gray-600">
                      {docsCollapsed ? 'Click to see all Docs' : 'Click to hide Docs'}
                    </span>
                  </div>
                </CardHeader>

                {!docsCollapsed && (
                <CardContent className="p-4 space-y-3">
                  {isExtracting && extractedDocs.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-6">
                      Fetching additional documents…
                    </p>
                  )}

                  {!isExtracting && extractedDocs.length === 0 && (
                    <p className="text-sm text-gray-500 text-center py-6">
                      No additional documents found.
                    </p>
                  )}                  
                  {extractedDocs.map(doc => (
                    <div
                      key={doc.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleDocumentAction(doc.id, doc.storageUrl, doc.fileType)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleDocumentAction(doc.id, doc.storageUrl, doc.fileType);
                        }
                      }}
                      className={`
                        flex items-center justify-between p-3
                        border-2 border-gray-200 rounded-lg
                        bg-white transition-all
                        cursor-pointer
                        hover:bg-gray-50 hover:border-gray-300
                        focus:outline-none focus:ring-2 focus:ring-blue-500
                        ${selectedDocUrl === doc.storageUrl ? 'ring-2 ring-blue-500' : ''}
                      `}
                    >
                      <div className="flex items-center gap-3">
                        {getFileIcon(doc.fileType)}
                        <div>
                          <p
                            className="font-bold text-sm text-gray-900 truncate max-w-[480px]"
                            title={doc.filename}
                          >
                            {doc.filename}
                          </p>
                          <p className="text-xs text-gray-600 font-medium">
                            additional document • {doc.fileType}
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(doc.storageUrl);
                          }}
                          className="font-semibold"
                          aria-label={`Download ${doc.filename}`}
                        >
                          <Download className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
                )}
              </Card>

            {/* Bid Document Preview */}
            <Card className="border-2 border-gray-200">
              <CardHeader className="border-b py-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-bold text-gray-900">
                    Bid Document Preview
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() =>
                        selectedDocUrl
                          ? window.open(
                              selectedDocUrl,
                              '_blank',
                              'noopener,noreferrer',
                            )
                          : null
                      }
                      className="border-2 border-gray-300 font-semibold"
                      aria-label="Open document full screen"
                      disabled={!selectedDocUrl}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" aria-hidden />
                      Open Full Screen
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        if (!selectedDocUrl) return;
                        const link = document.createElement('a');
                        link.href = selectedDocUrl;
                        link.download =
                          tender.pdf_storage_path?.split('/').pop() ||
                          'document.pdf';
                        link.target = '_blank';
                        link.rel = 'noopener noreferrer';
                        document.body.appendChild(link);
                        link.click();
                        link.remove();
                      }}
                      className="border-2 border-gray-300 font-semibold"
                      aria-label="Download document"
                      disabled={!selectedDocUrl}
                    >
                      <Download className="h-4 w-4 mr-2" aria-hidden />
                      Download
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {selectedDocUrl ? (
                  selectedDocUrl.toLowerCase().endsWith('.pdf') ? (
                    <embed
                      src={`${selectedDocUrl}#view=FitH&navpanes=0`}
                      type="application/pdf"
                      className="w-full border-0"
                      style={{ height: '800px' }}
                      aria-label="Bid document preview"
                      title="Bid document preview"
                    />
                  ) : (
                    <div className="p-6 text-center text-sm text-gray-600">
                      Preview unavailable for this document type.{' '}
                      <Button
                        variant="ghost"                     // allowed
                        onClick={() =>
                          window.open(selectedDocUrl!, "_blank", "noopener,noreferrer")
                        }
                        className="p-0 h-auto text-blue-600 underline underline-offset-4"
                      >
                        Open in new tab
                      </Button>
                    </div>
                  )
                ) : (
                  <div className="p-8 text-center text-sm text-gray-500">
                    No document selected or PDF not available yet.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
