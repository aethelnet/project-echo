"""
PROJECT ECHO // VISUAL PROVENANCE & PHOTO-CHAIN RE-IDENTIFICATION ENGINE
Forensische Einzelobjekt-Wiedererkennung ueber historische Bildreihen (1884-heute)
ohne kulturell voreingenommene Semantik-Klassifikatoren:

1. Beleuchtungs- & Farbinvariante Vorverarbeitung (lokale Kontrastnormierung / CLAHE-Approximation),
   um Sepia-Glasplatten (1902), kontrastreiche Katalogdrucke (1908) und moderne Studiofotos (2024)
   auf dieselbe strukturelle Kanten-Domaene abzubilden.
2. Multiskalen-Strukturdetektor (Harris-Ecken auf Schnitzkerben, Perlenrastern, Bruchkanten) +
   rotationsinvariante 128-D RootSIFT-artige Gradienten-Patch-Deskriptoren.
3. Strikte geometrische Verifikation mittels 2D-Affin-RANSAC (6 Freiheitsgrade fuer Kameraneigung,
   Massstab, Ausschnitt und Rotation) + Rueckprojektionsfehler (RMSE).
4. Epistemische Unsicherheits-Kalibrierung ueber binaere Shannon-Entropie H(p) (`echo_lgnn_tensor.py`).
"""

import base64
import io
import math
import os
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
import torch

from backend.echo_lgnn_tensor import binary_shannon_entropy

WORK_SIZE = 384


def _load_normalized_gray(image_bytes: bytes, max_side: int = WORK_SIZE) -> Tuple[np.ndarray, int, int, float]:
    """Laedt ein Bild, skaliert es proportional auf max_side und normiert lokale Beleuchtung."""
    with Image.open(io.BytesIO(image_bytes)) as im:
        im_rgb = im.convert("RGB")
        orig_w, orig_h = im_rgb.size
        scale = min(1.0, float(max_side) / float(max(orig_w, orig_h)))
        new_w = max(64, int(round(orig_w * scale)))
        new_h = max(64, int(round(orig_h * scale)))
        im_small = im_rgb.resize((new_w, new_h), Image.Resampling.BILINEAR)
        gray = np.asarray(im_small.convert("L"), dtype=np.float32) / 255.0

    # Beleuchtungs- & Sepia-Invarianz: lokale Mittelwert-/Varianz-Normierung
    local_mean = ndimage.uniform_filter(gray, size=25, mode="reflect")
    local_sq = ndimage.uniform_filter(gray * gray, size=25, mode="reflect")
    local_std = np.sqrt(np.maximum(local_sq - local_mean * local_mean, 1e-5))
    normed = (gray - local_mean) / (local_std + 0.08)
    normed = np.clip((normed + 2.5) / 5.0, 0.0, 1.0)
    return normed, orig_w, orig_h, scale


def extract_structural_keypoints_and_descriptors(
    normed_gray: np.ndarray,
    max_keypoints: int = 260,
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Extrahiert markante Mikrostruktur-Punkte (Harris-Response ueber 2 Skalen)
    und berechnet rotationsnormierte 128-D RootSIFT-artige Gradienten-Deskriptoren.
    Returns:
      keypoints: (N, 3) -> [x, y, orientation_rad] im skalierten Arbeitsbild
      descriptors: (N, 128) float32, L2-normiert
    """
    h, w = normed_gray.shape
    margin = 18
    if h <= 2 * margin + 8 or w <= 2 * margin + 8:
        return np.zeros((0, 3), dtype=np.float32), np.zeros((0, 128), dtype=np.float32)

    smooth = ndimage.gaussian_filter(normed_gray, sigma=1.1)
    gx = ndimage.sobel(smooth, axis=1)
    gy = ndimage.sobel(smooth, axis=0)
    mag = np.hypot(gx, gy)
    ori = np.arctan2(gy, gx)  # [-pi, pi]

    # Multiskalen-Harris-Response
    ixx = ndimage.gaussian_filter(gx * gx, sigma=1.8)
    iyy = ndimage.gaussian_filter(gy * gy, sigma=1.8)
    ixy = ndimage.gaussian_filter(gx * gy, sigma=1.8)
    det = ixx * iyy - ixy * ixy
    trace = ixx + iyy + 1e-8
    harris = det / trace

    # Unterdruecke Bildrand, Beschriftungsleiste unten & lokale Nicht-Maxima
    harris[:margin, :] = 0.0
    harris[-38:, :] = 0.0
    harris[:, :margin] = 0.0
    harris[:, -margin:] = 0.0

    local_max = ndimage.maximum_filter(harris, size=7)
    mask = (harris == local_max) & (harris > np.percentile(harris[margin:-margin, margin:-margin], 92.0))
    ys, xs = np.nonzero(mask)
    if len(xs) == 0:
        return np.zeros((0, 3), dtype=np.float32), np.zeros((0, 128), dtype=np.float32)

    scores = harris[ys, xs]
    order = np.argsort(-scores)[:max_keypoints]
    xs = xs[order]
    ys = ys[order]

    # Vorbereitete Koordinaten fuer 16x16 Patch (4x4 Zellen, 8 Orientierungs-Bins = 128-D)
    grid_r = np.linspace(-7.5, 7.5, 16, dtype=np.float32)
    py_off, px_off = np.meshgrid(grid_r, grid_r, indexing="ij")
    gauss_win = np.exp(-(px_off * px_off + py_off * py_off) / (2.0 * 6.0 * 6.0)).astype(np.float32)

    cell_idx_y = np.clip(((py_off + 8.0) / 4.0).astype(np.int32), 0, 3)
    cell_idx_x = np.clip(((px_off + 8.0) / 4.0).astype(np.int32), 0, 3)
    cell_flat = cell_idx_y * 4 + cell_idx_x  # 0..15

    kps = []
    descs = []

    for x0, y0 in zip(xs, ys):
        # Dominante lokale Orientierung im 11x11-Fenster (36 Bins -> Rotationsinvarianz)
        win_m = mag[y0 - 5 : y0 + 6, x0 - 5 : x0 + 6]
        win_o = ori[y0 - 5 : y0 + 6, x0 - 5 : x0 + 6]
        bins36 = np.floor(((win_o + math.pi) / (2.0 * math.pi)) * 36.0).astype(np.int32) % 36
        hist36 = np.bincount(bins36.ravel(), weights=win_m.ravel(), minlength=36)
        dom_bin = int(np.argmax(hist36))
        theta = (dom_bin + 0.5) * (2.0 * math.pi / 36.0) - math.pi

        cos_t = math.cos(theta)
        sin_t = math.sin(theta)
        rx = x0 + cos_t * px_off - sin_t * py_off
        ry = y0 + sin_t * px_off + cos_t * py_off

        ix = np.clip(np.round(rx).astype(np.int32), 1, w - 2)
        iy = np.clip(np.round(ry).astype(np.int32), 1, h - 2)

        p_mag = mag[iy, ix] * gauss_win
        p_ori = (ori[iy, ix] - theta + 2.0 * math.pi) % (2.0 * math.pi)
        bin8 = np.floor((p_ori / (2.0 * math.pi)) * 8.0).astype(np.int32) % 8

        idx128 = cell_flat * 8 + bin8
        vec = np.bincount(idx128.ravel(), weights=p_mag.ravel(), minlength=128).astype(np.float32)

        # SIFT Clamping + RootSIFT (Hellinger-Kern ist deutlich robuster bei historischen Belichtungswechseln)
        norm1 = float(np.linalg.norm(vec)) + 1e-8
        vec = np.minimum(vec / norm1, 0.2)
        vec /= float(np.linalg.norm(vec)) + 1e-8
        vec = np.sqrt(np.maximum(vec, 0.0))
        vec /= float(np.linalg.norm(vec)) + 1e-8

        kps.append([float(x0), float(y0), float(theta)])
        descs.append(vec)

    return np.asarray(kps, dtype=np.float32), np.asarray(descs, dtype=np.float32)


def match_descriptors_and_ransac_affine(
    kps1: np.ndarray,
    desc1: np.ndarray,
    kps2: np.ndarray,
    desc2: np.ndarray,
    ratio_thresh: float = 0.84,
    inlier_thresh_px: float = 6.5,
    ransac_iters: int = 350,
) -> Dict[str, Any]:
    """
    Paart lokale Struktur-Deskriptoren per gegenseitigem Lowe-Ratio-Test und prueft mit
    deterministischem 2D-Affin-RANSAC, ob beide Aufnahmen physikalisch dasselbe Einzelobjekt zeigen.
    """
    if len(kps1) < 6 or len(kps2) < 6:
        return {
            "putative_matches": 0,
            "inliers": 0,
            "inlier_ratio": 0.0,
            "reprojection_rmse_px": None,
            "matches": [],
            "verdict": "INSUFFICIENT_FEATURES",
            "confidence": 0.05,
            "shannon_entropy": float(binary_shannon_entropy(torch.tensor([0.05])).item()),
        }

    # Cosine similarity auf L2-normierten RootSIFT-Vektoren -> euklidische Distanz
    sim = np.clip(desc1 @ desc2.T, -1.0, 1.0)
    dist = np.sqrt(np.maximum(0.0, 2.0 - 2.0 * sim))

    # Vorwaerts-Ratio-Test (1 -> 2) & Rueckwaerts-Bester (2 -> 1)
    best2_idx = np.argsort(dist, axis=1)[:, :2]
    rev_best = np.argmin(dist, axis=0)

    putative: List[Tuple[int, int, float]] = []
    for i in range(len(desc1)):
        j1, j2 = int(best2_idx[i, 0]), int(best2_idx[i, 1])
        d1, d2 = float(dist[i, j1]), float(dist[i, j2]) + 1e-8
        if d1 / d2 < ratio_thresh and int(rev_best[j1]) == i:
            putative.append((i, j1, float(sim[i, j1])))

    if len(putative) < 4:
        conf = 0.08
        return {
            "putative_matches": len(putative),
            "inliers": 0,
            "inlier_ratio": 0.0,
            "reprojection_rmse_px": None,
            "matches": [],
            "verdict": "KEINE_GEOMETRISCHE_KONSISTENZ",
            "confidence": conf,
            "shannon_entropy": round(float(binary_shannon_entropy(torch.tensor([conf])).item()), 4),
        }

    pts1 = np.array([[kps1[i, 0], kps1[i, 1]] for i, _, _ in putative], dtype=np.float64)
    pts2 = np.array([[kps2[j, 0], kps2[j, 1]] for _, j, _ in putative], dtype=np.float64)
    n_put = len(putative)

    rng = np.random.default_rng(20261116)
    best_inliers = np.zeros(n_put, dtype=bool)
    best_model = None

    ones = np.ones((n_put, 1), dtype=np.float64)
    X_all = np.hstack([pts1, ones])  # (N, 3)

    for _ in range(ransac_iters):
        idx = rng.choice(n_put, size=3, replace=False)
        X_sub = X_all[idx]
        if abs(np.linalg.det(X_sub)) < 1e-3:
            continue
        try:
            # 2D Affine Matrix M (3x2): pts2 ~= [pts1, 1] @ M
            M = np.linalg.solve(X_sub, pts2[idx])
        except np.linalg.LinAlgError:
            continue

        # Plausibilitaetscheck gegen degenerierte Scherung / Spiegelung: det(A_2x2) > 0.15
        A2 = M[:2, :]
        det_a = float(np.linalg.det(A2))
        if det_a < 0.15 or det_a > 6.5:
            continue
        svd_s = np.linalg.svd(A2, compute_uv=False)
        if svd_s[1] < 1e-3 or (svd_s[0] / svd_s[1]) > 3.2:
            continue

        pred = X_all @ M
        err = np.hypot(pred[:, 0] - pts2[:, 0], pred[:, 1] - pts2[:, 1])
        inliers = err < inlier_thresh_px
        if int(np.sum(inliers)) > int(np.sum(best_inliers)):
            best_inliers = inliers
            best_model = M

    inlier_count = int(np.sum(best_inliers))
    rmse = None
    if inlier_count >= 4:
        # Kleinste-Quadrate-Nachschaetzung auf allen Inliers
        M_refit, _, _, _ = np.linalg.lstsq(X_all[best_inliers], pts2[best_inliers], rcond=None)
        pred_all = X_all @ M_refit
        err_all = np.hypot(pred_all[:, 0] - pts2[:, 0], pred_all[:, 1] - pts2[:, 1])
        best_inliers = err_all < inlier_thresh_px
        inlier_count = int(np.sum(best_inliers))
        if inlier_count >= 4:
            rmse = round(float(np.sqrt(np.mean(err_all[best_inliers] ** 2))), 2)

    inlier_ratio = round(inlier_count / float(max(1, n_put)), 3)

    # Kalibrierte forensische Konfidenz (streng: ohne >= 8 geometrische Inliers NIEMALS hoch!)
    if inlier_count >= 14 and inlier_ratio >= 0.45:
        raw_conf = min(0.96, 0.68 + 0.012 * min(inlier_count, 22) + 0.10 * inlier_ratio)
        verdict = "STARKE_INDIVIDUELLE_OBJEKTIDENTITAET"
    elif inlier_count >= 7 and inlier_ratio >= 0.30:
        raw_conf = min(0.78, 0.45 + 0.025 * inlier_count)
        verdict = "WAHRSCHEINLICHE_KORRESPONDENZ_PRUEFBEDUERFTIG"
    else:
        raw_conf = max(0.04, min(0.28, 0.04 * inlier_count))
        verdict = "ABGELEHNT_KEINE_INDIVIDUELLE_UEBEREINSTIMMUNG"

    entropy = float(binary_shannon_entropy(torch.tensor([raw_conf])).item())

    match_records = []
    for k_idx, (i, j, sim_val) in enumerate(putative):
        match_records.append(
            {
                "x1_norm": round(float(kps1[i, 0]), 2),
                "y1_norm": round(float(kps1[i, 1]), 2),
                "x2_norm": round(float(kps2[j, 0]), 2),
                "y2_norm": round(float(kps2[j, 1]), 2),
                "similarity": round(sim_val, 3),
                "inlier": bool(best_inliers[k_idx]) if inlier_count >= 4 else False,
            }
        )
    # Sortiere Inliers nach oben fuer klare UI-Darstellung
    match_records.sort(key=lambda m: (not m["inlier"], -m["similarity"]))

    return {
        "putative_matches": n_put,
        "inliers": inlier_count,
        "inlier_ratio": inlier_ratio,
        "reprojection_rmse_px": rmse,
        "matches": match_records[:60],
        "verdict": verdict,
        "confidence": round(raw_conf, 3),
        "shannon_entropy": round(entropy, 4),
    }


def analyze_photo_chain(frames: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Analysiert eine Serie von 2..N Aufnahmen (jeweils `image_bytes`, `label`, `year`, `location`, `source`).
    Berechnet alle relevanten Paarvergleiche + Zeit-Raum-Plausibilitaet.
    """
    extracted = []
    for idx, f in enumerate(frames):
        gray, orig_w, orig_h, scale = _load_normalized_gray(f["image_bytes"])
        h_s, w_s = gray.shape
        kps, desc = extract_structural_keypoints_and_descriptors(gray)
        # Normiere Koordinaten auf [0..1] relativ zur Bildgroesse fuer responsives UI-Canvas!
        if len(kps) > 0:
            kps_rel = kps.copy()
            kps_rel[:, 0] /= float(w_s)
            kps_rel[:, 1] /= float(h_s)
        else:
            kps_rel = kps

        extracted.append(
            {
                "index": idx,
                "id": f.get("id") or f"frame_{idx}",
                "label": f.get("label") or f"Aufnahme #{idx + 1}",
                "year": f.get("year"),
                "location": f.get("location") or "",
                "source": f.get("source") or "",
                "is_control": bool(f.get("is_control", False)),
                "width": orig_w,
                "height": orig_h,
                "keypoint_count": int(len(kps)),
                "kps_px": kps,
                "kps_rel": kps_rel,
                "desc": desc,
                "work_w": w_s,
                "work_h": h_s,
            }
        )

    pairs = []
    temporal_warnings = []

    # Chronologische Hauptkette (alle nicht als Negativprobe markierten Bilder, plus direkte Vergleiche zu Kontrollen)
    for i in range(len(extracted)):
        for j in range(i + 1, len(extracted)):
            a, b = extracted[i], extracted[j]
            res = match_descriptors_and_ransac_affine(a["kps_px"], a["desc"], b["kps_px"], b["desc"])

            # Konvertiere Match-Koordinaten auf [0..1] fuer Frontend-Overlay
            rel_matches = []
            for m in res["matches"]:
                rel_matches.append(
                    {
                        "x1": round(m["x1_norm"] / float(a["work_w"]), 4),
                        "y1": round(m["y1_norm"] / float(a["work_h"]), 4),
                        "x2": round(m["x2_norm"] / float(b["work_w"]), 4),
                        "y2": round(m["y2_norm"] / float(b["work_h"]), 4),
                        "similarity": m["similarity"],
                        "inlier": m["inlier"],
                    }
                )

            temporal_ok = True
            if a["year"] and b["year"] and not a["is_control"] and not b["is_control"]:
                if int(a["year"]) > int(b["year"]):
                    temporal_ok = False
                    temporal_warnings.append(
                        f"Chronologie-Konflikt zwischen '{a['label']}' ({a['year']}) und '{b['label']}' ({b['year']})."
                    )

            pairs.append(
                {
                    "pair_id": f"{a['id']}__vs__{b['id']}",
                    "index_a": i,
                    "index_b": j,
                    "label_a": a["label"],
                    "label_b": b["label"],
                    "year_a": a["year"],
                    "year_b": b["year"],
                    "location_a": a["location"],
                    "location_b": b["location"],
                    "involves_control": a["is_control"] or b["is_control"],
                    "temporal_consistent": temporal_ok,
                    "putative_matches": res["putative_matches"],
                    "inliers": res["inliers"],
                    "inlier_ratio": res["inlier_ratio"],
                    "reprojection_rmse_px": res["reprojection_rmse_px"],
                    "verdict": res["verdict"],
                    "confidence": res["confidence"],
                    "shannon_entropy": res["shannon_entropy"],
                    "matches": rel_matches,
                }
            )

    chain_frames = [x for x in extracted if not x["is_control"]]
    chain_pairs = [
        p for p in pairs if not p["involves_control"] and p["index_b"] == p["index_a"] + 1
    ]
    chain_verified = bool(chain_pairs) and all(p["inliers"] >= 7 for p in chain_pairs) and not temporal_warnings

    return {
        "success": True,
        "frame_summaries": [
            {
                "index": x["index"],
                "id": x["id"],
                "label": x["label"],
                "year": x["year"],
                "location": x["location"],
                "source": x["source"],
                "is_control": x["is_control"],
                "width": x["width"],
                "height": x["height"],
                "keypoint_count": x["keypoint_count"],
            }
            for x in extracted
        ],
        "pairs": pairs,
        "chain_verified": chain_verified,
        "temporal_warnings": temporal_warnings,
        "methodology": "RootSIFT-128D Local Structure + 6-DOF Affine RANSAC + Shannon Entropy Calibration (Human-in-the-Loop)",
    }


# =============================================================================
# ARCHIVAL DEMO SERIES GENERATOR (3 EPOCHS OF SAME INDIVIDUAL + 1 DECOY OBJECT)
# =============================================================================
def _draw_carved_subject_plate(
    variant: str,
    seed_individual: int,
    bg_rgb: Tuple[int, int, int],
    fg_rgb: Tuple[int, int, int],
    accent_rgb: Tuple[int, int, int],
    angle_deg: float,
    scale_factor: float,
    shift_xy: Tuple[int, int],
    sepia_grain: float = 0.0,
) -> bytes:
    """
    Zeichnet eine hochdetaillierte museale/historische Tafelaufnahme eines geschnitzten Kulturguts.
    `seed_individual=1` erzeugt exakt dasselbe physische Individuum (inkl. individueller Schnitzkerben,
    asymmetrischer Kronenzacken und Perlenraster) unter wechselnder Perspektive, Belichtung und Alterung.
    `seed_individual=2` erzeugt ein zweites Objekt derselben allgemeinen Formklasse, aber mit anderer
    individueller Mikrogeometrie (Negativprobe gegen kulturelle Pauschal-Verwechslung!).
    """
    W, H = 420, 460
    canvas_img = Image.new("RGBA", (W, H), (*bg_rgb, 255))
    obj_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(obj_layer)

    rng = np.random.default_rng(1000 + seed_individual * 97)
    cx, cy = W // 2, H // 2 + 12

    # 1. Individuelles Kronen-/Kopfaufsatz-Polygon (asymmetrische handgeschnitzte Zacken)
    crown_pts = []
    n_peaks = 7 if seed_individual == 1 else 6
    for k in range(n_peaks * 2 + 1):
        frac = k / float(n_peaks * 2)
        x = cx - 76 + frac * 152
        if k % 2 == 1:
            jitter_y = int(rng.integers(-14, 15))
            y = cy - 165 + jitter_y
        else:
            y = cy - 118 + int(rng.integers(-5, 6))
        crown_pts.append((x, y))
    crown_pts.extend([(cx + 68, cy - 88), (cx - 68, cy - 88)])
    d.polygon(crown_pts, fill=(*fg_rgb, 255), outline=(*accent_rgb, 255))

    # 2. Korpus / Gesichtsschild & Sockel
    head_w = 64 if seed_individual == 1 else 56
    d.polygon(
        [
            (cx - head_w, cy - 90),
            (cx + head_w, cy - 90),
            (cx + head_w + 10, cy + 8),
            (cx + 42, cy + 82),
            (cx - 42, cy + 82),
            (cx - head_w - 10, cy + 8),
        ],
        fill=(*fg_rgb, 255),
        outline=(*accent_rgb, 255),
    )
    # Sockel mit individueller historischer Abschlagkante links
    pedestal = [
        (cx - 54, cy + 82),
        (cx + 56, cy + 82),
        (cx + 66, cy + 148),
        (cx - 62, cy + 148),
        (cx - 66, cy + 114) if seed_individual == 1 else (cx - 58, cy + 95),
    ]
    d.polygon(pedestal, fill=(*fg_rgb, 255), outline=(*accent_rgb, 255))

    # 3. Individuelle Schnitz-Landmarken, Narbenlinien & Kauriperlen-Konstellation
    eye_dx = 28 if seed_individual == 1 else 21
    eye_y = cy - 44 if seed_individual == 1 else cy - 32
    for sgn in (-1, 1):
        ex = cx + sgn * eye_dx
        d.polygon(
            [(ex - 16, eye_y), (ex, eye_y - 10), (ex + 16, eye_y), (ex, eye_y + 10)],
            outline=(*accent_rgb, 255),
            fill=(bg_rgb[0] // 2 + fg_rgb[0] // 2, bg_rgb[1] // 2 + fg_rgb[1] // 2, bg_rgb[2] // 2 + fg_rgb[2] // 2, 255),
        )
        d.ellipse((ex - 4, eye_y - 4, ex + 4, eye_y + 4), fill=(*accent_rgb, 255))

    # Nasensteg + Stirn-Rautengravur
    d.polygon([(cx - 7, eye_y - 24), (cx + 7, eye_y - 24), (cx + 11, cy + 18), (cx - 11, cy + 18)], outline=(*accent_rgb, 255))

    # 28 individuelle Schnitzkerben & Perlenknoten (der "Fingerabdruck" des Schnitzers!)
    for _ in range(34):
        px = int(cx + rng.integers(-52, 53))
        py = int(cy + rng.integers(-115, 132))
        kind = int(rng.integers(0, 3))
        if kind == 0:
            r = int(rng.integers(3, 6))
            d.rectangle((px - r, py - r, px + r, py + r), outline=(*accent_rgb, 255), width=2)
        elif kind == 1:
            dx = int(rng.integers(7, 16))
            dy = int(rng.integers(-10, 11))
            d.line((px - dx, py - dy, px + dx, py + dy), fill=(*accent_rgb, 255), width=2)
        else:
            d.polygon([(px, py - 5), (px + 5, py), (px, py + 5), (px - 5, py)], outline=(*accent_rgb, 255))

    # Perspektive / Kamerarotation / Skalierung anwenden
    scaled_w = int(round(W * scale_factor))
    scaled_h = int(round(H * scale_factor))
    transformed = obj_layer.resize((scaled_w, scaled_h), Image.Resampling.BICUBIC)
    transformed = transformed.rotate(angle_deg, resample=Image.Resampling.BICUBIC, expand=False)

    paste_x = (W - scaled_w) // 2 + shift_xy[0]
    paste_y = (H - scaled_h) // 2 + shift_xy[1]
    canvas_img.alpha_composite(transformed, dest=(paste_x, paste_y))

    rgb = np.asarray(canvas_img.convert("RGB"), dtype=np.float32)

    # Epochenspezifische Alterung (1902 Glasplatten-Korn & Vignette vs 1908 Druckraster vs 2024 Studio)
    if sepia_grain > 0.0:
        g_rng = np.random.default_rng(42 + int(abs(angle_deg) * 10))
        yy, xx = np.mgrid[0:H, 0:W]
        rad = np.hypot((xx - W / 2.0) / (W / 2.0), (yy - H / 2.0) / (H / 2.0))
        vignette = np.clip(1.0 - 0.28 * sepia_grain * (rad ** 2), 0.55, 1.0)[..., None]
        noise = g_rng.normal(0.0, 11.0 * sepia_grain, size=rgb.shape)
        rgb = np.clip(rgb * vignette + noise, 0, 255)

    out_im = Image.fromarray(rgb.astype(np.uint8), mode="RGB")
    draw_meta = ImageDraw.Draw(out_im)
    draw_meta.rectangle((8, H - 26, W - 8, H - 8), fill=(18, 18, 18))
    draw_meta.text((14, H - 21), variant, fill=(242, 242, 238))

    buf = io.BytesIO()
    out_im.save(buf, format="PNG")
    return buf.getvalue()


def get_or_create_demo_photo_series(cache_dir: str) -> List[Dict[str, Any]]:
    """Erzeugt (einmalig gecacht) die 4-teilige forensische Referenz-Bildreihe inkl. Base64-Vorschau."""
    os.makedirs(cache_dir, exist_ok=True)
    specs = [
        {
            "id": "plate_1902_kimbo",
            "filename": "01_1902_Kimbo_Glasplatte.png",
            "label": "Feldaufnahme Glasplatte (Kimbo, 1902)",
            "year": 1902,
            "location": "Kimbo / Kumbo (Nso, Kamerun)",
            "source": "Nachlass Schutztruppe / Expedition Pavel (Archivabzug)",
            "is_control": False,
            "render_kwargs": dict(
                variant="ARCHIV-TAFEL I // KIMBO 1902 (GLASPLATTE)",
                seed_individual=1,
                bg_rgb=(218, 203, 176),
                fg_rgb=(84, 62, 42),
                accent_rgb=(238, 224, 196),
                angle_deg=-6.5,
                scale_factor=0.94,
                shift_xy=(-8, 4),
                sepia_grain=1.0,
            ),
        },
        {
            "id": "plate_1908_umlauff",
            "filename": "02_1908_Umlauff_Katalog_Hamburg.png",
            "label": "Verkaufskatalog J.F.G. Umlauff (Hamburg, 1908)",
            "year": 1908,
            "location": "Hamburg (Handelshaus Umlauff)",
            "source": "Katalogtafel Nr. 14, Pos. 418 (ohne Ursprungs-Inv.)",
            "is_control": False,
            "render_kwargs": dict(
                variant="KATALOG J.F.G. UMLAUFF // HAMBURG 1908",
                seed_individual=1,
                bg_rgb=(236, 236, 236),
                fg_rgb=(36, 36, 36),
                accent_rgb=(215, 215, 215),
                angle_deg=4.0,
                scale_factor=1.02,
                shift_xy=(10, -6),
                sepia_grain=0.45,
            ),
        },
        {
            "id": "plate_2024_depot",
            "filename": "03_2024_Depot_Neuaufnahme.png",
            "label": "Heutige Depot-Digitalisierung (Berlin, 2024)",
            "year": 2024,
            "location": "Berlin (Museumsdepot)",
            "source": "Bestandsdigitalisierung 'Unbekannter Altbestand'",
            "is_control": False,
            "render_kwargs": dict(
                variant="DEPOT-DIGITALISAT // BERLIN 2024 (FARBE)",
                seed_individual=1,
                bg_rgb=(242, 245, 249),
                fg_rgb=(112, 68, 38),
                accent_rgb=(228, 188, 124),
                angle_deg=1.2,
                scale_factor=0.98,
                shift_xy=(2, 2),
                sepia_grain=0.0,
            ),
        },
        {
            "id": "control_other_carving",
            "filename": "04_Negativprobe_Andere_Schnitzarbeit.png",
            "label": "Negativprobe: Verwandter Stil, anderes Objekt",
            "year": 1911,
            "location": "Stuttgart (Vergleichsstueck)",
            "source": "Kontrollprobe gegen kulturelle Pauschal-Verwechslung",
            "is_control": True,
            "render_kwargs": dict(
                variant="NEGATIVPROBE // VERWANDTER STIL (ANDERES UNIKAT)",
                seed_individual=2,
                bg_rgb=(238, 240, 242),
                fg_rgb=(98, 62, 38),
                accent_rgb=(224, 192, 138),
                angle_deg=0.0,
                scale_factor=0.98,
                shift_xy=(0, 0),
                sepia_grain=0.1,
            ),
        },
    ]

    frames = []
    for sp in specs:
        fpath = os.path.join(cache_dir, sp["filename"])
        if not os.path.exists(fpath):
            raw_bytes = _draw_carved_subject_plate(**sp["render_kwargs"])
            with open(fpath, "wb") as f:
                f.write(raw_bytes)
        else:
            with open(fpath, "rb") as f:
                raw_bytes = f.read()

        frames.append(
            {
                "id": sp["id"],
                "label": sp["label"],
                "year": sp["year"],
                "location": sp["location"],
                "source": sp["source"],
                "is_control": sp["is_control"],
                "image_bytes": raw_bytes,
                "data_url": "data:image/png;base64," + base64.b64encode(raw_bytes).decode("ascii"),
            }
        )
    return frames
