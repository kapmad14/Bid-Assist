'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
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

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
  }, [tenderId]);

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
        
        // Just URLs - no file downloads!
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
    // Mark as clicked (turns button grey)
    setClickedDocs(prev => new Set(prev).add(docId));
    
    // Open in new tab
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
        <p className="text-center text-lg">Loading tender details...</p>
      </div>
    );
  }

  if (error || !tender) {
    return (
      <div className="container mx-auto px-4 py-8">
        <p className="text-center text-lg text-red-600">
          Error loading tender: {error || 'Tender not found'}
        </p>
        <div className="text-center mt-4">
          <Link href="/tenders">
            <Button>Back to All Tenders</Button>
          </Link>
        </div>
      </div>
    );
  }

  const status = getTenderStatus();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Back Button */}
      <div className="bg-white border-b px-4 py-3">
        <div className="container mx-auto">
          <Link href="/tenders">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to All Tenders
            </Button>
          </Link>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column - Tender Details */}
          <div className="lg:col-span-1 space-y-4">

            {/* Tender Details Card */}
            <Card>
            <CardHeader>
                <div className="flex items-start justify-between">
                <div className="flex-1">
                    <CardTitle className="text-base">Tender Details</CardTitle>
                </div>
                <Badge 
                    variant={
                    status === 'Closed' ? 'destructive' : 
                    status === 'Urgent' ? 'warning' : 
                    'success'
                    }
                >
                    {status}
                </Badge>
                </div>
            </CardHeader>
            <CardContent className="space-y-3">
                <div>
                <p className="text-xs text-gray-500">Bid Number</p>
                <p className="font-medium text-sm">{tender.bid_number}</p>
                </div>
                <div>
                <p className="text-xs text-gray-500">Closing Date</p>
                <p className="font-medium text-sm">{formatDate(tender.bid_end_datetime)}</p>
                </div>
                <div>
                <p className="text-xs text-gray-500">Item Category</p>
                <p className="font-medium text-sm">{tender.item_category_parsed || 'N/A'}</p>
                </div>
                <div>
                <p className="text-xs text-gray-500">EMD Amount</p>
                <p className="font-medium text-sm">{formatCurrency(tender.emd_amount_parsed)}</p>
                </div>
                <div>
                <p className="text-xs text-gray-500">Consignee Address</p>
                <p className="font-medium text-sm">
                    {tender.city && tender.state 
                    ? `${tender.city}, ${tender.state}${tender.pincode ? ' - ' + tender.pincode : ''}` 
                    : tender.pincode || 'N/A'}
                </p>
                </div>
            </CardContent>
            </Card>


            {/* Actions Card */}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
                {urlsExtracted && (
                  <p className="text-xs text-green-600 mt-1">
                    {extractedDocs.length} additional document{extractedDocs.length !== 1 ? 's' : ''} found
                  </p>
                )}
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  onClick={handlePreviewAdditionalDocs}
                  disabled={isExtracting || urlsExtracted}
                >
                  {isExtracting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Preview Additional Docs
                </Button>
                <Button className="w-full bg-pink-400 hover:bg-pink-500">
                  Proceed To Analyse Tender
                </Button>
                <Button variant="outline" className="w-full">
                  Mark as Submitted
                </Button>
                <Button variant="outline" className="w-full">
                  Mark as Won/Lost
                </Button>
              </CardContent>
            </Card>

            {/* Extraction Logs */}
            {extractionLogs.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Extraction Logs</CardTitle>
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => setExtractionLogs([])}
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
              <Card id="documents-section">
                <CardHeader className="border-b">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Additional Documents</CardTitle>
                    <Badge variant="success" className="text-xs">
                      {extractedDocs.length} document{extractedDocs.length !== 1 ? 's' : ''}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="p-4 space-y-3">
                  {extractedDocs.map((doc) => (
                    <div 
                      key={doc.id}
                      className="flex items-center justify-between p-3 border rounded-lg bg-white hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {getFileIcon(doc.fileType)}
                        <div>
                          <p className="font-medium text-sm">{doc.filename}</p>
                          <p className="text-xs text-gray-500">additional document • {doc.fileType}</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleDownload(doc.storageUrl)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleDocumentAction(doc.id, doc.storageUrl, doc.fileType)}
                          className={clickedDocs.has(doc.id) ? 'text-gray-400' : 'text-blue-600'}
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
            <Card>
            <CardHeader className="border-b">
                <div className="flex items-center justify-between">
                <CardTitle className="text-base">Bid Document Preview</CardTitle>
                {/* Custom toolbar buttons */}
                <div className="flex gap-2">
                    <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => window.open(selectedDocUrl || '', '_blank')}
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
