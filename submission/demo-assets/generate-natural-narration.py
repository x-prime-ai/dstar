from __future__ import annotations

import subprocess
import sys
import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "submission" / "demo-assets"
SOURCE = ASSETS / "narration"
OUTPUT = ASSETS / "narration-natural"
REFERENCE_VALUE = os.environ.get("DSTAR_TTS_REFERENCE")
PYTHON = Path(os.environ.get("DSTAR_TTS_PYTHON", sys.executable))
MODEL = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"
REFERENCE_TEXT = (
    "Overview. A simple, open format for giving agents new capabilities and expertise."
)


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def main() -> None:
    if not REFERENCE_VALUE:
        raise SystemExit("Set DSTAR_TTS_REFERENCE to a consented voice reference WAV")
    reference = Path(REFERENCE_VALUE).expanduser().resolve()
    if not reference.is_file():
        raise SystemExit("DSTAR_TTS_REFERENCE must name a readable file")
    OUTPUT.mkdir(parents=True, exist_ok=True)
    numbers = [int(value) for value in sys.argv[1:]] or list(range(1, 7))
    for number in numbers:
        stem = f"{number:02d}"
        text = (SOURCE / f"{stem}.txt").read_text().strip()
        run(
            str(PYTHON),
            "-m",
            "mlx_audio.tts.generate",
            "--model",
            MODEL,
            "--text",
            text,
            "--lang_code",
            "English",
            "--ref_audio",
            str(reference),
            "--ref_text",
            REFERENCE_TEXT,
            "--output_path",
            str(OUTPUT),
            "--file_prefix",
            f"{stem}-raw",
            "--audio_format",
            "wav",
            "--temperature",
            "0.75",
            "--top_p",
            "0.92",
            "--top_k",
            "50",
            "--max_tokens",
            "2048",
        )
        raw = OUTPUT / f"{stem}-raw_000.wav"
        run(
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(raw),
            "-af",
            "loudnorm=I=-16:TP=-1.5:LRA=11,apad=pad_dur=0.8",
            "-ar",
            "48000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            str(OUTPUT / f"{stem}.wav"),
        )


if __name__ == "__main__":
    main()
