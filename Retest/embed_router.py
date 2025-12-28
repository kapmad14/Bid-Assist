import requests, numpy as np, tiktoken, time, math

OLLAMA_URL = "http://localhost:11434/api/embeddings"
enc = tiktoken.get_encoding("cl100k_base")

TIMEOUT = 240
MAX_TOKENS = 300   # hard ceiling per call

def token_len(txt):
    return len(enc.encode(txt))

def chunk_text(txt, max_tokens=MAX_TOKENS):
    tokens = enc.encode(txt)
    for i in range(0, len(tokens), max_tokens):
        yield enc.decode(tokens[i:i+max_tokens])

def embed_chunk(chunk, model):
    payload = {"model": model, "prompt": chunk}
    r = requests.post(OLLAMA_URL, json=payload, timeout=TIMEOUT)
    r.raise_for_status()
    return np.array(r.json()["embedding"], dtype=np.float32)

def embed(text, model):
    vecs = []
    for part in chunk_text(text):
        vecs.append(embed_chunk(part, model))
        time.sleep(0.05)  # prevent Ollama overload
    return np.mean(vecs, axis=0)

def warmup_models():
    print("Warming up models...")
    embed("warmup", "qwen3-embedding")
    embed("warmup", "snowflake-arctic-embed2")
    print("Models ready.")

def embed_block(block):
    txt = block["text"]
    if token_len(txt) < 350:
        return embed(txt, "qwen3-embedding")
    return embed(txt, "snowflake-arctic-embed2")
