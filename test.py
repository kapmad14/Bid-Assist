import requests
import PyPDF2
import json
import csv
import re
from pathlib import Path

def extract_text_from_pdf(pdf_path, max_pages=2):
    """Extract text from first N pages only"""
    reader = PyPDF2.PdfReader(pdf_path)
    total_pages = len(reader.pages)
    pages_to_read = min(max_pages, total_pages)
    
    text = ""
    for i in range(pages_to_read):
        text += reader.pages[i].extract_text()
    
    return text

def clean_category(raw_text):
    """Aggressively clean up the extracted category"""
    if not raw_text:
        return ""
    
    cleaned = raw_text.strip()
    
    # Remove common unwanted patterns
    patterns_to_remove = [
        r'^The value of ["\']?Item Category["\']? (?:label )?is:\s*\n*',
        r'^The value is:\s*\n*',
        r'^The value is:\s*["\']?Item Category["\']?\s*\n*',
        r'^Item Category:\s*\n*',
        r'^/Item Category\s*\n*',
        r'^Item Category/\s*\n*',
        r'GeMARPTS\s*$',
        r'^["\']|["\']$',  # Remove quotes at start/end
    ]
    
    for pattern in patterns_to_remove:
        cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE | re.MULTILINE)
    
    # Remove extra whitespace and newlines
    cleaned = ' '.join(cleaned.split())
    
    return cleaned.strip()

def extract_item_category(text):
    """Extract using structured output for consistent formatting"""
    
    # Define JSON schema for structured output
    schema = {
        "type": "object",
        "properties": {
            "category": {
                "type": "string",
                "description": "The exact item category value from the document"
            }
        },
        "required": ["category"]
    }
    
    prompt = f"""Extract the value written next to "Item Category" label from this tender document.

Document:
{text}

Return ONLY the category value text. Do not include labels, prefixes, or explanations."""
    
    try:
        response = requests.post(
            'http://127.0.0.1:11434/api/chat',
            json={
                'model': 'llama3.1:latest',
                'messages': [
                    {
                        'role': 'system',
                        'content': 'Extract the exact field value. Return only the value text with no explanations or labels.'
                    },
                    {
                        'role': 'user',
                        'content': prompt
                    }
                ],
                'format': schema,  # Force structured JSON output
                'stream': False,
                'options': {
                    'temperature': 0.0,
                    'num_predict': 500
                }
            },
            timeout=30
        )
        
        result = response.json()
        content = json.loads(result['message']['content'])
        raw_category = content.get('category', '')
        
        # Clean up
        cleaned_category = clean_category(raw_category)
        
        return cleaned_category
        
    except Exception as e:
        print(f"  ❌ API Error: {e}")
        return None

def process_all_tenders(folder_path="tender-pdfs"):
    """Process all tender PDFs"""
    results = []
    
    pdf_files = list(Path(folder_path).glob("*.pdf"))
    print(f"Found {len(pdf_files)} PDF files\n")
    
    for pdf_file in pdf_files:
        print(f"Processing: {pdf_file.name}")
        
        text = extract_text_from_pdf(pdf_file, max_pages=2)
        if not text:
            print("  ❌ No text extracted\n")
            continue
            
        category = extract_item_category(text)
        if category:
            results.append({
                "file_name": pdf_file.name,
                "item_category": category
            })
            print(f"  ✓ {category[:100]}...\n" if len(category) > 100 else f"  ✓ {category}\n")
        else:
            print("  ❌ Could not extract category\n")
    
    # Save as JSON
    with open("item_categories.json", "w", encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"✓ Saved JSON: item_categories.json")
    
    # Save as CSV
    with open("item_categories.csv", "w", newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=["file_name", "item_category"])
        writer.writeheader()
        writer.writerows(results)
    print(f"✓ Saved CSV: item_categories.csv")
    
    return results

if __name__ == "__main__":
    results = process_all_tenders()
    
    print(f"\n=== EXTRACTED {len(results)} CATEGORIES ===")
