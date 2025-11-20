'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
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
  Star
} from 'lucide-react';

import { tenderStore } from '@/services/tenderStore';

interface Tender {
  id: number;
  bid_number: string;
  item_category_parsed: string;
  ministry: string;
  department: string;
  organization_name_parsed: string;
  bid_end_datetime: string;
  bid_date: string;
  emd_amount_parsed: string;
  total_quantity_parsed: string;
  organization_type: string;
  pincode: string;
  state: string;
  city: string;
  product_description: string;
  source_url: string;
  pdf_storage_path: string;
  gem_bid_id: string;
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
  const supabase = createClient();
  const tenderIdParam = params?.id;
  const tenderIdNum = tenderIdParam ? Number(tenderIdParam) : NaN;
  
  const [tender, setTender] = useState<Tender | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Document extraction states
  const [isExtracting, setIsExtracting] = useState(false);
  const [urlsExtracted, setUrlsExtracted] = useState(false);
  const [extractedDocs, setExtractedDocs] = useState<ExtractedDocument[]>([]);
  const [selectedDocUrl, setSelectedDocUrl] = useState<string | null>(null);
  const [extractionLogs, setExtractionLogs] = useState<string[]>([]);
  const [clickedDocs, setClickedDocs] = useState<Set<string>>(new Set());

  // Shortlist state (client-side, optimistic)
  const [isShortlisted, setIsShortlisted] = useState<boolean>(false);
  const shortlistPendingRef = useRef(false);

  // useRef to prevent setting state after unmount / race conditions
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
        const { data, error } = await supabase
          .from('tenders')
          .select('*')
          .eq('id', tenderIdNum)
          .single();

        if (error) throw error;
        if (!mountedRef.current) return;

        setTender(data);

        // initialize shortlist state from tenderStore (local cache)
        try {
          const idStr = data?.id != null ? String(data.id) : '';
          setIsShortlisted(tenderStore.isShortlisted(idStr));
        } catch (e) {
          // ignore
        }

        // Get PDF URL from Supabase Storage (only if path exists)
        if (data?.pdf_storage_path) {
          try {
            const publicUrlResponse = supabase.storage
              .from('gem-pdfs')
              .getPublicUrl(data.pdf_storage_path || '');

            const publicUrl = publicUrlResponse?.data?.publicUrl || null;
            if (publicUrl) {
              // Basic safety: only accept http(s)
              if (/^https?:\/\//i.test(publicUrl)) {
                const safeUrl = encodeURI(publicUrl);
                setPdfUrl(safeUrl);
                setSelectedDocUrl(safeUrl);
              } else {
                console.warn('Public URL has unsupported protocol', publicUrl);
              }
            }
          } catch (pdfErr) {
            console.error('Error loading PDF URL:', pdfErr);
          }
        }
      } catch (err: any) {
        if (!mountedRef.current) return;
        setError(err?.message || 'Failed to load tender');
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }

    fetchTender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderIdParam]); // don't include supabase as dep (stable client)

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'N/A';
    const d = new Date(dateString);
    if (Number.isNaN(d.getTime())) return 'N/A';
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount?: string | null) => {
    if (!amount) return 'N/A';
    const num = parseFloat(String(amount));
    if (Number.isNaN(num)) return 'N/A';
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(num);
  };

  const getTenderStatus = () => {
    if (!tender?.bid_end_datetime) return 'Unknown';
    const endDate = new Date(tender.bid_end_datetime);
    const today = new Date();
    
    if (endDate < today) return 'Closed';
    
    const diffDays = Math.ceil((endDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 7) return 'Urgent';
    
    return 'Open';
  };

  const handleShortlistToggle = async () => {
    if (!tender?.id || shortlistPendingRef.current) return;
    shortlistPendingRef.current = true;

    // optimistic update
    setIsShortlisted(prev => !prev);
    try {
      // tenderStore.toggleShortlist may return either void or an object; handle both.
      const result = await (tenderStore.toggleShortlist(String(tender.id)) as any);
      // if it returns object with persisted===false and reason === 'server-error-*', we may rollback.
      if (result && result.persisted === false && result.reason?.startsWith('server-error')) {
        // rollback optimistic
        setIsShortlisted(prev => !prev);
      } else {
        // success or unauthenticated (still local); keep optimistic state
      }
    } catch (err) {
      console.error('Shortlist toggle failed:', err);
      // rollback
      setIsShortlisted(prev => !prev);
    } finally {
      shortlistPendingRef.current = false;
    }
  };

  const handleDownload = (url: string | null) => {
    if (url) {
      // prefer opening in new tab to avoid download issues
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  };

  const handlePreviewAdditionalDocs = async () => {
    if (!tender?.id) return;
    setIsExtracting(true);
    setExtractionLogs(['Starting URL extraction...']);
    
    try {
      const response = await fetch('/api/extract-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenderId: tender.id })
      });

      if (!response.ok) {
        const txt = await response.text().catch(() => 'Non-JSON error');
        setExtractionLogs(prev => [...prev, `Extraction API error: ${response.status} ${txt}`]);
        setIsExtracting(false);
        return;
      }
      
      let data: any;
      try {
        data = await response.json();
      } catch (err) {
        setExtractionLogs(prev => [...prev, 'Invalid JSON from extraction API']);
        setIsExtracting(false);
        return;
      }
      
      if (data?.success) {
        setExtractionLogs(prev => [...prev, ...(data.logs || [])]);

        const formattedDocs = (data.documents || []).map((doc: any, idx: number) => ({
          id: String(doc.order ?? idx),
          filename: doc.filename || `document-${idx + 1}`,
          fileSize: doc.size ? String(doc.size) : 'N/A',
          fileType: (doc.filename || '').split('.').pop()?.toLowerCase() || 'unknown',
          storageUrl: doc.url ? encodeURI(String(doc.url)) : '',
          extractedAt: new Date().toISOString()
        })) as ExtractedDocument[];
        
        setExtractedDocs(formattedDocs);
        setUrlsExtracted(true);
        
        // scroll into view after short delay
        setTimeout(() => {
          document.getElementById('documents-section')?.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }, 500);
      } else {
        setExtractionLogs(prev => [...prev, `Error: ${data?.error || 'Unknown error'}`]);
      }
    } catch (error: any) {
      setExtractionLogs(prev => [...prev, `Network error: ${error?.message || error}`]);
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
    if (canPreview(fileType)) {
      // try open in new tab for now; embed support is used for main bid doc only
      window.open(url, '_blank', 'noopener,noreferrer');
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
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
          <Loader2 className="w-8 h-8 text-[#F7C846] animate-spin" aria-hidden />
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
          <Button onClick={() => router.push('/tenders')}>Back to All Tenders</Button>
        </div>
      </div>
    );
  }

  const status = getTenderStatus();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Prominent Back Button */}
      <div className="bg-white border-b-2 border-gray-200 px-4 py-4 shadow-sm">
        <div className="container mx-auto">
          <Button 
            onClick={() => router.push('/tenders')}
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
          
          {/* Left Column - Tender Details */}
          <div className="lg:col-span-1 space-y-4">

            {/* Tender Details Card */}
            <Card className="border-2 border-gray-200">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle className="text-base font-bold text-gray-900">Tender Details</CardTitle>
                  </div>
                  <Badge 
                    variant={
                      status === 'Closed' ? 'destructive' : 
                      status === 'Urgent' ? 'warning' : 
                      'success'
                    }
                    className="font-semibold"
                  >
                    {status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-gray-600 font-semibold">Bid Number</p>
                  <p className="font-bold text-sm text-gray-900">{tender.bid_number}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-semibold">Closing Date</p>
                  <p className="font-bold text-sm text-gray-900">{formatDate(tender.bid_end_datetime)}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-semibold">Item Category</p>
                  <p className="font-bold text-sm text-gray-900">{tender.item_category_parsed || 'N/A'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-600 font-semibold">EMD Amount</p>
                  <p className="font-bold text-sm text-gray-900">{formatCurrency(tender.emd_amount_parsed)}</p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-gray-600 font-semibold">Consignee Address</p>
                    <p className="font-bold text-sm text-gray-900">
                      {tender.city && tender.state 
                        ? `${tender.city}, ${tender.state}${tender.pincode ? ' - ' + tender.pincode : ''}` 
                        : tender.pincode || 'N/A'}
                    </p>
                  </div>

                  {/* Shortlist toggle in bottom-right of Tender Details card */}
                  <div className="ml-4 self-end">
                    <button
                      onClick={handleShortlistToggle}
                      aria-pressed={isShortlisted}
                      className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm font-semibold transition ${
                        isShortlisted ? 'bg-black text-white border border-black' : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                      }`}
                      aria-label={isShortlisted ? 'Remove from shortlist' : 'Add to shortlist'}
                    >
                      <Star className={`w-4 h-4 ${isShortlisted ? 'fill-current' : ''}`} aria-hidden />
                      {isShortlisted ? 'Shortlisted' : 'Shortlist'}
                    </button>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Actions Card */}
            <Card className="border-2 border-gray-200">
              <CardHeader>
                <CardTitle className="text-base font-bold text-gray-900">Actions</CardTitle>
                {urlsExtracted && (
                  <p className="text-xs text-green-600 font-semibold mt-1">
                    {extractedDocs.length} additional document{extractedDocs.length !== 1 ? 's' : ''} found
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Preview Additional Docs — yellow pill, same as “Recommended for Me” */}
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
                  {isExtracting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Preview Additional Docs
                </Button>

                {/* Analyze Tender with AI — blue pill with white text */}
                <Button
                  className="
                    w-full
                    bg-blue-600 hover:bg-blue-700
                    !text-white font-bold
                    rounded-full
                    py-4
                    shadow-md shadow-gray-300/50
                  "
                >
                  Analyze Tender with AI
                </Button>


                {/* removed Mark as Submitted & Mark as Won/Lost per request */}
              </CardContent>
            </Card>

            {/* Extraction Logs */}
            {extractionLogs.length > 0 && (
              <Card className="border-2 border-gray-200">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-bold text-gray-900">Extraction Logs</CardTitle>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setExtractionLogs([])}
                      className="font-semibold"
                      aria-label="Clear extraction logs"
                    >
                      Clear
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="bg-gray-900 text-green-400 p-3 rounded text-xs font-mono max-h-48 overflow-y-auto" aria-live="polite">
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

          {/* Right Column - Documents */}
          <div className="lg:col-span-2 space-y-4">
            
            {/* Additional Documents List */}
            {extractedDocs.length > 0 && (
              <Card id="documents-section" className="border-2 border-gray-200">
                <CardHeader className="border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base font-bold text-gray-900">Additional Documents</CardTitle>
                    <Badge variant="success" className="text-xs font-semibold">
                      {extractedDocs.length} document{extractedDocs.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {extractedDocs.map((doc) => (
                    <div 
                      key={doc.id}
                      className="flex items-center justify-between p-3 border-2 border-gray-200 rounded-lg bg-white hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {getFileIcon(doc.fileType)}
                        <div>
                          <p className="font-bold text-sm text-gray-900">{doc.filename}</p>
                          <p className="text-xs text-gray-600 font-medium">additional document • {doc.fileType}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleDownload(doc.storageUrl)}
                          className="font-semibold"
                          aria-label={`Download ${doc.filename}`}
                        >
                          <Download className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleDocumentAction(doc.id, doc.storageUrl, doc.fileType)}
                          className={`font-semibold ${clickedDocs.has(doc.id) ? 'text-gray-400' : 'text-blue-600'}`}
                          aria-label={canPreview(doc.fileType) ? `Preview ${doc.filename}` : `Open ${doc.filename}`}
                        >
                          {canPreview(doc.fileType) ? (
                            <>
                              <Eye className="h-4 w-4 mr-1" aria-hidden />
                              Preview
                            </>
                          ) : (
                            <>
                              <ExternalLink className="h-4 w-4 mr-1" aria-hidden />
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
              <CardHeader className="border-b">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-bold text-gray-900">Bid Document Preview</CardTitle>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => selectedDocUrl ? window.open(selectedDocUrl, '_blank', 'noopener,noreferrer') : null}
                      className="border-2 border-gray-300 font-semibold"
                      aria-label="Open document full screen"
                      disabled={!selectedDocUrl}
                    >
                      <ExternalLink className="h-4 w-4 mr-2" aria-hidden />
                      Open Full Screen
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        if (!selectedDocUrl) return;
                        const link = document.createElement('a');
                        link.href = selectedDocUrl;
                        link.download = tender.pdf_storage_path?.split('/').pop() || 'document.pdf';
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
                  // Only embed if it's a PDF (more reliable)
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
                      Preview unavailable for this document type. <Button variant="link" onClick={() => window.open(selectedDocUrl, '_blank', 'noopener,noreferrer')}>Open in new tab</Button>
                    </div>
                  )
                ) : (
                  <div className="p-8 text-center text-sm text-gray-500">No document selected</div>
                )}
              </CardContent>
            </Card>

          </div>

        </div>
      </div>
    </div>
  );
}
