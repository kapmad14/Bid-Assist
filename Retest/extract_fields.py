from pdf_blocks import extract_blocks
from embed_router import embed_block, token_len
from anchors import ANCHORS
from sklearn.metrics.pairwise import cosine_similarity

def extract_field(blocks, field):
    qwen_anchors = []
    arctic_anchors = []

    for a in ANCHORS[field]:
        if token_len(a) < 350:
            qwen_anchors.append(embed_block({"text": a}))
        else:
            arctic_anchors.append(embed_block({"text": a}))

    scored = []

    for b in blocks:
        vec = embed_block(b)

        if token_len(b["text"]) < 350 and qwen_anchors:
            sims = cosine_similarity([vec], qwen_anchors)[0]
        elif arctic_anchors:
            sims = cosine_similarity([vec], arctic_anchors)[0]
        else:
            continue

        scored.append((float(max(sims)), b))

    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[:3]
