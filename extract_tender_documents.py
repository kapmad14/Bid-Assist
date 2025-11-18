import PyPDF2
import requests
import re
import os
import sys
import json
from datetime import datetime
from urllib.parse import urlparse
from dotenv import load_dotenv
from supabase import create_client, Client

# Load environment variables
load_dotenv()

# Initialize Supabase
SUPABASE_URL = os.getenv('SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_KEY_SERVICE')

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
                    # Find URLs in text
                    found_urls = re.findall(
                        r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+', 
                        text
                    )
                    urls.extend(found_urls)
                except:
                    pass
        
        # Remove duplicates
        return list(set(urls))
    except Exception as e:
        return []

def download_document(url: str, save_path: str) -> dict:
    """Download a document from URL"""
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        response = requests.get(url, timeout=30, allow_redirects=True, headers=headers)
        response.raise_for_status()
        
        # Save file
        with open(save_path, 'wb') as f:
            f.write(response.content)
        
        # Get file info
        file_size = len(response.content)
        content_type = response.headers.get('Content-Type', '')
        
        return {
            'success': True,
            'file_size': file_size,
            'content_type': content_type,
            'filename': os.path.basename(save_path)
        }
    except Exception as e:
        return {
            'success': False,
            'error': str(e)
        }

    
def upload_to_supabase_storage(local_path: str, storage_path: str, bucket: str = 'gem-pdfs') -> str:
    """Upload file to Supabase Storage"""
    try:
        with open(local_path, 'rb') as f:
            file_data = f.read()
        
        # Check if file exists, if so, delete it first
        try:
            existing_file = supabase.storage.from_(bucket).list(path=os.path.dirname(storage_path))
            file_exists = any(f['name'] == os.path.basename(storage_path) for f in existing_file)
            
            if file_exists:
                # Remove existing file
                supabase.storage.from_(bucket).remove([storage_path])
        except:
            pass  # File doesn't exist, that's fine
        
        # Upload to storage
        result = supabase.storage.from_(bucket).upload(
            storage_path,
            file_data,
            file_options={'content-type': 'application/octet-stream', 'upsert': 'true'}
        )
        
        # Get public URL
        public_url_response = supabase.storage.from_(bucket).get_public_url(storage_path)
        
        return public_url_response
    except Exception as e:
        raise Exception(f"Storage upload failed: {str(e)}")


def extract_tender_documents(tender_id: int) -> dict:
    """Main function to extract documents for a tender"""
    logs = []
    extracted_docs = []
    
    try:
        # 1. Fetch tender info
        logs.append(f"Starting extraction for tender ID: {tender_id}")
        
        response = supabase.table('tenders').select('*').eq('id', tender_id).execute()
        
        if not response.data or len(response.data) == 0:
            return {'success': False, 'error': 'Tender not found', 'logs': logs}
        
        tender_data = response.data[0]
        
        if not tender_data.get('pdf_storage_path'):
            return {'success': False, 'error': 'Tender PDF not found', 'logs': logs}
        
        # 2. Download tender PDF from storage
        logs.append("Downloading tender PDF from storage...")
        pdf_path = f"/tmp/tender_{tender_id}.pdf"
        
        try:
            pdf_data = supabase.storage.from_('gem-pdfs').download(tender_data['pdf_storage_path'])
            with open(pdf_path, 'wb') as f:
                f.write(pdf_data)
        except Exception as e:
            return {'success': False, 'error': f'Failed to download PDF: {str(e)}', 'logs': logs}
        
        # 3. Extract URLs from PDF
        logs.append("Parsing PDF for URLs...")
        urls = extract_urls_from_pdf(pdf_path)
        logs.append(f"Found {len(urls)} document links")
        
        if len(urls) == 0:
            return {'success': False, 'error': 'No URLs found in PDF', 'logs': logs}
        
        # 4. Download each document
        for idx, url in enumerate(urls[:10], 1):  # Limit to 10 documents
            logs.append(f"Processing document {idx}/{min(len(urls), 10)}: {url}")
            
            # Generate filename from URL
            filename = os.path.basename(urlparse(url).path)
            if not filename or filename == '':
                filename = f"document_{idx}.pdf"
            
            # Download document
            local_path = f"/tmp/{filename}"
            download_result = download_document(url, local_path)
            
            if download_result['success']:
                try:
                    # Upload to Supabase Storage
                    storage_path = f"extracted/{tender_id}/{filename}"
                    public_url = upload_to_supabase_storage(local_path, storage_path)
                    
                    # Save to database
                    doc_record = {
                        'tender_id': tender_id,
                        'filename': filename,
                        'file_size': download_result['file_size'],
                        'file_type': filename.split('.')[-1].lower() if '.' in filename else 'pdf',
                        'storage_path': storage_path,
                        'source_url': url,
                        'order_index': idx
                    }
                    
                    insert_result = supabase.table('tender_documents').insert(doc_record).execute()
                    
                    if insert_result.data:
                        extracted_docs.append(insert_result.data[0])
                        logs.append(f"✓ Successfully extracted: {filename}")
                    
                    # Cleanup
                    if os.path.exists(local_path):
                        os.remove(local_path)
                        
                except Exception as e:
                    logs.append(f"✗ Failed to upload {filename}: {str(e)}")
            else:
                logs.append(f"✗ Failed to download: {url} - {download_result.get('error', 'Unknown error')}")
        
        # 5. Update tender status
        supabase.table('tenders').update({
            'documents_extracted': True,
            'extraction_status': 'completed',
            'extraction_logs': logs,
            'extracted_at': datetime.now().isoformat()
        }).eq('id', tender_id).execute()
        
        logs.append("Extraction completed successfully!")
        
        # Cleanup main PDF
        if os.path.exists(pdf_path):
            os.remove(pdf_path)
        
        return {
            'success': True,
            'documents': extracted_docs,
            'logs': logs
        }
        
    except Exception as e:
        logs.append(f"Error: {str(e)}")
        
        # Update tender with error status
        try:
            supabase.table('tenders').update({
                'extraction_status': 'failed',
                'extraction_logs': logs
            }).eq('id', tender_id).execute()
        except:
            pass
        
        return {
            'success': False,
            'error': str(e),
            'logs': logs
        }

# Main execution
if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Tender ID required'}))
        sys.exit(1)
    
    try:
        tender_id = int(sys.argv[1])
        result = extract_tender_documents(tender_id)
        print(json.dumps(result))
    except ValueError:
        print(json.dumps({'success': False, 'error': 'Invalid tender ID'}))
        sys.exit(1)
