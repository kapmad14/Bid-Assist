'use client';

import { useEffect, useState } from 'react';
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
  Image as ImageIcon
} from 'lucide-react';

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
  const tenderId = params.id;
  
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

  useEffect(() => {
    async function fetchTender() {
      try {
        const { data, error } = await supabase
          .from('tenders')
          .select('*')
          .eq('id', tenderId)
          .single();

        if (error) throw error;
        setTender(data);

        // Get PDF URL from Supabase Storage
        if (data.pdf_storage_path) {
          try {
            const publicUrlResponse = supabase.storage
              .from('gem-pdfs')
              .getPublicUrl(data.pdf_storage_path);
            
            if (publicUrlResponse.data && publicUrlResponse.data.publicUrl) {
              setPdfUrl(publicUrlResponse.data.publicUrl);
              setSelectedDocUrl(publicUrlResponse.data.publicUrl);
            }
          } catch (pdfErr) {
            console.error('Error loading PDF URL:', pdfErr);
          }
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    if (tenderId) {
      fetchTender();
    }
  }, [tenderId, supabase]);

  const formatDate = (dateString: string) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const formatCurrency = (amount: string) => {
    if (!amount) return 'N/A';
    const num = parseFloat(amount);
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

  const handleDownload = (url: string) => {
    if (url) {
      window.open(url, '_blank');
    }
  };

  const handlePreviewAdditionalDocs = async () => {
    setIsExtracting(true);
    setExtractionLogs(['Starting URL extraction...']);
    
    try {
      const response = await fetch('/api/extract-documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenderId: tender?.id })
      });
      
      const data = await response.json();
      
      if (data.success) {
        setExtractionLogs(data.logs || []);
        
        const formattedDocs = data.documents.map((doc: any) => ({
          id: doc.order.toString(),
          filename: doc.filename,
          fileSize: 'N/A',
          fileType: doc.filename.split('.').pop()?.toLowerCase() || 'unknown',
          storageUrl: doc.url,
          extractedAt: new Date().toISOString()
        }));
        
        setExtractedDocs(formattedDocs);
        setUrlsExtracted(true);
        
        setTimeout(() => {
          document.getElementById('documents-section')?.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }, 500);
      } else {
        setExtractionLogs(prev => [...prev, `Error: ${data.error}`]);
      }
    } catch (error: any) {
      setExtractionLogs(prev => [...prev, `Error: ${error.message}`]);
    } finally {
      setIsExtracting(false);
    }
  };

  const canPreview = (fileType: string): boolean => {
    const previewableTypes = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp'];
    return previewableTypes.includes(fileType.toLowerCase());
  };

  const handleDocumentAction = (docId: string, url: string, fileType: string) => {
    setClickedDocs(prev => new Set(prev).add(docId));
    window.open(url, '_blank');
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
          <Loader2 className="w-8 h-8 text-[#F7C846] animate-spin" />
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
            <ArrowLeft className="h-5 w-5 mr-2" />
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
                <div>
                  <p className="text-xs text-gray-600 font-semibold">Consignee Address</p>
                  <p className="font-bold text-sm text-gray-900">
                    {tender.city && tender.state 
                      ? `${tender.city}, ${tender.state}${tender.pincode ? ' - ' + tender.pincode : ''}` 
                      : tender.pincode || 'N/A'}
                  </p>
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
                <Button 
                  className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold"
                  onClick={handlePreviewAdditionalDocs}
                  disabled={isExtracting || urlsExtracted}
                >
                  {isExtracting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Preview Additional Docs
                </Button>
                <Button className="w-full bg-[#F7C846] hover:bg-[#F7C846]/90 text-[#0E121A] font-bold">
                  Proceed To Analyse Tender
                </Button>
                <Button variant="outline" className="w-full border-2 border-gray-300 font-semibold">
                  Mark as Submitted
                </Button>
                <Button variant="outline" className="w-full border-2 border-gray-300 font-semibold">
                  Mark as Won/Lost
                </Button>
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
                    >
                      Clear
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="bg-gray-900 text-green-400 p-3 rounded text-xs font-mono max-h-48 overflow-y-auto">
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
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleDocumentAction(doc.id, doc.storageUrl, doc.fileType)}
                          className={`font-semibold ${clickedDocs.has(doc.id) ? 'text-gray-400' : 'text-blue-600'}`}
                        >
                          {canPreview(doc.fileType) ? (
                            <>
                              <Eye className="h-4 w-4 mr-1" />
                              Preview
                            </>
                          ) : (
                            <>
                              <ExternalLink className="h-4 w-4 mr-1" />
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
                      onClick={() => window.open(selectedDocUrl || '', '_blank')}
                      className="border-2 border-gray-300 font-semibold"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Open Full Screen
                    </Button>
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = selectedDocUrl || '';
                        link.download = tender.pdf_storage_path?.split('/').pop() || 'document.pdf';
                        link.click();
                      }}
                      className="border-2 border-gray-300 font-semibold"
                    >
                      <Download className="h-4 w-4 mr-2" />
                      Download
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {selectedDocUrl && (
                  <embed
                    src={`${selectedDocUrl}#view=FitH&navpanes=0`}
                    type="application/pdf"
                    className="w-full border-0"
                    style={{ height: '800px' }}
                  />
                )}
              </CardContent>
            </Card>

          </div>

        </div>
      </div>
    </div>
  );
}
