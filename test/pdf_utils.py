from pypdf import PdfReader


def load_pdf_pages_text(path: str) -> list[str]:
    reader = PdfReader(path)
    pages: list[str] = []

    for page in reader.pages:
        pages.append(page.extract_text() or "")

    return pages


def build_full_text(pages: list[str]) -> str:
    return "\n".join(pages)
