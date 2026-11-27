/**
 * Client-side Geometric Visual Provenance Engine (RootSIFT-128D + 6-DOF Affine RANSAC + Shannon Entropy).
 * Enables real custom photo-chain analysis and ROI cropping directly in the browser without a Python server.
 */

export interface FrameROI {
  x: number; // [0..1]
  y: number; // [0..1]
  w: number; // [0..1]
  h: number; // [0..1]
}

export interface BrowserVisualFrame {
  id: string;
  label: string;
  year: number | string | null;
  location: string;
  source: string;
  is_control: boolean;
  data_url: string;
  roi?: FrameROI | null;
}

const WORK_SIZE = 280;

function shannonEntropy(p: number): number {
  const pc = Math.max(1e-6, Math.min(1 - 1e-6, p));
  return -(pc * Math.log2(pc) + (1 - pc) * Math.log2(1 - pc));
}

function loadImageElement(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image data URL'));
    img.src = dataUrl;
  });
}

function boxMean2D(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const win = 2 * radius + 1;

  // Horizontal pass
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let dx = -radius; dx <= radius; dx++) {
      const cx = Math.max(0, Math.min(w - 1, dx));
      sum += src[row + cx];
    }
    tmp[row] = sum / win;
    for (let x = 1; x < w; x++) {
      const xOut = Math.max(0, x - radius - 1);
      const xIn = Math.min(w - 1, x + radius);
      sum += src[row + xIn] - src[row + xOut];
      tmp[row + x] = sum / win;
    }
  }

  // Vertical pass
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let dy = -radius; dy <= radius; dy++) {
      const cy = Math.max(0, Math.min(h - 1, dy));
      sum += tmp[cy * w + x];
    }
    out[x] = sum / win;
    for (let y = 1; y < h; y++) {
      const yOut = Math.max(0, y - radius - 1);
      const yIn = Math.min(h - 1, y + radius);
      sum += tmp[yIn * w + x] - tmp[yOut * w + x];
      out[y * w + x] = sum / win;
    }
  }
  return out;
}

function extractNormalizedGray(
  img: HTMLImageElement,
  roi?: FrameROI | null,
): { gray: Float32Array; w: number; h: number; origW: number; origH: number; crop: FrameROI } {
  const origW = img.naturalWidth || img.width || 256;
  const origH = img.naturalHeight || img.height || 256;

  const crop: FrameROI = roi && roi.w > 0.08 && roi.h > 0.08
    ? {
        x: Math.max(0, Math.min(0.92, roi.x)),
        y: Math.max(0, Math.min(0.92, roi.y)),
        w: Math.max(0.08, Math.min(1 - Math.max(0, roi.x), roi.w)),
        h: Math.max(0.08, Math.min(1 - Math.max(0, roi.y), roi.h)),
      }
    : { x: 0, y: 0, w: 1, h: 1 };

  const sx = Math.round(crop.x * origW);
  const sy = Math.round(crop.y * origH);
  const sw = Math.max(32, Math.round(crop.w * origW));
  const sh = Math.max(32, Math.round(crop.h * origH));

  const scale = Math.min(1, WORK_SIZE / Math.max(sw, sh));
  const w = Math.max(64, Math.round(sw * scale));
  const h = Math.max(64, Math.round(sh * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return { gray: new Float32Array(w * h), w, h, origW, origH, crop };
  }
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const pixels = ctx.getImageData(0, 0, w, h).data;

  const raw = new Float32Array(w * h);
  const rawSq = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const g = (0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2]) / 255;
    raw[i] = g;
    rawSq[i] = g * g;
  }

  // Illumination & sepia invariance: local mean/std normalization
  const mean = boxMean2D(raw, w, h, 9);
  const meanSq = boxMean2D(rawSq, w, h, 9);
  const normed = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const std = Math.sqrt(Math.max(meanSq[i] - mean[i] * mean[i], 1e-5));
    const v = (raw[i] - mean[i]) / (std + 0.08);
    normed[i] = Math.max(0, Math.min(1, (v + 2.5) / 5.0));
  }

  return { gray: normed, w, h, origW, origH, crop };
}

function extractKeypointsAndRootSIFT(
  gray: Float32Array,
  w: number,
  h: number,
  maxKeypoints = 200,
): { kps: Array<[number, number, number]>; descs: Float32Array[] } {
  const margin = 14;
  const bottomMask = h > 160 ? 22 : 14;
  if (w <= 2 * margin + 12 || h <= margin + bottomMask + 12) {
    return { kps: [], descs: [] };
  }

  const smooth = boxMean2D(gray, w, h, 1);
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const mag = new Float32Array(w * h);
  const ori = new Float32Array(w * h);
  const gx2 = new Float32Array(w * h);
  const gy2 = new Float32Array(w * h);
  const gxy = new Float32Array(w * h);

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = y * w + x;
      const dx =
        smooth[idx - w + 1] - smooth[idx - w - 1] +
        2 * (smooth[idx + 1] - smooth[idx - 1]) +
        smooth[idx + w + 1] - smooth[idx + w - 1];
      const dy =
        smooth[idx + w - 1] - smooth[idx - w - 1] +
        2 * (smooth[idx + w] - smooth[idx - w]) +
        smooth[idx + w + 1] - smooth[idx - w + 1];
      gx[idx] = dx;
      gy[idx] = dy;
      mag[idx] = Math.hypot(dx, dy);
      ori[idx] = Math.atan2(dy, dx);
      gx2[idx] = dx * dx;
      gy2[idx] = dy * dy;
      gxy[idx] = dx * dy;
    }
  }

  const ixx = boxMean2D(gx2, w, h, 2);
  const iyy = boxMean2D(gy2, w, h, 2);
  const ixy = boxMean2D(gxy, w, h, 2);
  const harris = new Float32Array(w * h);
  const interiorVals: number[] = [];

  for (let y = margin; y < h - bottomMask; y++) {
    for (let x = margin; x < w - margin; x++) {
      const idx = y * w + x;
      const resp = (ixx[idx] * iyy[idx] - ixy[idx] * ixy[idx]) / (ixx[idx] + iyy[idx] + 1e-8);
      harris[idx] = resp;
      if (resp > 0) interiorVals.push(resp);
    }
  }

  if (interiorVals.length === 0) return { kps: [], descs: [] };
  interiorVals.sort((a, b) => a - b);
  const thresh = interiorVals[Math.floor(interiorVals.length * 0.90)] || 0;

  const candidates: Array<{ x: number; y: number; s: number }> = [];
  for (let y = margin; y < h - bottomMask; y++) {
    for (let x = margin; x < w - margin; x++) {
      const val = harris[y * w + x];
      if (val <= thresh) continue;
      let isMax = true;
      for (let dy = -3; dy <= 3 && isMax; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (harris[(y + dy) * w + (x + dx)] > val) {
            isMax = false;
            break;
          }
        }
      }
      if (isMax) candidates.push({ x, y, s: val });
    }
  }

  candidates.sort((a, b) => b.s - a.s);
  const selected = candidates.slice(0, maxKeypoints);

  const kps: Array<[number, number, number]> = [];
  const descs: Float32Array[] = [];
  const TWO_PI = Math.PI * 2;

  for (const pt of selected) {
    // Dominant orientation in 11x11 window (36 bins)
    const hist36 = new Float32Array(36);
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const idx = (pt.y + dy) * w + (pt.x + dx);
        const bin = Math.floor(((ori[idx] + Math.PI) / TWO_PI) * 36) % 36;
        hist36[(bin + 36) % 36] += mag[idx];
      }
    }
    let domBin = 0;
    for (let b = 1; b < 36; b++) {
      if (hist36[b] > hist36[domBin]) domBin = b;
    }
    const theta = (domBin + 0.5) * (TWO_PI / 36) - Math.PI;
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);

    // 16x16 rotated patch -> 4x4 cells x 8 orientation bins = 128-D RootSIFT
    const vec = new Float32Array(128);
    for (let py = 0; py < 16; py++) {
      const oy = py - 7.5;
      const cellY = Math.min(3, Math.max(0, Math.floor((oy + 8) / 4)));
      for (let px = 0; px < 16; px++) {
        const ox = px - 7.5;
        const cellX = Math.min(3, Math.max(0, Math.floor((ox + 8) / 4)));
        const gw = Math.exp(-(ox * ox + oy * oy) / (2 * 36));
        const rx = Math.max(1, Math.min(w - 2, Math.round(pt.x + cosT * ox - sinT * oy)));
        const ry = Math.max(1, Math.min(h - 2, Math.round(pt.y + sinT * ox + cosT * oy)));
        const idx = ry * w + rx;
        const relOri = ((ori[idx] - theta) % TWO_PI + TWO_PI) % TWO_PI;
        const bin8 = Math.floor((relOri / TWO_PI) * 8) % 8;
        vec[(cellY * 4 + cellX) * 8 + bin8] += mag[idx] * gw;
      }
    }

    // Clamp + RootSIFT L2 normalization
    let norm = 0;
    for (let k = 0; k < 128; k++) norm += vec[k] * vec[k];
    norm = Math.sqrt(norm) + 1e-8;
    let norm2 = 0;
    for (let k = 0; k < 128; k++) {
      vec[k] = Math.min(vec[k] / norm, 0.2);
      norm2 += vec[k] * vec[k];
    }
    norm2 = Math.sqrt(norm2) + 1e-8;
    let norm3 = 0;
    for (let k = 0; k < 128; k++) {
      vec[k] = Math.sqrt(Math.max(0, vec[k] / norm2));
      norm3 += vec[k] * vec[k];
    }
    norm3 = Math.sqrt(norm3) + 1e-8;
    for (let k = 0; k < 128; k++) vec[k] /= norm3;

    kps.push([pt.x, pt.y, theta]);
    descs.push(vec);
  }

  return { kps, descs };
}

function solve3x3(A: number[][], b: number[]): number[] | null {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let r = col + 1; r < 3; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    if (Math.abs(M[pivot][col]) < 1e-7) return null;
    if (pivot !== col) [M[col], M[pivot]] = [M[pivot], M[col]];
    const div = M[col][col];
    for (let j = col; j < 4; j++) M[col][j] /= div;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = col; j < 4; j++) M[r][j] -= f * M[col][j];
    }
  }
  return [M[0][3], M[1][3], M[2][3]];
}

function fitAffineLeastSquares(
  pts1: Array<[number, number]>,
  pts2: Array<[number, number]>,
  mask: boolean[],
): { mx: number[]; my: number[] } | null {
  const ata = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const atbx = [0, 0, 0];
  const atby = [0, 0, 0];
  let cnt = 0;
  for (let i = 0; i < pts1.length; i++) {
    if (!mask[i]) continue;
    cnt++;
    const x = pts1[i][0];
    const y = pts1[i][1];
    const row = [x, y, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) ata[r][c] += row[r] * row[c];
      atbx[r] += row[r] * pts2[i][0];
      atby[r] += row[r] * pts2[i][1];
    }
  }
  if (cnt < 3) return null;
  const mx = solve3x3(ata, atbx);
  const my = solve3x3(ata, atby);
  if (!mx || !my) return null;
  return { mx, my };
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function matchAndRansac(
  kps1: Array<[number, number, number]>,
  desc1: Float32Array[],
  kps2: Array<[number, number, number]>,
  desc2: Float32Array[],
) {
  if (kps1.length < 6 || kps2.length < 6) {
    return {
      putative_matches: 0,
      inliers: 0,
      inlier_ratio: 0,
      reprojection_rmse_px: null,
      matches: [],
      verdict: 'INSUFFICIENT_FEATURES',
      confidence: 0.05,
      shannon_entropy: Number(shannonEntropy(0.05).toFixed(4)),
    };
  }

  const n1 = desc1.length;
  const n2 = desc2.length;
  const simMat = new Float32Array(n1 * n2);
  const revBest = new Int32Array(n2);
  const revBestSim = new Float32Array(n2).fill(-2);

  for (let i = 0; i < n1; i++) {
    const d1 = desc1[i];
    for (let j = 0; j < n2; j++) {
      const d2 = desc2[j];
      let dot = 0;
      for (let k = 0; k < 128; k++) dot += d1[k] * d2[k];
      simMat[i * n2 + j] = dot;
      if (dot > revBestSim[j]) {
        revBestSim[j] = dot;
        revBest[j] = i;
      }
    }
  }

  const putative: Array<[number, number, number]> = [];
  for (let i = 0; i < n1; i++) {
    let b1 = -1;
    let b2 = -1;
    let s1 = -2;
    let s2 = -2;
    for (let j = 0; j < n2; j++) {
      const s = simMat[i * n2 + j];
      if (s > s1) {
        s2 = s1;
        b2 = b1;
        s1 = s;
        b1 = j;
      } else if (s > s2) {
        s2 = s;
        b2 = j;
      }
    }
    if (b1 < 0 || b2 < 0) continue;
    const dist1 = Math.sqrt(Math.max(0, 2 - 2 * Math.min(1, s1)));
    const dist2 = Math.sqrt(Math.max(0, 2 - 2 * Math.min(1, s2))) + 1e-8;
    if (dist1 / dist2 < 0.85 && revBest[b1] === i) {
      putative.push([i, b1, s1]);
    }
  }

  if (putative.length < 4) {
    const conf = 0.08;
    return {
      putative_matches: putative.length,
      inliers: 0,
      inlier_ratio: 0,
      reprojection_rmse_px: null,
      matches: [],
      verdict: 'KEINE_GEOMETRISCHE_KONSISTENZ',
      confidence: conf,
      shannon_entropy: Number(shannonEntropy(conf).toFixed(4)),
    };
  }

  const pts1: Array<[number, number]> = putative.map(([i]) => [kps1[i][0], kps1[i][1]]);
  const pts2: Array<[number, number]> = putative.map(([, j]) => [kps2[j][0], kps2[j][1]]);
  const nPut = putative.length;
  const rng = mulberry32(20261116);
  const inlierThreshPx = 7.0;

  let bestInliers = new Array<boolean>(nPut).fill(false);
  let bestCount = 0;

  for (let iter = 0; iter < 350; iter++) {
    const i0 = Math.floor(rng() * nPut);
    let i1 = Math.floor(rng() * nPut);
    if (i1 === i0) i1 = (i1 + 1) % nPut;
    let i2 = Math.floor(rng() * nPut);
    while (i2 === i0 || i2 === i1) i2 = (i2 + 1) % nPut;

    const A = [
      [pts1[i0][0], pts1[i0][1], 1],
      [pts1[i1][0], pts1[i1][1], 1],
      [pts1[i2][0], pts1[i2][1], 1],
    ];
    const mx = solve3x3(A, [pts2[i0][0], pts2[i1][0], pts2[i2][0]]);
    const my = solve3x3(A, [pts2[i0][1], pts2[i1][1], pts2[i2][1]]);
    if (!mx || !my) continue;

    // Determinant + aspect shear bounds to reject degenerate flips
    const det = mx[0] * my[1] - mx[1] * my[0];
    if (det < 0.15 || det > 6.5) continue;
    const tr = mx[0] * mx[0] + mx[1] * mx[1] + my[0] * my[0] + my[1] * my[1];
    const disc = Math.sqrt(Math.max(0, tr * tr - 4 * det * det));
    const sMax = Math.sqrt(Math.max(1e-6, (tr + disc) / 2));
    const sMin = Math.sqrt(Math.max(1e-6, (tr - disc) / 2));
    if (sMax / sMin > 3.2) continue;

    const cur = new Array<boolean>(nPut).fill(false);
    let count = 0;
    for (let k = 0; k < nPut; k++) {
      const px = mx[0] * pts1[k][0] + mx[1] * pts1[k][1] + mx[2];
      const py = my[0] * pts1[k][0] + my[1] * pts1[k][1] + my[2];
      if (Math.hypot(px - pts2[k][0], py - pts2[k][1]) < inlierThreshPx) {
        cur[k] = true;
        count++;
      }
    }
    if (count > bestCount) {
      bestCount = count;
      bestInliers = cur;
    }
  }

  let rmse: number | null = null;
  if (bestCount >= 4) {
    const refit = fitAffineLeastSquares(pts1, pts2, bestInliers);
    if (refit) {
      const errs: number[] = [];
      let newCount = 0;
      const nextMask = new Array<boolean>(nPut).fill(false);
      for (let k = 0; k < nPut; k++) {
        const px = refit.mx[0] * pts1[k][0] + refit.mx[1] * pts1[k][1] + refit.mx[2];
        const py = refit.my[0] * pts1[k][0] + refit.my[1] * pts1[k][1] + refit.my[2];
        const e = Math.hypot(px - pts2[k][0], py - pts2[k][1]);
        if (e < inlierThreshPx) {
          nextMask[k] = true;
          errs.push(e);
          newCount++;
        }
      }
      bestInliers = nextMask;
      bestCount = newCount;
      if (errs.length >= 4) {
        const mse = errs.reduce((acc, v) => acc + v * v, 0) / errs.length;
        rmse = Number(Math.sqrt(mse).toFixed(2));
      }
    }
  }

  const inlierRatio = Number((bestCount / Math.max(1, nPut)).toFixed(3));
  let rawConf: number;
  let verdict: string;
  if (bestCount >= 14 && inlierRatio >= 0.45) {
    rawConf = Math.min(0.96, 0.68 + 0.012 * Math.min(bestCount, 22) + 0.1 * inlierRatio);
    verdict = 'STARKE_INDIVIDUELLE_OBJEKTIDENTITAET';
  } else if (bestCount >= 7 && inlierRatio >= 0.3) {
    rawConf = Math.min(0.78, 0.45 + 0.025 * bestCount);
    verdict = 'WAHRSCHEINLICHE_KORRESPONDENZ_PRUEFBEDUERFTIG';
  } else {
    rawConf = Math.max(0.04, Math.min(0.28, 0.04 * bestCount));
    verdict = 'ABGELEHNT_KEINE_INDIVIDUELLE_UEBEREINSTIMMUNG';
  }

  const matchRecords = putative.map(([i, j, simVal], idx) => ({
    x1_px: kps1[i][0],
    y1_px: kps1[i][1],
    x2_px: kps2[j][0],
    y2_px: kps2[j][1],
    similarity: Number(simVal.toFixed(3)),
    inlier: bestCount >= 4 ? bestInliers[idx] : false,
  }));
  matchRecords.sort((a, b) => Number(b.inlier) - Number(a.inlier) || b.similarity - a.similarity);

  return {
    putative_matches: nPut,
    inliers: bestCount,
    inlier_ratio: inlierRatio,
    reprojection_rmse_px: rmse,
    matches: matchRecords.slice(0, 60),
    verdict,
    confidence: Number(rawConf.toFixed(3)),
    shannon_entropy: Number(shannonEntropy(rawConf).toFixed(4)),
  };
}

export async function analyzePhotoChainInBrowser(frames: BrowserVisualFrame[]) {
  const extracted = [];
  for (let idx = 0; idx < frames.length; idx++) {
    const f = frames[idx];
    const img = await loadImageElement(f.data_url);
    const { gray, w, h, origW, origH, crop } = extractNormalizedGray(img, f.roi);
    const { kps, descs } = extractKeypointsAndRootSIFT(gray, w, h, 200);
    extracted.push({
      index: idx,
      id: f.id || `frame_${idx}`,
      label: f.label || `Photo #${idx + 1}`,
      year: f.year ? Number(f.year) : null,
      location: f.location || '',
      source: f.source || '',
      is_control: Boolean(f.is_control),
      width: origW,
      height: origH,
      workW: w,
      workH: h,
      crop,
      keypoint_count: kps.length,
      kps,
      descs,
    });
  }

  const pairs = [];
  const temporalWarnings: string[] = [];

  for (let i = 0; i < extracted.length; i++) {
    for (let j = i + 1; j < extracted.length; j++) {
      const a = extracted[i];
      const b = extracted[j];
      const res = matchAndRansac(a.kps, a.descs, b.kps, b.descs);

      // Map crop-local pixel coords back to full-frame normalized [0..1]
      const relMatches = res.matches.map((m) => ({
        x1: Number((a.crop.x + (m.x1_px / a.workW) * a.crop.w).toFixed(4)),
        y1: Number((a.crop.y + (m.y1_px / a.workH) * a.crop.h).toFixed(4)),
        x2: Number((b.crop.x + (m.x2_px / b.workW) * b.crop.w).toFixed(4)),
        y2: Number((b.crop.y + (m.y2_px / b.workH) * b.crop.h).toFixed(4)),
        similarity: m.similarity,
        inlier: m.inlier,
      }));

      let temporalOk = true;
      if (a.year && b.year && !a.is_control && !b.is_control && a.year > b.year) {
        temporalOk = false;
        temporalWarnings.push(`${a.label} (${a.year}) > ${b.label} (${b.year})`);
      }

      pairs.push({
        pair_id: `${a.id}__vs__${b.id}`,
        index_a: i,
        index_b: j,
        label_a: a.label,
        label_b: b.label,
        year_a: a.year,
        year_b: b.year,
        location_a: a.location,
        location_b: b.location,
        involves_control: a.is_control || b.is_control,
        temporal_consistent: temporalOk,
        putative_matches: res.putative_matches,
        inliers: res.inliers,
        inlier_ratio: res.inlier_ratio,
        reprojection_rmse_px: res.reprojection_rmse_px,
        verdict: res.verdict,
        confidence: res.confidence,
        shannon_entropy: res.shannon_entropy,
        matches: relMatches,
      });
    }
  }

  const chainPairs = pairs.filter((p) => !p.involves_control && p.index_b === p.index_a + 1);
  const chainVerified = chainPairs.length > 0 && chainPairs.every((p) => p.inliers >= 7) && temporalWarnings.length === 0;

  return {
    success: true,
    engine: 'browser_rootsift_ransac',
    frame_summaries: extracted.map((x) => ({
      index: x.index,
      id: x.id,
      label: x.label,
      year: x.year,
      location: x.location,
      source: x.source,
      is_control: x.is_control,
      width: x.width,
      height: x.height,
      keypoint_count: x.keypoint_count,
    })),
    pairs,
    chain_verified: chainVerified,
    temporal_warnings: temporalWarnings,
    methodology: 'In-Browser RootSIFT-128D + 6-DOF Affine RANSAC + Shannon Entropy (Human-in-the-Loop)',
  };
}
