import PyPDF2
import re
import os
import sys
import json
from urllib.parse import urlparse
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv('/Users/kapilmadan/Projects/Bid-Assist/.env')

SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SERVICE_ROLE_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print(json.dumps({'success': False, 'error': 'Missing Supabase credentials'}))
    sys.exit(1)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

def extract_urls_from_pdf(pdf_path: str) -> list:
    """Extract all URLs from a PDF file"""
    urls = []
    
    try:
        with open(pdf_path, 'rb') as file:
            reader = PyPDF2.PdfReader(file)
            
            # Method 1: Extract from annotations
            for page in reader.pages:
                if '/Annots' in page:
                    try:
                        for annot in page['/Annots']:
                            obj = annot.get_object()
                            if '/A' in obj and '/URI' in obj['/A']:
                                url = obj['/A']['/URI']
                                urls.append(url)
                    except:
                        pass
            
            # Method 2: Extract from text using regex
            for page in reader.pages:
                try:
                    text = page.extract_text()
                    found_urls = re.findall(
                        r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', 
                        text
                    )
                    urls.extend(found_urls)
                except:
                    pass
        
        return list(set(urls))
    except Exception as e:
        return []

def extract_tender_document_urls(tender_id: int) -> dict:
    """Extract document URLs from tender PDF without downloading files"""
    logs = []
    
    try:
        logs.append(f"Starting URL extraction for tender ID: {tender_id}")
        
        # 1. Fetch tender
        response = supabase.table('tenders').select('*').eq('id', tender_id).execute()
        
        if not response.data or len(response.data) == 0:
            return {'success': False, 'error': 'Tender not found', 'logs': logs}
        
        tender_data = response.data[0]
        
        if not tender_data.get('pdf_storage_path'):
            return {'success': False, 'error': 'Tender PDF not found', 'logs': logs}
        
        # 2. Download tender PDF from storage
        logs.append("Downloading tender PDF...")
        pdf_path = f"/tmp/tender_{tender_id}.pdf"
        
        try:
            pdf_data = supabase.storage.from_('gem-pdfs').download(tender_data['pdf_storage_path'])
            with open(pdf_path, 'wb') as f:
                f.write(pdf_data)
        except Exception as e:
            return {'success': False, 'error': f'Failed to download PDF: {str(e)}', 'logs': logs}
        
        # 3. Extract URLs
        logs.append("Extracting document URLs...")
        urls = extract_urls_from_pdf(pdf_path)
        logs.append(f"Found {len(urls)} document links")
        
        if len(urls) == 0:
            logs.append("No additional document URLs found")
            return {'success': True, 'documents': [], 'logs': logs}
        
        # 4. Format URL list
        extracted_links = []
        for idx, url in enumerate(urls[:10], 1):  # Limit to 10
            filename = os.path.basename(urlparse(url).path)
            if not filename or filename == '':
                filename = f"document_{idx}.pdf"
            
            extracted_links.append({
                'url': url,
                'filename': filename,
                'order': idx
            })
            logs.append(f"✓ Found: {filename}")
        
        logs.append("URL extraction completed!")
        
        # Cleanup
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        
        return {
            'success': True,
            'documents': extracted_links,
            'logs': logs
        }
        
    except Exception as e:
        logs.append(f"Error: {str(e)}")
        return {
            'success': False,
            'error': str(e),
            'logs': logs
        }

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Tender ID required'}))
        sys.exit(1)
    
    try:
        tender_id = int(sys.argv[1])
        result = extract_tender_document_urls(tender_id)
        print(json.dumps(result))
    except ValueError:
        print(json.dumps({'success': False, 'error': 'Invalid tender ID'}))
        sys.exit(1)
