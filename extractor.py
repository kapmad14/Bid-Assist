import re
import warnings
from pypdf import PdfReader

warnings.filterwarnings("ignore", category=DeprecationWarning)

# Very tolerant patterns – GeM PDFs are extremely inconsistent
LABEL_ITEM = re.compile(
    r"Item\s*Category[^A-Za-z0-9]+(.+?)(?=Searched|Minimum Average Annual Turnover|OEM Average Turnover|Years of Past Experience Required|MSE Exemption|Startup Exemption|Document required from seller|Bid Number)",
    re.S | re.I,
)

LABEL_DOCS = re.compile(
    r"Document\s*required\s*from\s*seller[^A-Za-z0-9]+(.+?)(?=Do you want to show documents uploaded by bidders)",
    re.S | re.I,
)

def clean_text(text: str) -> str:
    # remove all non-printable / control chars
    text = re.sub(r"[\x00-\x1F\x7F]", " ", text)
    # remove Hindi / non-ascii junk
    text = re.sub(r"[^\x00-\x7F]+", " ", text)
    # normalize whitespace
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()

def extract_item_category(text):
    m = LABEL_ITEM.search(text)
    if not m:
        return None
    raw = clean_text(m.group(1))
    raw = re.sub(r"\s+GeMARPTS.*$", "", raw, flags=re.I)
    return raw

def extract_documents(text):
    m = LABEL_DOCS.search(text)
    if not m:
        return []

    raw = clean_text(m.group(1))

    # remove leading numeric junk like "7 7 Experience Criteria"
    raw = re.sub(r"\b\d+\s+\d+\s+", "", raw)

    # remove boilerplate sentence
    raw = re.sub(
        r"the supporting documents to prove his eligibility for exemption must be uploaded for evaluation by the buyer.*",
        "",
        raw,
        flags=re.I,
    )

    # remove qualification note appended to doc names
    raw = re.sub(
        r"\*?\s*In case any bidder is seeking exemption from Experience\s*/\s*Turnover Criteria.*",
        "",
        raw,
        flags=re.I,
    )

    # remove footer junk starting with Bid Number
    raw = re.sub(r"Bid Number.*$", "", raw, flags=re.I)

    docs = []
    for part in raw.split(","):
        p = part.strip(" -*:")
        if len(p) > 4:
            docs.append(p)

    return docs



def parse_pdf(path):
    reader = PdfReader(path)
    text = ""

    # only first pages needed
    for p in reader.pages[:3]:
        try:
            t = p.extract_text()
        except Exception:
            t = ""
        if t:
            text += "\n" + t

    text = clean_text(text)

    return {
        "item_category": extract_item_category(text),
        "documents_required": extract_documents(text),
    }
