"""
mem0 Bulk Transcript Importer — Kitsune Global Solutions
Reads all Claude Code .jsonl transcripts, extracts facts via Claude, writes to mem0.

Setup:
    pip install anthropic mem0ai
    Set ANTHROPIC_API_KEY below, then run: python mem0_importer.py
"""

import os, json, time, glob, hashlib
from pathlib import Path

# ── KEYS (fill in ANTHROPIC_API_KEY) ─────────────────────────────────────────
MEM0_API_KEY      = "m0-lXJXL2c0us8nKM4RFDaFpSK6r06XEvFK6Ie3PSRm"
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")  # paste your key here

# ── CONFIG ────────────────────────────────────────────────────────────────────
TRANSCRIPT_DIRS = [r"C:\Users\ARNAUTICA\.claude\projects"]
CHECKPOINT_FILE = r"C:\Users\ARNAUTICA\mem0_checkpoint.json"
TURNS_PER_CHUNK = 20       # turns fed to Claude per extraction call
WRITE_DELAY     = 0.5      # seconds between mem0 writes (rate limit)
MODEL           = "claude-haiku-4-5"
MEM0_USER_ID    = "travon-brown-kgs"

PROMPT = """Extract reusable facts from this Claude Code session transcript.
Keep ONLY facts useful in a FUTURE session:
- Project rules, constraints, operator preferences stated explicitly
- Technical decisions (architecture, stack, file locations, API configs)
- Bugs found and their exact fixes
- Features built and their current state
- Pending work items with enough context to act on
- Operator working style / explicit instructions ("always X", "never Y")

SKIP: filler, abandoned debug steps, already-obvious code facts, duplicates.

Return a JSON array of concise strings. Max 15 facts. Each under 300 chars.
Transcript chunk:
"""

# ── CORE ──────────────────────────────────────────────────────────────────────
def load_cp():
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE) as f:
            return json.load(f)
    return {"processed": [], "total": 0}

def save_cp(cp):
    with open(CHECKPOINT_FILE, "w") as f:
        json.dump(cp, f, indent=2)

def fhash(p):
    return hashlib.md5(Path(p).read_bytes()).hexdigest()[:12]

def parse_jsonl(path):
    turns = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                obj = json.loads(line.strip())
            except:
                continue
            msg = obj.get("message", obj)
            role = msg.get("role", "")
            content = msg.get("content", "")
            if isinstance(content, list):
                text = " ".join(
                    b.get("text", "") for b in content
                    if isinstance(b, dict) and b.get("type") == "text"
                )
            elif isinstance(content, str):
                text = content
            else:
                continue
            if role in ("user", "assistant") and text.strip():
                turns.append({"role": role, "text": text[:2000]})
    return turns

def extract_facts(ac, chunk):
    txt = "\n".join(f"[{t['role'].upper()}]: {t['text']}" for t in chunk)
    try:
        r = ac.messages.create(
            model=MODEL, max_tokens=1024,
            messages=[{"role": "user", "content": PROMPT + txt}]
        )
        raw = r.content[0].text.strip()
        s, e = raw.find("["), raw.rfind("]") + 1
        if s == -1 or e == 0:
            return []
        return [f for f in json.loads(raw[s:e]) if isinstance(f, str) and len(f) > 20]
    except Exception as ex:
        print(f"  [WARN] extract: {ex}")
        return []

def write_mem0(mc, facts):
    n = 0
    for fact in facts:
        try:
            mc.add(fact, user_id=MEM0_USER_ID)
            n += 1
            time.sleep(WRITE_DELAY)
        except Exception as ex:
            print(f"  [WARN] mem0 write: {ex}")
            time.sleep(2)
    return n

def main():
    if not ANTHROPIC_API_KEY:
        print("ERROR: paste your Anthropic API key into ANTHROPIC_API_KEY at top of file")
        return

    import anthropic
    from mem0 import MemoryClient

    ac = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)
    mc = MemoryClient(api_key=MEM0_API_KEY)
    cp = load_cp()
    print(f"Checkpoint: {len(cp['processed'])} files done, {cp['total']} memories stored\n")

    files = []
    for d in TRANSCRIPT_DIRS:
        files += glob.glob(os.path.join(d, "**", "*.jsonl"), recursive=True)
    files = sorted(set(files))
    print(f"Found {len(files)} transcript files\n")

    new_total = 0
    for i, path in enumerate(files):
        h = fhash(path)
        if h in cp["processed"]:
            print(f"[{i+1}/{len(files)}] SKIP: {Path(path).name}")
            continue

        kb = Path(path).stat().st_size // 1024
        print(f"[{i+1}/{len(files)}] {Path(path).name} ({kb} KB)")

        turns = parse_jsonl(path)
        if len(turns) < 4:
            print("  too short, skipping")
            cp["processed"].append(h)
            save_cp(cp)
            continue

        chunks = [turns[j:j+TURNS_PER_CHUNK] for j in range(0, len(turns), TURNS_PER_CHUNK)]
        print(f"  {len(turns)} turns -> {len(chunks)} chunks")

        facts = []
        for ci, chunk in enumerate(chunks):
            f = extract_facts(ac, chunk)
            print(f"  chunk {ci+1}/{len(chunks)}: {len(f)} facts")
            facts.extend(f)
            time.sleep(0.3)

        facts = list(dict.fromkeys(facts))  # dedupe preserving order

        if facts:
            print(f"  writing {len(facts)} facts...")
            w = write_mem0(mc, facts)
            new_total += w
            cp["total"] += w
            print(f"  -> {w} stored")

        cp["processed"].append(h)
        save_cp(cp)

    print(f"\n{'='*50}")
    print(f"DONE. {new_total} new memories this run. Total: {cp['total']}")


if __name__ == "__main__":
    main()
