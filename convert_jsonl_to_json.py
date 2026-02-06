import json

INPUT = "gem-scraper/results/gem_results_21-01-2026_failed.jsonl"
OUTPUT = "gem-scraper/results/gem_results_21-01-2026.json"

records = []

with open(INPUT, "r", encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if line:                     # skip empty lines
            records.append(json.loads(line))

with open(OUTPUT, "w", encoding="utf-8") as f:
    json.dump(records, f, indent=2, ensure_ascii=False)

print(f"Converted {len(records)} records → {OUTPUT}")
