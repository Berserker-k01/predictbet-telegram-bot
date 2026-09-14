"""
Ultra pipeline: FaceFusion en une passe.
  Hyperswap 256  → identité (peau, ovale, coupe)
  LivePortrait   → expressions + bouche
  GFPGAN         → grain de peau
  EDTalk/Wav2Lip → lèvres si la vidéo a de l'audio (-lips)
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
VENV_PY = ROOT / ".venv" / "Scripts" / "python.exe"
VENDOR = ROOT / "vendor" / "facefusion"
FACES = ROOT / "input" / "faces"
DRIVING = ROOT / "input" / "driving"
AUDIO = ROOT / "input" / "audio"
OUTPUT = ROOT / "output"

IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".webm", ".avi"}


def python_bin() -> list[str]:
    if VENV_PY.is_file():
        return [str(VENV_PY)]
    return [sys.executable]


def collect(folder: Path, exts: set[str]) -> list[Path]:
    if not folder.is_dir():
        return []
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in exts)


def has_nvidia() -> bool:
    return shutil.which("nvidia-smi") is not None


def main() -> int:
    parser = argparse.ArgumentParser(description="Rendu ultra FaceFusion (swap + LivePortrait + GFPGAN)")
    parser.add_argument("--driving", help="Vidéo cible (sinon la première de input/driving)")
    parser.add_argument("--lips", action="store_true", help="Forcer le lip-sync (EDTalk)")
    parser.add_argument("--boost", default="256x256", help="Pixel boost (256x256 sur 4 Go VRAM)")
    parser.add_argument("--cpu", action="store_true", help="Forcer CPU")
    args = parser.parse_args()

    if not (VENDOR / "facefusion.py").is_file():
        print("FaceFusion n'est pas installé. Lance d'abord:  .\\setup.ps1")
        return 1

    faces = collect(FACES, IMAGE_EXT)
    if not faces:
        print("Ajoute 5 à 20 photos du même visage dans input/faces")
        return 1

    if args.driving:
        driving = Path(args.driving)
    else:
        videos = collect(DRIVING, VIDEO_EXT)
        driving = videos[0] if videos else None
    if not driving or not driving.is_file():
        print("Ajoute une vidéo dans input/driving (webcam rec ou clip)")
        return 1

    OUTPUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out = OUTPUT / f"ultra-{stamp}.mp4"

    processors = ["face_swapper", "expression_restorer", "face_enhancer"]
    if args.lips or collect(AUDIO, {".wav", ".mp3", ".m4a"}):
        processors.append("lip_syncer")

    providers = ["cpu"] if args.cpu or not has_nvidia() else ["cuda"]

    cmd = [
        *python_bin(),
        "facefusion.py",
        "headless-run",
        "--source-paths",
        *[str(p) for p in faces],
        "--target-path",
        str(driving),
        "--output-path",
        str(out),
        "--processors",
        *processors,
        "--face-swapper-model",
        "hyperswap_1a_256",
        "--face-swapper-pixel-boost",
        args.boost,
        "--expression-restorer-model",
        "live_portrait",
        "--expression-restorer-factor",
        "90",
        "--expression-restorer-areas",
        "upper-face",
        "lower-face",
        "--face-enhancer-model",
        "gfpgan_1.4",
        "--face-enhancer-blend",
        "80",
        "--execution-providers",
        *providers,
        "--video-encoder",
        "libx264",
        "--video-quality",
        "18",
    ]
    if "lip_syncer" in processors:
        cmd += ["--lip-syncer-model", "edtalk_256", "--lip-syncer-weight", "0.7"]

    print("Photos :", len(faces))
    print("Driving:", driving.name)
    print("Moteurs:", " + ".join(processors))
    print("Device :", ",".join(providers))
    print("Sortie :", out)
    proc = subprocess.run(cmd, cwd=VENDOR)
    if proc.returncode == 0:
        print("OK →", out)
    return proc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
