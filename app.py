import json
import requests
from flask import Flask, request, Response, render_template_string

app = Flask(__name__)

# --------- CONFIG ----------
JSON_FILE = "gem_results_pilot_first25.json"
# ---------------------------

# Load your data
with open(JSON_FILE, "r", encoding="utf-8") as f:
    TENDERS = json.load(f)

INDEX_HTML = """
<!DOCTYPE html>
<html>
<head>
  <title>GeM Tender Viewer</title>
  <style>
    body { font-family: Arial; margin: 0; }
    .container { display: flex; height: 100vh; }

    .sidebar {
      width: 40%;
      padding: 15px;
      overflow-y: auto;
      border-right: 1px solid #ddd;
      background: #f7f7f7;
    }

    .viewer {
      width: 60%;
      height: 100vh;
      background: #222;
    }

    iframe {
      width: 100%;
      height: 100%;
      border: none;
      background: white;
    }

    a { display:block; margin:8px 0; }
    .ra { margin-left: 20px; color: #444; }
    hr { opacity: 0.3; }
  </style>
</head>
<body>

<div class="container">

  <div class="sidebar">
    <h3>GeM Tenders</h3>

    {% for t in tenders %}
      <b>{{ t.get("bid_number") }}</b><br>

      <a href="/open?url={{ t.get('bid_detail_url') }}" target="pdf_frame">
        → View Bid Document
      </a>

      {% if t.get("ra_detail_url") %}
      <a class="ra" href="/open?url={{ t.get('ra_detail_url') }}" target="pdf_frame">
        → View RA Document
      </a>
      {% endif %}

      <small>
        Item: {{ t.get("item") }}<br>
        Qty: {{ t.get("quantity") }}<br>
        Ministry: {{ t.get("ministry") }}
      </small>

      <hr>
    {% endfor %}
  </div>

  <div class="viewer">
    <iframe name="pdf_frame"></iframe>
  </div>

</div>
</body>
</html>
"""

@app.route("/")
def index():
    return render_template_string(INDEX_HTML, tenders=TENDERS)

# ---------- CORE: PDF PROXY ----------
@app.route("/open")
def open_doc():
    url = request.args.get("url")

    # Fetch file from GeM (this triggers their "download")
    r = requests.get(url, timeout=60)

    # Re-serve it INLINE so browser shows it
    return Response(
        r.content,
        mimetype="application/pdf",
        headers={
            "Content-Disposition": "inline; filename=gem_document.pdf",
            "Cache-Control": "no-store"
        }
    )
# ------------------------------------

if __name__ == "__main__":
    app.run(port=5000, debug=True)
