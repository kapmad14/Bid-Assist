from fastapi import FastAPI
from pydantic import BaseModel
from supabase import create_client
import os

from extract_logic import extract_tender_document_urls

app = FastAPI()

# Load Supabase URL + Service Key
SUPABASE_URL = os.getenv("SUPABASE_URL")
SERVICE_ROLE_KEY = os.getenv("SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    raise Exception("Missing SUPABASE_URL or SERVICE_ROLE_KEY")

# Initialize Supabase once (stays in memory)
supabase = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)


class ExtractRequest(BaseModel):
    tenderId: int


@app.post("/extract")
def extract(req: ExtractRequest):
    """HTTP endpoint that performs URL extraction"""
    result = extract_tender_document_urls(req.tenderId, supabase)
    return result


@app.get("/")
def root():
    return {"status": "Extractor service is running"}
