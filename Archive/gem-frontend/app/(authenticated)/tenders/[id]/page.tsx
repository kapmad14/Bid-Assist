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
  const [extractionLogs, setExtractionLogs] = useState<string[]>([]);
  const [clickedDocs, setClickedDocs] = useState<Set<string>>(new Set());

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
    if (amount === null || amount === undefined || amount === '') return 'N/A';
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

  const handlePreviewAdditionalDocs = async () => {
    if (!tender?.id) return;
    setIsExtracting(true);
    setExtractionLogs(['Starting URL extraction...']);

    try {
      // 🧩 Safety: if backend URL is missing, show a clear log and stop
      if (!API_BASE_URL) {
        setExtractionLogs(prev => [
          ...prev,
          'Error: Backend URL is not configured (NEXT_PUBLIC_API_BASE_URL)',
        ]);
        setIsExtracting(false);
        return;
      }

      const base = API_BASE_URL.replace(/\/+$/, ''); // remove trailing /
      const response = await fetch(`${base}/api/extract-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenderId: tender.id }),
      });


      if (!response.ok) {
        const txt = await response.text().catch(() => 'Non-JSON error');
        setExtractionLogs(prev => [
          ...prev,
          `Extraction API error: ${response.status} ${txt}`,
        ]);
        setIsExtracting(false);
        return;
      }

      let data: any;
      try {
        data = await response.json();
      } catch {
        setExtractionLogs(prev => [
          ...prev,
          'Invalid JSON from extraction API',
        ]);
        setIsExtracting(false);
        return;
      }

      if (data?.success) {
        setExtractionLogs(prev => [...prev, ...(data.logs || [])]);

        const formattedDocs = (data.documents || []).map(
          (doc: any, idx: number) =>
            ({
              id: String(doc.order ?? idx),
              filename: doc.filename || `document-${idx + 1}`,
              fileSize: doc.size ? String(doc.size) : 'N/A',
              fileType:
                (doc.filename || '')
                  .split('.')
                  .pop()
                  ?.toLowerCase() || 'unknown',
              storageUrl: doc.url ? encodeURI(String(doc.url)) : '',
              extractedAt: new Date().toISOString(),
            }) as ExtractedDocument,
        );

        setExtractedDocs(formattedDocs);
        setUrlsExtracted(true);

        setTimeout(() => {
          document
            .getElementById('documents-section')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 500);
      } else {
        setExtractionLogs(prev => [
          ...prev,
          `Error: ${data?.error || 'Unknown error'}`,
        ]);
      }
    } catch (error: any) {
      setExtractionLogs(prev => [
        ...prev,
        `Network error: ${error?.message || error}`,
      ]);
    } finally {
      if (mountedRef.current) setIsExtracting(false);
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
                  <Badge
                    variant={
                      status === 'Closed'
                        ? 'destructive'
                        : status === 'Closing Soon'
                          ? 'warning'
                          : 'success'
                    }
                    className="font-semibold"
                  >
                    {status}
                  </Badge>
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
                <div>
                  <p className="text-xs text-gray-600 font-semibold">
                    EMD Amount
                  </p>
                  <p className="font-bold text-sm text-gray-900">
                    {formatCurrency(tender.emd_amount)}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 font-semibold">
                      Consignee Address
                    </p>
                    <p className="font-bold text-sm text-gray-900">
                      {tender.city && tender.state
                        ? `${tender.city}, ${tender.state}${
                            tender.pincode ? ' - ' + tender.pincode : ''
                          }`
                        : tender.pincode || 'N/A'}
                    </p>
                  </div>

                  {/* Shortlist toggle */}
                  <div className="ml-4 self-end">
                    <button
                      onClick={handleShortlistToggle}
                      aria-pressed={isShortlisted}
                      aria-label={
                        isShortlisted
                          ? 'Remove from shortlist'
                          : 'Add to shortlist'
                      }
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border text-xs font-bold transition-all justify-center ${
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
                      <span className="ml-1">
                        {isShortlisted ? 'Shortlisted' : 'Shortlist'}
                      </span>
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Actions Card */}
            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900">
                  Actions
                </CardTitle>
                {urlsExtracted && (
                  <p className="text-xs text-green-600 font-semibold mt-1">
                    {extractedDocs.length} additional document
                    {extractedDocs.length !== 1 ? 's' : ''} found
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  className="
                    w-full 
                    bg-[#F7C846] hover:bg-[#e5b53d]
                    text-[#0E121A] font-bold
                    rounded-full
                    py-4 
                    shadow-md shadow-gray-300/50
                    disabled:bg-gray-300 disabled:cursor-not-allowed
                  "
                  onClick={handlePreviewAdditionalDocs}
                  disabled={isExtracting || urlsExtracted}
                >
                  {isExtracting && (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Preview Additional Docs
                </Button>

                <Button
                  className="
                    w-full
                    bg-black hover:bg-neutral-900
                    !text-white font-bold
                    rounded-full
                    py-4
                    shadow-md shadow-gray-300/50
                  "
                >
                  Analyze Tender with AI
                </Button>
              </CardContent>
            </Card>

            {/* BoQ Items Placeholder Card */}
            {/* BoQ Items Placeholder Card */}
            {/* BoQ Items Card */}
            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900">
                  BoQ Items
                </CardTitle>
                <p className="text-xs text-gray-600 mt-1">
                  Bill of Quantities from this tender.
                </p>
              </CardHeader>

              <CardContent className="space-y-2 text-sm">
                {(() => {
                  let boqArray: any[] | null = null;

                  if (tender.boq_items) {
                    try {
                      // Handle both JSON string and already-parsed JSON
                      boqArray =
                        typeof tender.boq_items === 'string'
                          ? JSON.parse(tender.boq_items)
                          : tender.boq_items;
                    } catch (err) {
                      console.error('BoQ parse failed:', err);
                    }
                  }

                  if (!boqArray || boqArray.length === 0) {
                    return (
                      <p className="text-gray-500">
                        BoQ items are not available for this tender yet.
                      </p>
                    );
                  }

                  return (
                    <div className="space-y-3">
                      {boqArray.slice(0, 5).map((item: any, i: number) => (
                        <div
                          key={i}
                          className="p-3 border border-gray-200 rounded-xl bg-white"
                        >
                          <p className="font-bold text-sm text-gray-900">
                            {item.item_title || `Item ${i + 1}`}
                          </p>

                          {item.category && (
                            <p className="text-[10px] font-semibold text-blue-700 mt-1">
                              {item.category}
                            </p>
                          )}

                          {item.quantity && (
                            <p className="text-xs text-gray-600">
                              Qty: {item.quantity} {item.unit || ''}
                            </p>
                          )}

                          {item.delivery_days && (
                            <p className="text-xs text-gray-600">
                              Delivery: {item.delivery_days} days
                            </p>
                          )}

                          {item.specifications && (
                            <p className="text-xs text-gray-500 mt-1 line-clamp-2">
                              {item.specifications}
                            </p>
                          )}
                        </div>
                      ))}

                      {boqArray.length > 5 && (
                        <p className="text-xs font-medium text-blue-600">
                          +{boqArray.length - 5} more items…
                        </p>
                      )}
                    </div>
                  );
                })()}
              </CardContent>
            </Card>

            {/* Extraction Logs */}
            {extractionLogs.length > 0 && (
              <Card className="border-2 border-gray-200">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-bold text-gray-900">
                      Extraction Logs
                    </CardTitle>
                    <Button
                      variant="ghost"
                      onClick={() => setExtractionLogs([])}
                      className="font-semibold text-xs px-2 py-1"
                      aria-label="Clear extraction logs"
                    >
                      Clear extraction logs
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div
                    className="bg-gray-900 text-green-400 p-3 rounded text-xs font-mono max-h-48 overflow-y-auto"
                    aria-live="polite"
                  >
                    {extractionLogs.map((log, idx) => (
                      <div key={idx} className="mb-1">
                        {`> ${log}`}
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right Column - Documents + Preview */}
          <div className="lg:col-span-2 space-y-4">
            {/* Additional Documents List */}
            {extractedDocs.length > 0 && (
              <Card id="documents-section" className="border-2 border-gray-200">
                <CardHeader className="border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-bold text-gray-900">
                      Additional Documents
                    </CardTitle>
                    <Badge variant="success" className="text-xs font-semibold">
                      {extractedDocs.length} document
                      {extractedDocs.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {extractedDocs.map(doc => (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between p-3 border-2 border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {getFileIcon(doc.fileType)}
                        <div>
                          <p className="font-bold text-sm text-gray-900">
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
                          onClick={() => handleDownload(doc.storageUrl)}
                          className="font-semibold"
                          aria-label={`Download ${doc.filename}`}
                        >
                          <Download className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() =>
                            handleDocumentAction(
                              doc.id,
                              doc.storageUrl,
                              doc.fileType,
                            )
                          }
                          className={`font-semibold ${
                            clickedDocs.has(doc.id)
                              ? 'text-gray-400'
                              : 'text-blue-600'
                          }`}
                          aria-label={
                            canPreview(doc.fileType)
                              ? `Preview ${doc.filename}`
                              : `Open ${doc.filename}`
                          }
                        >
                          {canPreview(doc.fileType) ? (
                            <>
                              <Eye className="h-4 w-4 mr-1" aria-hidden />
                              Preview
                            </>
                          ) : (
                            <>
                              <ExternalLink
                                className="h-4 w-4 mr-1"
                                aria-hidden
                              />
                              Visit Link
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

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
