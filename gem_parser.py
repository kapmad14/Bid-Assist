"""
GeM PDF Parser - Extracts 39 fields using GPT-3.5-Turbo + pdfplumber
Usage: python gem_parser.py <pdf_path>
Cost: ~$0.0015 per tender
"""

import os
import json
import pdfplumber
from openai import OpenAI
from datetime import datetime
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Initialize OpenAI client
client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))

def extract_text_from_pdf(pdf_path):
    """Extract text from PDF using pdfplumber (better for tables)"""
    text = ""
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text += page_text + "\n"
    return text

def parse_tender_with_gpt(pdf_text):
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

Important parsing rules:
1. For boolean fields, look for keywords: Yes/No, Applicable/Not Applicable, Required/Not Required
2. For dates, convert to YYYY-MM-DD format
3. For money amounts, extract numeric value only (remove currency symbols)
4. For BOQ items, extract all items listed in the Bill of Quantities section
5. If a field is not mentioned or unclear, use null

Document text:
{pdf_text[:15000]}

Return ONLY the JSON object, no explanation or markdown formatting."""

    try:
        response = client.chat.completions.create(
            model="gpt-3.5-turbo",
            messages=[
                {"role": "system", "content": "You are a tender document parser. Return only valid JSON with no additional text."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=2000
        )
        
        json_str = response.choices[0].message.content.strip()
        
        # Clean up markdown code blocks if present
        if json_str.startswith("```"):
            lines = json_str.split('\n')
            json_str = '\n'.join(lines[1:-1])
            if json_str.startswith('json'):
                json_str = json_str[4:].strip()
        
        # Parse JSON
        parsed_data = json.loads(json_str)
        
        # Add metadata
        parsed_data['_metadata'] = {
            'parsed_at': datetime.now().isoformat(),
            'parser_version': '1.0',
            'model': 'gpt-3.5-turbo',
            'text_length': len(pdf_text)
        }
        
        return parsed_data
        
    except json.JSONDecodeError as e:
        print(f"❌ JSON parsing error: {e}")
        print(f"Response: {json_str[:500]}")
        raise
    except Exception as e:
        print(f"❌ Error: {e}")
        raise


def main(pdf_path):
    """Main parser function"""
    print(f"\n{'='*60}")
    print(f"📄 GeM PDF Parser")
    print(f"{'='*60}")
    print(f"Processing: {pdf_path}")
    
    # Step 1: Extract text
    print("\n⏳ Step 1/3: Extracting text from PDF...")
    try:
        pdf_text = extract_text_from_pdf(pdf_path)
        print(f"✅ Extracted {len(pdf_text):,} characters")
    except Exception as e:
        print(f"❌ Failed to extract text: {e}")
        return None
    
    # Step 2: Parse with GPT
    print("\n⏳ Step 2/3: Parsing with GPT-3.5-Turbo...")
    try:
        parsed_data = parse_tender_with_gpt(pdf_text)
        print("✅ Parsing complete!")
    except Exception as e:
        print(f"❌ Failed to parse: {e}")
        return None
    
    # Step 3: Save results
    print("\n⏳ Step 3/3: Saving results...")
    output_file = pdf_path.replace('.pdf', '_parsed.json')
    try:
        with open(output_file, 'w', encoding='utf-8') as f:
            json.dump(parsed_data, f, indent=2, ensure_ascii=False)
        print(f"✅ Saved to: {output_file}")
    except Exception as e:
        print(f"❌ Failed to save: {e}")
    
    # Display key results
    print(f"\n{'='*60}")
    print("📊 EXTRACTED DATA SUMMARY")
    print(f"{'='*60}")
    print(f"Bid Number: {parsed_data.get('bid_number', 'N/A')}")
    print(f"Organization: {parsed_data.get('organization_name', 'N/A')}")
    print(f"Bid End Date: {parsed_data.get('bid_end_datetime', 'N/A')}")
    print(f"EMD Required: {parsed_data.get('emd_required', 'N/A')}")
    print(f"EMD Amount: ₹{parsed_data.get('emd_amount', 0):,.2f}" if parsed_data.get('emd_amount') else "N/A")
    print(f"BOQ Items: {len(parsed_data.get('boq_items', []))} items")
    print(f"\n💾 Full data saved to: {output_file}")
    print(f"{'='*60}\n")
    
    return parsed_data

if __name__ == "__main__":
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python gem_parser.py <pdf_path>")
        print("\nExample:")
        print("  python gem_parser.py GeM-Bidding-7582916.pdf")
        sys.exit(1)
    
    pdf_path = sys.argv[1]  # This line gets the first argument
    
    if not os.path.exists(pdf_path):
        print(f"❌ Error: File not found: {pdf_path}")
        sys.exit(1)
    
    result = main(pdf_path)
    
    if result:
        print("✅ Success! Check the _parsed.json file for full details.")
        sys.exit(0)
    else:
        print("❌ Parsing failed. Check errors above.")
        sys.exit(1)
