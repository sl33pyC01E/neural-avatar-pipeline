"""Build the ARDY embedding bank with one resident text-encoder load.

The text encoder is initialized lazily on the first cache miss, remains resident
for the entire migration and bank build, and is released exactly once at exit.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MOTION_MODELS = ROOT / "motion-models"
DEFAULT_BANK = ROOT / "embedding-bank" / "ardy-motion-bank.json"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(MOTION_MODELS))

from motion_worker import CachedTextEncoder  # noqa: E402


CORRECTED_ENTRY_NICKNAMES = {
    "A person claps their hands enthusiastically.": "Original · Enthusiastic clap",
    "A person crosses their arms.": "Ablation · Cross arms",
    "A person gestures naturally while explaining something.": "Original · Natural explaining",
    "A person hops on one foot.": "Original · Hop on one foot",
    "A person looks around curiously.": "Original · Curious look around",
    "A person lowers their hands and stands in a neutral pose.": "Original · Neutral lower hands",
    "A person nods in agreement.": "Ablation · Nod agreement",
    "A person places their hands on their hips.": "Broad · Hands on hips",
    "A person points forward.": "Ablation · Point forward",
    "A person shakes their head in disagreement.": "Ablation · Shake head",
    "A person spins around in place.": "Original · Spin in place",
    "A person sprints as fast as they can!": "Original · Sprint",
    "A person stands there, looking bored.": "Original · Bored idle",
    "A person stands up straight, naturally.": "Original · Natural upright",
    "A person stretches both arms overhead.": "Original · Arms overhead stretch",
    "A person takes a graceful bow.": "Original · Graceful bow",
    "A person walks forwards naturally.": "Original · Natural walk",
    "A person waves hello with their left hand.": "Original · Left hello wave",
    "A person waves hello with their right hand.": "Original · Right hello wave",
    "A person lowers their right hand.": "lower right hand",
    "A person raises their right hand.": "raise right hand",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Cache a named ARDY motion embedding bank in one resident encoder session.")
    parser.add_argument("--bank", type=Path, default=DEFAULT_BANK, help="Embedding-bank JSON file.")
    parser.add_argument(
        "--skip-the-person-migration",
        action="store_true",
        help="Do not replace existing prompts that begin with 'The person' with 'A person'.",
    )
    return parser.parse_args()


def load_bank(path: Path) -> list[dict[str, str]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("format") != "neural-avatar-embedding-bank" or int(payload.get("version", 0)) != 1:
        raise ValueError(f"Unsupported embedding-bank file: {path}")
    entries = []
    seen = set()
    for item in payload.get("entries", []):
        text = str(item.get("text", "")).strip()
        nickname = str(item.get("nickname", "")).strip()[:80]
        if not text or not re.match(r"^A person\b", text, flags=re.IGNORECASE):
            raise ValueError(f"Every bank prompt must begin with 'A person': {text!r}")
        canonical = CachedTextEncoder.canonical(text)
        if canonical in seen:
            raise ValueError(f"Duplicate bank prompt: {text}")
        seen.add(canonical)
        entries.append({"text": text, "nickname": nickname})
    return entries


def migrate_the_person(encoder: CachedTextEncoder) -> tuple[int, int]:
    migrated = 0
    skipped = 0
    original_entries = list(encoder.entries())
    for original in original_entries:
        old_text = str(original.get("text", "")).strip()
        if not re.match(r"^The person\b", old_text, flags=re.IGNORECASE):
            continue
        new_text = re.sub(r"^The person\b", "A person", old_text, count=1, flags=re.IGNORECASE)
        new_key = encoder.key(new_text)
        existing = next((entry for entry in encoder.entries() if entry.get("key") == new_key), None)
        if existing is None:
            created, replacement = encoder.cache(new_text, str(original.get("nickname", "")))
            if not created or encoder._load_one(new_text) is None:
                raise RuntimeError(f"Replacement embedding was not verified for: {old_text}")
        else:
            replacement = existing
            if not str(replacement.get("nickname", "")).strip() and str(original.get("nickname", "")).strip():
                encoder.set_nickname(new_key, str(original.get("nickname", "")))
            if encoder._load_one(new_text) is None:
                raise RuntimeError(f"Existing replacement embedding is invalid for: {old_text}")
        encoder.delete(str(original.get("key", "")))
        migrated += 1
        print(f"migrated: {old_text} -> {new_text}", flush=True)
    return migrated, skipped


def cache_bank(encoder: CachedTextEncoder, entries: list[dict[str, str]]) -> tuple[int, int, int]:
    created_count = 0
    reused_count = 0
    nicknamed_count = 0
    existing_by_key = {str(entry.get("key")): entry for entry in encoder.entries()}
    total = len(entries)
    for index, item in enumerate(entries, start=1):
        text = item["text"]
        nickname = item["nickname"]
        key = encoder.key(text)
        existing = existing_by_key.get(key)
        if existing is not None:
            reused_count += 1
            if not str(existing.get("nickname", "")).strip() and nickname:
                existing = encoder.set_nickname(key, nickname)
                nicknamed_count += 1
            print(f"[{index:03d}/{total:03d}] reused: {existing.get('nickname') or text}", flush=True)
            continue
        created, saved = encoder.cache(text, nickname)
        if not created or encoder._load_one(text) is None:
            raise RuntimeError(f"Embedding was not saved and verified: {text}")
        existing_by_key[key] = saved
        created_count += 1
        print(f"[{index:03d}/{total:03d}] cached: {nickname or text}", flush=True)
    return created_count, reused_count, nicknamed_count


def name_corrected_entries(encoder: CachedTextEncoder) -> int:
    named = 0
    by_key = {str(entry.get("key")): entry for entry in encoder.entries()}
    for text, nickname in CORRECTED_ENTRY_NICKNAMES.items():
        key = encoder.key(text)
        entry = by_key.get(key)
        if entry is not None and not str(entry.get("nickname", "")).strip():
            encoder.set_nickname(key, nickname)
            named += 1
    return named


def main() -> int:
    args = parse_args()
    bank_entries = load_bank(args.bank.resolve())
    encoder = CachedTextEncoder("ardy", "cuda:0")
    migrated = 0
    try:
        if not args.skip_the_person_migration:
            migrated, _ = migrate_the_person(encoder)
        named_corrected = name_corrected_entries(encoder)
        created, reused, nicknamed = cache_bank(encoder, bank_entries)
        final_entries = encoder.entries()
    finally:
        encoder.release_backend()
    print(
        json.dumps(
            {
                "ok": True,
                "migratedThePerson": migrated,
                "namedCorrectedEntries": named_corrected,
                "bankEntries": len(bank_entries),
                "created": created,
                "reused": reused,
                "nicknamedExisting": nicknamed,
                "totalCachedEntries": len(final_entries),
                "encoderLoads": 1 if created or migrated else 0,
                "encoderReleases": 1 if created or migrated else 0,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
