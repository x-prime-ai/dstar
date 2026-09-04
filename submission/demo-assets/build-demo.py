from __future__ import annotations

import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "submission" / "demo-assets"
FRAMES = ASSETS / "final-frames"
NARRATION = ASSETS / "narration-natural"
OUTPUT = ROOT / "submission" / "demo-output"

SEGMENTS = {
    1: [
        ("slides-01.png", 5.0),
        ("slides-02.png", 8.0),
        ("01-library.png", 7.0),
    ],
    2: [
        ("slides-03.png", 4.0),
        ("slides-04.png", 4.0),
        ("02-document.png", 3.0),
        ("03-rich.png", 3.0),
        ("04-slides.png", 3.0),
        ("05-ui-design.png", 3.0),
    ],
    3: [
        ("slides-05.png", 4.0),
        ("06-create-dialog.png", 3.0),
        ("07-agent-waiting.png", 2.0),
        ("09-agent-returned.png", 3.0),
        ("10-created-in-library.png", 3.0),
        ("11-created-document.png", 5.0),
    ],
    4: [
        ("slides-06.png", 4.0),
        ("slides-selection.png", 3.0),
        ("slides-agent-comment-draft.png", 3.0),
        ("slides-comment-posted.png", 2.0),
    ],
    5: [
        ("slides-07.png", 4.0),
        ("slides-update-waiting.png", 2.0),
        ("slides-update-proposal.png", 4.0),
        ("slides-update-accepted.png", 3.0),
        ("slides-comment-resolved.png", 2.0),
    ],
    6: [
        ("slides-08.png", 9.0),
        ("slides-update-accepted.png", 3.0),
        ("01-library.png", 5.0),
    ],
}


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def media_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe", "-v", "error", "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1", str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(result.stdout.strip())


def render_segment(number: int, shots: list[tuple[str, float]]) -> Path:
    visual = OUTPUT / f"natural-visual-{number:02d}.mp4"
    segment = OUTPUT / f"natural-segment-{number:02d}.mp4"
    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []

    narration = NARRATION / f"{number:02d}.wav"
    planned_duration = sum(duration for _, duration in shots)
    duration_scale = (media_duration(narration) + 0.12) / planned_duration

    for index, (filename, duration) in enumerate(shots):
        duration *= duration_scale
        inputs.extend(["-loop", "1", "-t", str(duration), "-i", str(FRAMES / filename)])
        label = f"v{index}"
        filters.append(
            f"[{index}:v]fps=30,format=yuv420p,setpts=PTS-STARTPTS[{label}]"
        )
        labels.append(f"[{label}]")

    filters.append(f"{''.join(labels)}concat=n={len(shots)}:v=1:a=0[outv]")
    run(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        *inputs,
        "-filter_complex", ";".join(filters),
        "-map", "[outv]",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        str(visual),
    )
    run(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", str(visual), "-i", str(narration),
        "-map", "0:v:0", "-map", "1:a:0",
        "-c:v", "copy", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-shortest",
        str(segment),
    )
    return segment


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    segments = [render_segment(number, shots) for number, shots in SEGMENTS.items()]
    concat = OUTPUT / "natural-segments.txt"
    concat.write_text("".join(f"file '{segment}'\n" for segment in segments))
    run(
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "concat", "-safe", "0", "-i", str(concat),
        "-c", "copy", str(OUTPUT / "dstar-demo.mp4"),
    )


if __name__ == "__main__":
    main()
