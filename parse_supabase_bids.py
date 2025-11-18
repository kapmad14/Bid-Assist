"""
Parse PDFs directly from Supabase Storage /bids folder
No local downloads needed - all cloud-to-cloud
"""

import os
import io
from supabase import create_client
from dotenv import load_dotenv
from openai import OpenAI
import pdfplumber
from datetime import datetime
import time

load_dotenv()

# Initialize clients
supabase = create_client(
    os.getenv('SUPABASE_URL'),
    os.getenv('SUPABASE_KEY_SERVICE')
)

openai_client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

def extract_text_from_pdf_bytes(pdf_bytes):
    """Extract text from PDF bytes"""
    text_content = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                text_content.append(text)
    return '\n'.join(text_content)

def parse_with_gpt(pdf_text):
    """Parse tender using GPT-3.5-Turbo"""
    
    prompt = f"""You are a GeM tender document parser. Extract the following 39 fields from this tender document.
Return ONLY a valid JSON object with these exact field names. Use null for missing values.

Required fields:
{{
  "bid_number": "string - e.g., GEM/2025/B/1234567",
  "bid_date": "YYYY-MM-DD",
  "bid_end_datetime": "YYYY-MM-DD HH:MM:SS+05:30",
  "total_quantity": number,
  "item_category": "string",
  
  "mse_turnover_exemption": boolean,
  "startup_turnover_exemption": boolean,
  "oem_avg_turnover": number,
  "required_experience_years": number,
  "mse_experience_exemption": boolean,
  "startup_experience_exemption": boolean,
  "past_performance_percentage": number,
  "emd_required": boolean,
  "emd_amount": number,
  "emd_exemption_mse": boolean,
  
  "ministry": "string",
  "department": "string",
  "organization_name": "string",
  "organization_type": "string - Central/State/Autonomous",
  "organization_address": "string",
  "pincode": "string",
  
  "mse_preference": boolean,
  "mii_preference": boolean,
  "make_in_india_preference": boolean,
  "local_content_requirement": "string - e.g., Class-I/Class-II",
  "bid_type": "string - Open/Limited",
  "participation_fee": number,
  
  "epbg_required": boolean,
  "epbg_percentage": number,
  "payment_terms": "string",
  "advance_payment_percentage": number,
  "warranty_required": boolean,
  "warranty_period": "string - e.g., 12 months",
  
  "boq_items": [
    {{
      "item_title": "string",
      "quantity": number,
      "unit": "string - e.g., Nos, Pcs, Kg",
      "category": "string",
      "specifications": "string",
      "delivery_days": number
    }}
  ]
}}

Document text:
{pdf_text[:15000]}

Return ONLY the JSON object, no explanation."""

    try:
        response = openai_client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a tender document parser. Return only valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=2000
        )
        
        import json
        json_str = response.choices[0].message.content.strip()
        
        # Clean markdown
        if json_str.startswith("```"):
            lines = json_str.split('\n')
            json_str = '\n'.join(lines[1:-1])
            if json_str.startswith('json'):
                json_str = json_str[4:].strip()
        
        return json.loads(json_str)
        
    except Exception as e:
        print(f"❌ Parsing error: {e}")
        return None

def update_database(filename, parsed_data):
    """Update tender record in database"""
    try:
        # Extract ID from filename
        bid_id = filename.replace('GeM-Bidding-', '').replace('.pdf', '')
        
        print(f"  🔍 Attempting to insert bid_id: {bid_id}")
        
        # Prepare data
        tender_data = {
            'gem_bid_id': bid_id,
            'pdf_storage_path': f'bids/{filename}',
            'updated_at': datetime.now().isoformat(),
            'bid_number': parsed_data.get('bid_number'),
            'bid_date': parsed_data.get('bid_date'),
            'bid_end_datetime': parsed_data.get('bid_end_datetime'),
            'total_quantity_parsed': parsed_data.get('total_quantity'),
            'item_category_parsed': parsed_data.get('item_category'),
            'mse_turnover_exemption': parsed_data.get('mse_turnover_exemption'),
            'startup_turnover_exemption': parsed_data.get('startup_turnover_exemption'),
            'oem_avg_turnover': parsed_data.get('oem_avg_turnover'),
            'required_experience_years_parsed': parsed_data.get('required_experience_years'),
            'mse_experience_exemption': parsed_data.get('mse_experience_exemption'),
            'startup_experience_exemption': parsed_data.get('startup_experience_exemption'),
            'past_performance_percentage_parsed': parsed_data.get('past_performance_percentage'),
            'emd_required': parsed_data.get('emd_required'),
            'emd_amount_parsed': parsed_data.get('emd_amount'),
            'emd_exemption_mse': parsed_data.get('emd_exemption_mse'),
            'ministry': parsed_data.get('ministry'),
            'department': parsed_data.get('department'),
            'organization_name_parsed': parsed_data.get('organization_name'),
            'organization_type': parsed_data.get('organization_type'),
            'organization_address': parsed_data.get('organization_address'),
            'pincode': parsed_data.get('pincode'),
            'mse_preference': parsed_data.get('mse_preference'),
            'mii_preference': parsed_data.get('mii_preference'),
            'make_in_india_preference': parsed_data.get('make_in_india_preference'),
            'local_content_requirement': parsed_data.get('local_content_requirement'),
            'bid_type': parsed_data.get('bid_type'),
            'participation_fee': parsed_data.get('participation_fee'),
            'epbg_required': parsed_data.get('epbg_required'),
            'epbg_percentage': parsed_data.get('epbg_percentage'),
            'payment_terms': parsed_data.get('payment_terms'),
            'advance_payment_percentage': parsed_data.get('advance_payment_percentage'),
            'warranty_required': parsed_data.get('warranty_required'),
            'warranty_period': parsed_data.get('warranty_period'),
            'boq_items': parsed_data.get('boq_items')
        }
        
        print(f"  🔍 Tender data keys: {len(tender_data)} fields")
        print(f"  🔍 Sample  bid_number={tender_data.get('bid_number')}")
        
        # Insert as new record
        result = supabase.table('tenders').insert(tender_data).execute()
        
        print(f"  🔍 Insert result: {result}")
        print(f"  🔍 Result  {result.data}")
        print(f"  🔍 Result count: {len(result.data) if result.data else 0}")
        
        if result.data:
            print(f"  ✅ Successfully inserted record ID: {result.data[0].get('id')}")
            return True
        else:
            print(f"  ❌ No data returned from insert")
            return False
        
    except Exception as e:
        print(f"  ❌ Database insert failed: {e}")
        print(f"  ❌ Exception type: {type(e).__name__}")
        import traceback
        print(f"  ❌ Traceback: {traceback.format_exc()}")
        return False




def process_supabase_bids():
    """Main function - parse all PDFs in /bids folder"""
    
    print(f"\n{'='*60}")
    print(f"🤖 Direct Supabase Parser (Cloud-to-Cloud)")
    print(f"{'='*60}\n")
    
    # List all files in /bids folder
    try:
        files = supabase.storage.from_('gem-pdfs').list('bids')
    except Exception as e:
        print(f"❌ Error listing files: {e}")
        return
    
    print(f"Found {len(files)} PDFs in /bids folder\n")
    
    success = 0
    failed = 0
    skipped = 0
    
    for file_obj in files:
        filename = file_obj['name']
        
        # Skip non-PDF files
        if not filename.endswith('.pdf'):
            continue
        
        print(f"📄 Processing: {filename}")
        
        try:
            # Check if already parsed
            storage_path = f'bids/{filename}'
            existing = supabase.table('tenders').select('id, bid_number').eq('pdf_storage_path', storage_path).execute()
            
            if existing.data and existing.data.get('bid_number'):
                print(f"  ⏭️  Already parsed (bid_number exists)")
                skipped += 1
                continue
            
            # Download PDF from storage
            pdf_bytes = supabase.storage.from_('gem-pdfs').download(storage_path)
            
            # Extract text
            pdf_text = extract_text_from_pdf_bytes(pdf_bytes)
            print(f"  ✅ Extracted {len(pdf_text)} characters")
            
            # Parse with GPT
            parsed_data = parse_with_gpt(pdf_text)
            
            if not parsed_data:
                failed += 1
                continue
            
            print(f"  ✅ Parsed: {parsed_data.get('bid_number', 'N/A')}")
            
            # Update database
            if update_database(filename, parsed_data):
                print(f"  ✅ Database updated")
                success += 1
            else:
                failed += 1
            
            # Rate limiting
            time.sleep(1)
            
        except Exception as e:
            print(f"  ❌ Error: {e}")
            failed += 1
    
    print(f"\n{'='*60}")
    print(f"📊 COMPLETE")
    print(f"{'='*60}")
    print(f"✅ Success: {success}")
    print(f"⏭️  Skipped: {skipped}")
    print(f"❌ Failed: {failed}")
    print(f"{'='*60}\n")

if __name__ == "__main__":
    process_supabase_bids()
