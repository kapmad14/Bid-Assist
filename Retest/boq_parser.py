import re

def parse_boq_from_lines(lines):
    boq = []
    i = 0

    while i < len(lines):
        line = lines[i].strip()

        # candidate product heading
        if (
            2 < len(line) < 40
            and line.istitle()
            and "specification" not in line.lower()
        ):
            if i+3 < len(lines) and "boq detail" in lines[i+1].lower():

                item = line
                consignee = None
                quantity = None
                delivery = None

                j = i + 1
                while j < len(lines) and j < i + 12:
                    l = lines[j]

                    if consignee is None and re.search(r"[A-Za-z].*(India|Baramulla|Delhi|Mumbai|Pune)", l):
                        consignee = l.strip()

                    q = re.search(r"Quantity\s*[:\-]?\s*(\d+)", l, re.I)
                    if q:
                        quantity = int(q.group(1))

                    d = re.search(r"Delivery\s*Days\s*[:\-]?\s*(\d+)", l, re.I)
                    if d:
                        delivery = int(d.group(1))

                    j += 1

                if item and quantity:
                    boq.append({
                        "item": item,
                        "consignee_address": consignee,
                        "quantity": quantity,
                        "delivery_days": delivery
                    })

        i += 1

    return boq
