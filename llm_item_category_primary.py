import requests
import json
import re

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

def window_item_block(text, span=2500):
    idx = re.search(r'Item\s*Category', text, re.I)
    if not idx:
        return text[:span]

    start = max(0, idx.start() - 800)
    end = min(len(text), idx.end() + span)
    return text[start:end]

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
    
    block = window_item_block(text)
    prompt = f"""Extract the value written next to "Item Category" label from this tender document.

Document:
{block}

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
            timeout=20
        )
        
        result = response.json()
        raw = result["message"]["content"]

        try:
            data = json.loads(raw)
            cat = data.get("category", "")
        except Exception:
            # Model ignored schema and returned plain text
            cat = raw

        return clean_category(cat)

    except Exception as e:
        print(f"[LLM_ITEM_ERR] {e}")
        return None
    