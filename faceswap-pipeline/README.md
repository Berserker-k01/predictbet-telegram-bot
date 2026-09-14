# Pipeline ultra (local, gratuit)

Une seule install : **FaceFusion** enchaîne déjà tout ce qu’on avait listé.

| Moteur | Rôle |
| --- | --- |
| **Hyperswap 256** | Identité : peau, ovale, coupe |
| **LivePortrait** | Expressions + bouche fluides |
| **GFPGAN 1.4** | Grain de peau |
| **EDTalk** | Lèvres calées sur l’audio (`--lips`) |

Ta RTX 3050 Ti (4 Go) : boost `256x256` par défaut. Ne pas monter à 1024.

## 1. Install

Déjà fait sur cette machine : Python 3.12 (uv) + FaceFusion + CUDA + FFmpeg.

Pour réinstaller :

```powershell
cd faceswap-pipeline
.\setup.ps1
```

## 2. Médias

- `input/faces/` — **5 à 20 photos** de la même personne (face, ¾, coupe visible, même teint)
- `input/driving/` — la vidéo dont tu gardes le mouvement / le live rec

Uniquement des visages dont tu as le droit.

## 3. Rendu vidéo

Double-clic `START-ULTRA.bat` ou :

```powershell
.\run-ultra.ps1
.\run-ultra.ps1 --lips
```

La première fois, FaceFusion télécharge Hyperswap + LivePortrait + GFPGAN (quelques Go).

Sortie : `output/ultra-YYYYMMDD-HHMMSS.mp4`

## 4. Live webcam

Double-clic `START-LIVE.bat` ou `.\run-live.ps1`.

Dans l’UI : `face_swapper` + `expression_restorer` + `face_enhancer`.
