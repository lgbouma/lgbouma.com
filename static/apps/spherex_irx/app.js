"use strict";

// Constants (SI)
const h = 6.62607015e-34;
const c = 2.99792458e8;
const kB = 1.380649e-23;
const pc_m = 3.085677581491367e16;
const R_sun_m = 6.957e8;

// UI elements
const el = (id) => document.getElementById(id);
const teffEl = el("teff");
const tdustEl = el("tdust");
const distEl = el("distance");
const fdustEl = el("fdust");
const teffVal = el("teffVal");
const tdustVal = el("tdustVal");
const distanceVal = el("distanceVal");
const fdustVal = el("fdustVal");
const toggleSpherexBtn = el("toggleSpherex");
const resetBtn = el("resetBtn");
const detectionEl = el("detection");
const fitSummaryEl = el("fitSummary");
const photTableBody = el("photTable").querySelector("tbody");
const sphTableBody = el("spherexTable").querySelector("tbody");
const sphEffF = el("sphEffF");
const sphEffE = el("sphEffE");
const sphEffM = el("sphEffM");
const sphEffS = el("sphEffS");
const canvas = el("sedPlot");
const ctx = canvas.getContext("2d");
const tooltipEl = el("tooltip");
const readmeBtn = el("readmeBtn");
const readmeClose = el("readmeClose");
const readmeModal = el("readmeModal");
const readmeOverlay = el("readmeOverlay");

let useSpherex = true;
let hoverPoints = []; // populated each draw

// Mock bandpass definitions (top-hats in microns)
const bands = [
  // Gaia
  { key: "G_BP", label: "Gaia BP", lamMin: 0.33, lamMax: 0.68, frac: 0.02, floor_mJy: 0.02 },
  { key: "G", label: "Gaia G", lamMin: 0.33, lamMax: 1.05, frac: 0.02, floor_mJy: 0.02 },
  { key: "G_RP", label: "Gaia RP", lamMin: 0.64, lamMax: 1.00, frac: 0.02, floor_mJy: 0.02 },
  // 2MASS
  { key: "J", label: "2MASS J", lamMin: 1.10, lamMax: 1.40, frac: 0.03, floor_mJy: 0.05 },
  { key: "H", label: "2MASS H", lamMin: 1.50, lamMax: 1.80, frac: 0.03, floor_mJy: 0.05 },
  { key: "Ks", label: "2MASS Ks", lamMin: 2.00, lamMax: 2.32, frac: 0.03, floor_mJy: 0.05 },
  // WISE
  { key: "W1", label: "WISE W1", lamMin: 2.80, lamMax: 3.95, frac: 0.02, floor_mJy: 0.08 },
  { key: "W2", label: "WISE W2", lamMin: 4.10, lamMax: 5.10, frac: 0.02, floor_mJy: 0.11 },
];

// SPHEREx configuration
const sphRange = { min: 0.75, max: 5.01 };
const sphEffRange = { min: 2.40, max: 5.01 };
const sphFrac = 0.03;
const sphFloor_mJy = 0.3; // per spectral element
const sphBinsCount = 64; // bins across 0.75–5.01 µm

// SPHEREx photon-noise model parameters (tunable placeholders)
// These are generic defaults; adjust to match a specific survey depth.
const sphAeff_m2 = 0.02;      // effective collecting area in m^2 (placeholder)
const sphThroughput = 0.4;    // total system throughput [0–1] (placeholder)
const sphT_per_bin_s = 50;    // effective integration time per spectral bin (s) (placeholder)

function linspace(a, b, n) {
  const arr = new Array(n);
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) arr[i] = a + i * step;
  return arr;
}

// Planck function B_lambda(T, lambda) in W m^-2 sr^-1 m^-1
function B_lambda(T, lam_m) {
  const x = (h * c) / (lam_m * kB * T);
  const denom = Math.expm1(x);
  const pref = (2 * h * c * c) / Math.pow(lam_m, 5);
  return pref / denom;
}

// F_nu (Jy) at Earth for star-only with unit normalization s=1 being Omega=1 (dimensionless)
// More directly, we compute for a given normalization N (Omega), but for fitting we use s as multiplier of S_i(T) with N=1.
function Fnu_star_lambda_Jy(Tstar, lam_m, Omega /*dimensionless*/) {
  const F_lambda = Omega * Math.PI * B_lambda(Tstar, lam_m); // W m^-2 m^-1
  const F_nu = F_lambda * (lam_m * lam_m) / c; // W m^-2 Hz^-1
  return F_nu * 1e26; // Jy
}

// Dust normalization derived from bolometric ratio f_bol = fdust/fstar
function dustOmegaFromFbol(fdust, Tstar, Tdust, OmegaStar) {
  // f_bol = (Omega_d / Omega_star) * (T_d^4 / T_s^4)
  // => Omega_d = f_bol * Omega_star * (T_s/T_d)^4
  return fdust * OmegaStar * Math.pow(Tstar / Tdust, 4);
}

// Total F_nu (Jy) star + dust at a given lambda
function Fnu_total_lambda_Jy(params, lam_m) {
  const { Tstar, Tdust, fdust, dist_pc } = params;
  const d_m = dist_pc * pc_m;
  const OmegaStar = Math.pow(R_sun_m / d_m, 2);
  const OmegaDust = dustOmegaFromFbol(fdust, Tstar, Tdust, OmegaStar);
  const sStar = Fnu_star_lambda_Jy(Tstar, lam_m, OmegaStar);
  const sDust = Fnu_star_lambda_Jy(Tdust, lam_m, OmegaDust);
  return sStar + sDust;
}

// Star-only band-averaged flux template S_i(T) with Omega = 1 (memoized)
const S_cache = new Map();
function bandAvgStar_Jy_per_s(Tstar, lamMin_um, lamMax_um) {
  const key = `${Math.round(Tstar)}_${lamMin_um.toFixed(5)}_${lamMax_um.toFixed(5)}`;
  const hit = S_cache.get(key);
  if (hit !== undefined) return hit;
  const N = 200;
  const lam_um = linspace(lamMin_um, lamMax_um, N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    const lam_m = lam_um[i] * 1e-6;
    sum += Fnu_star_lambda_Jy(Tstar, lam_m, 1.0);
  }
  const val = sum / N; // Jy for s=1
  S_cache.set(key, val);
  return val;
}

// Observed band-averaged flux (Jy) star+dust
function bandAvgTotal_Jy(params, lamMin_um, lamMax_um) {
  const N = 200;
  const lam_um = linspace(lamMin_um, lamMax_um, N);
  let sum = 0;
  for (let i = 0; i < N; i++) {
    sum += Fnu_total_lambda_Jy(params, lam_um[i] * 1e-6);
  }
  return sum / N; // Jy
}

function fmtSci(val) {
  if (val === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(val)));
  const mant = val / Math.pow(10, exp);
  return mant.toFixed(2) + "e" + (exp >= 0 ? "+" : "") + exp;
}

// Build SPHEREx bins
function buildSpherexBins() {
  const edges = linspace(sphRange.min, sphRange.max, sphBinsCount + 1);
  const bins = [];
  for (let i = 0; i < edges.length - 1; i++) {
    bins.push({ min: edges[i], max: edges[i + 1] });
  }
  return bins;
}

const sphBins = buildSpherexBins();

// Measurement error model
function bandError_mJy(F_jy, frac, floor_mJy) {
  const fracTerm = F_jy * frac * 1000.0; // mJy
  return Math.sqrt(fracTerm * fracTerm + floor_mJy * floor_mJy);
}

// Photon (shot) noise for a given bin, returned in mJy
// N_gamma ≈ Fnu[Jy]*1e-26 * Aeff[m^2] * eta * t[s] * (Δλ[m] / (h * λ[m]))
// σ_ph(Jy) ≈ Fnu / sqrt(N_gamma)
function photonNoise_mJy(F_jy, lamMin_um, lamMax_um) {
  const lam_m = 0.5 * (lamMin_um + lamMax_um) * 1e-6;
  const dlam_m = (lamMax_um - lamMin_um) * 1e-6;
  if (!(lam_m > 0) || !(dlam_m > 0) || !(F_jy > 0)) return 0;
  const N_gamma = F_jy * 1e-26 * sphAeff_m2 * sphThroughput * sphT_per_bin_s * (dlam_m / (h * lam_m));
  if (!isFinite(N_gamma) || N_gamma <= 0) return 0;
  const sigmaJy = F_jy / Math.sqrt(N_gamma);
  return sigmaJy * 1000.0;
}

// Single blackbody fit: minimize chi^2 over T, analytic best s for each T
function fitSingleBB(dataPoints) {
  // dataPoints: [{ S_i_T:(T)=>Jy_per_s, F_i_obs:Jy, sigma_i:Jy }]
  let best = { T: null, s: null, chi2: Infinity };
  // Coarse-to-fine grid over T
  const coarseStep = 50;
  const fineStep = 10;
  const Tmin = 2500, Tmax = 8000;

  function solveForS(T) {
    let num = 0, den = 0;
    for (const d of dataPoints) {
      const S = d.S(T);
      const w = 1.0 / (d.sigmaJy * d.sigmaJy);
      num += S * d.FobsJy * w;
      den += S * S * w;
    }
    return den > 0 ? (num / den) : 0;
  }

  function chi2For(T, s) {
    let chi2 = 0;
    for (const d of dataPoints) {
      const model = s * d.S(T);
      const r = (d.FobsJy - model) / d.sigmaJy;
      chi2 += r * r;
    }
    return chi2;
  }

  // Coarse search
  for (let T = Tmin; T <= Tmax; T += coarseStep) {
    const s = solveForS(T);
    const chi2 = chi2For(T, s);
    if (chi2 < best.chi2) best = { T, s, chi2 };
  }
  // Fine search around best.T
  const T0 = best.T;
  best.chi2 = Infinity;
  for (let T = Math.max(Tmin, T0 - 200); T <= Math.min(Tmax, T0 + 200); T += fineStep) {
    const s = solveForS(T);
    const chi2 = chi2For(T, s);
    if (chi2 < best.chi2) best = { T, s, chi2 };
  }
  return best;
}

// Two-blackbody fit: minimize chi^2 over T_star, T_dust with analytic s_star, s_dust
function fitTwoBB(dataPoints) {
  let best = { Ts: null, Td: null, s1: 0, s2: 0, chi2: Infinity };
  const Tsmin = 2500, Tsmax = 8000;
  const Tdmin = 100, Tdmax = 1000;

  function solveForS(Ts, Td) {
    let A11 = 0, A22 = 0, A12 = 0, b1 = 0, b2 = 0;
    for (const d of dataPoints) {
      const X1 = d.S(Ts);
      const X2 = d.S(Td);
      const w = 1.0 / (d.sigmaJy * d.sigmaJy);
      A11 += w * X1 * X1;
      A22 += w * X2 * X2;
      A12 += w * X1 * X2;
      b1  += w * X1 * d.FobsJy;
      b2  += w * X2 * d.FobsJy;
    }
    const det = A11 * A22 - A12 * A12;
    if (det <= 0 || !isFinite(det)) return { s1: 0, s2: 0 };
    const s1 = ( A22 * b1 - A12 * b2) / det;
    const s2 = (-A12 * b1 + A11 * b2) / det;
    return { s1, s2 };
  }

  function chi2For(Ts, Td, s1, s2) {
    let chi2 = 0;
    for (const d of dataPoints) {
      const model = s1 * d.S(Ts) + s2 * d.S(Td);
      const r = (d.FobsJy - model) / d.sigmaJy;
      chi2 += r * r;
    }
    return chi2;
  }

  // Coarse grid
  for (let Ts = Tsmin; Ts <= Tsmax; Ts += 100) {
    for (let Td = Tdmin; Td <= Tdmax; Td += 50) {
      const { s1, s2 } = solveForS(Ts, Td);
      const chi2 = chi2For(Ts, Td, s1, s2);
      if (chi2 < best.chi2) best = { Ts, Td, s1, s2, chi2 };
    }
  }
  // Fine grid around best
  const Ts0 = best.Ts, Td0 = best.Td;
  best.chi2 = Infinity;
  for (let Ts = Math.max(Tsmin, Ts0 - 200); Ts <= Math.min(Tsmax, Ts0 + 200); Ts += 20) {
    for (let Td = Math.max(Tdmin, Td0 - 100); Td <= Math.min(Tdmax, Td0 + 100); Td += 10) {
      const { s1, s2 } = solveForS(Ts, Td);
      const chi2 = chi2For(Ts, Td, s1, s2);
      if (chi2 < best.chi2) best = { Ts, Td, s1, s2, chi2 };
    }
  }
  return best;
}

function compute() {
  // Read UI
  const Tstar = parseFloat(teffEl.value);
  const Tdust = parseFloat(tdustEl.value);
  const dist_pc = parseFloat(distEl.value);
  const fdust = Math.pow(10, parseFloat(fdustEl.value));

  teffVal.textContent = Tstar.toFixed(0);
  tdustVal.textContent = Tdust.toFixed(0);
  distanceVal.textContent = dist_pc.toFixed(0);
  fdustVal.textContent = fdust.toExponential(1);

  const params = { Tstar, Tdust, fdust, dist_pc };
  const d_m = dist_pc * pc_m;
  const OmegaStarTrue = Math.pow(R_sun_m / d_m, 2);

  // Build photometry (Gaia+2MASS+WISE)
  const phot = bands.map(b => {
    const FobsJy = bandAvgTotal_Jy(params, b.lamMin, b.lamMax);
    const sigma_mJy = bandError_mJy(FobsJy, b.frac, b.floor_mJy);
    return {
      key: b.key,
      label: b.label,
      lamMin: b.lamMin,
      lamMax: b.lamMax,
      FobsJy,
      sigmaJy: sigma_mJy / 1000.0,
      frac: b.frac,
      floor_mJy: b.floor_mJy,
      S: (T) => bandAvgStar_Jy_per_s(T, b.lamMin, b.lamMax),
    };
  });

  // Build SPHEREx spectral elements
  const sph = sphBins.map((bin) => {
    const FobsJy = bandAvgTotal_Jy(params, bin.min, bin.max);
    const sigmaFracFloor_mJy = bandError_mJy(FobsJy, sphFrac, sphFloor_mJy);
    const sigmaPhoton_mJy = photonNoise_mJy(FobsJy, bin.min, bin.max);
    const sigma_mJy = Math.hypot(sigmaFracFloor_mJy, sigmaPhoton_mJy);
    return {
      lamMin: bin.min,
      lamMax: bin.max,
      FobsJy,
      sigmaJy: sigma_mJy / 1000.0,
      S: (T) => bandAvgStar_Jy_per_s(T, bin.min, bin.max),
    };
  });

  // Decide which dataset to fit
  const fitDataset = useSpherex
    ? [...phot.filter(p => p.key.startsWith("G")), ...phot.filter(p => ["J","H","Ks"].includes(p.key)), ...sph]
    : [...phot];

  const fit = fitSingleBB(fitDataset);
  const fit2 = fitTwoBB(fitDataset);

  // Predicted star-only flux per phot band
  const modelPhot = phot.map(p => ({
    ...p,
    FmodelJy: fit.s * p.S(fit.T),
    residSig: (p.FobsJy - fit.s * p.S(fit.T)) / p.sigmaJy
  }));

  // Predicted star-only for SPHEREx
  const modelSph = sph.map(s => ({
    ...s,
    FmodelJy: fit.s * s.S(fit.T),
    residSig: (s.FobsJy - fit.s * s.S(fit.T)) / s.sigmaJy
  }));

  // Detection via ΔBIC = BIC_single - BIC_two
  const npts = fitDataset.length;
  const k1 = 2; // single-BB params
  const k2 = 4; // two-BB params
  const BIC1 = fit.chi2 + k1 * Math.log(npts);
  const BIC2 = fit2.chi2 + k2 * Math.log(npts);
  const dBIC = BIC1 - BIC2;
  const detected = dBIC >= 10;
  const detectionText = detected
    ? `IR excess detected (ΔBIC=${dBIC.toFixed(1)})`
    : `Excess not detected (ΔBIC=${dBIC.toFixed(1)})`;

  // For display: SPHEREx effective band diagnostics (still useful)
  if (useSpherex) {
    const effBins = modelSph.filter(b => b.lamMax > sphEffRange.min && b.lamMin < sphEffRange.max);
    let wsum = 0, ywsum = 0;
    for (const b of effBins) {
      const w = 1 / (b.sigmaJy * b.sigmaJy);
      ywsum += b.FobsJy * w;
      wsum += w;
    }
    const F_eff_obs = wsum > 0 ? (ywsum / wsum) : 0;
    const sigma_eff = wsum > 0 ? Math.sqrt(1 / wsum) : 0;
    const F_eff_model = bandAvgStar_Jy_per_s(fit.T, sphEffRange.min, sphEffRange.max) * fit.s;
    const rEff = sigma_eff > 0 ? (F_eff_obs - F_eff_model) / sigma_eff : 0;
    sphEffF.textContent = (F_eff_obs * 1000).toFixed(3);
    sphEffE.textContent = (sigma_eff * 1000).toFixed(3);
    sphEffM.textContent = (F_eff_model * 1000).toFixed(3);
    sphEffS.textContent = rEff.toFixed(2);
  }

  // Update status
  detectionEl.textContent = detectionText;
  detectionEl.className = `detect ${detected ? "ok" : "bad"}`;
  // Show only best-fit temperatures for single- and two-BB fits
  fitSummaryEl.textContent = `Single-BB: T = ${fit.T} K; Two-BB: Ts = ${fit2.Ts} K, Td = ${fit2.Td} K ${useSpherex ? "[Gaia+2MASS+SPHEREx]" : "[Gaia+2MASS+WISE]"}`;

  // Update tables
  photTableBody.innerHTML = "";
  for (const p of modelPhot) {
    const row = document.createElement("tr");
    const cols = [
      p.label,
      `${p.lamMin.toFixed(2)}–${p.lamMax.toFixed(2)}`,
      (p.FobsJy * 1000).toFixed(3),
      (p.sigmaJy * 1000).toFixed(3),
      (p.FmodelJy * 1000).toFixed(3),
      p.residSig.toFixed(2),
    ];
    for (const c of cols) { const td = document.createElement("td"); td.textContent = c; row.appendChild(td); }
    photTableBody.appendChild(row);
  }

  sphTableBody.innerHTML = "";
  for (const s of modelSph) {
    const row = document.createElement("tr");
    const cols = [
      `${s.lamMin.toFixed(3)}–${s.lamMax.toFixed(3)}`,
      (s.FobsJy * 1000).toFixed(3),
      (s.sigmaJy * 1000).toFixed(3),
      (s.FmodelJy * 1000).toFixed(3),
      s.residSig.toFixed(2),
    ];
    for (const c of cols) { const td = document.createElement("td"); td.textContent = c; row.appendChild(td); }
    sphTableBody.appendChild(row);
  }

  drawPlot(params, fit, modelPhot, modelSph);
}

function drawPlot(params, fit, modelPhot, modelSph) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  hoverPoints = [];
  // Axes ranges
  const xMin = 0.3, xMax = 6.0; // um
  // Estimate y range from data
  const allF = [];
  for (const p of modelPhot) allF.push(p.FobsJy);
  for (const s of modelSph) allF.push(s.FobsJy);
  const yMin = Math.max(1e-6, Math.min(...allF) * 0.4);
  const yMax = Math.max(...allF) * 2.5;

  function x2px(lam_um) {
    const lx = Math.log10(lam_um), lmin = Math.log10(xMin), lmax = Math.log10(xMax);
    return 60 + (W - 80) * (lx - lmin) / (lmax - lmin);
  }
  function y2px(F_jy) {
    const ly = Math.log10(F_jy), lmin = Math.log10(yMin), lmax = Math.log10(yMax);
    return H - 40 - (H - 80) * (ly - lmin) / (lmax - lmin);
  }

  // Axes
  ctx.strokeStyle = "#314258"; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(60, H - 40); ctx.lineTo(W - 20, H - 40); // x
  ctx.moveTo(60, H - 40); ctx.lineTo(60, 20); // y
  ctx.stroke();
  ctx.fillStyle = "#a6b0be"; ctx.font = "12px system-ui";
  ctx.fillText("Wavelength (µm)", W / 2 - 40, H - 12);
  ctx.save(); ctx.translate(18, H/2); ctx.rotate(-Math.PI/2); ctx.fillText("Fν (Jy)", 0, 0); ctx.restore();

  // Grid ticks (x)
  const xticks = [0.3,0.5,0.75,1,1.5,2,3,4,5,6];
  ctx.fillStyle = "#556274"; ctx.strokeStyle = "#273142";
  for (const x of xticks) { const px = x2px(x); ctx.beginPath(); ctx.moveTo(px, 20); ctx.lineTo(px, H-40); ctx.stroke(); ctx.fillText(x.toString(), px-8, H-24); }

  // Grid ticks (y, log scale) at powers of 10 Jy
  const eMin = Math.floor(Math.log10(yMin));
  const eMax = Math.ceil(Math.log10(yMax));
  for (let e = eMin; e <= eMax; e++) {
    const v = Math.pow(10, e);
    const py = y2px(v);
    ctx.beginPath(); ctx.moveTo(60, py); ctx.lineTo(W - 20, py); ctx.stroke();
    const label = e === 0 ? "1" : `1e${e}`;
    ctx.fillText(label, 12, py + 4);
  }

  // Star+dust spectral curve (thin)
  ctx.strokeStyle = "#4ad295"; ctx.lineWidth = 1.5;
  ctx.beginPath();
  let first = true;
  for (let lam = xMin; lam <= xMax; lam += 0.01) {
    const F = Fnu_total_lambda_Jy(params, lam * 1e-6);
    const x = x2px(lam); const y = y2px(Math.max(F, yMin));
    if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
  }
  ctx.stroke();

  // Star-only fitted model curve (dashed)
  ctx.strokeStyle = "#8aa3c2"; ctx.setLineDash([5,3]); ctx.lineWidth = 1.5;
  ctx.beginPath(); first = true;
  for (let lam = xMin; lam <= xMax; lam += 0.01) {
    const S = Fnu_star_lambda_Jy(fit.T, lam * 1e-6, fit.s);
    const x = x2px(lam); const y = y2px(Math.max(S, yMin));
    if (first) { ctx.moveTo(x, y); first = false; } else { ctx.lineTo(x, y); }
  }
  ctx.stroke(); ctx.setLineDash([]);

  // Photometry points with error bars (with caps)
  function drawPoint(lamMin, lamMax, F_jy, sigma_jy, color, name) {
    const lamC = 0.5 * (lamMin + lamMax);
    const x = x2px(lamC);
    const y = y2px(F_jy);
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = 1.8;
    // horizontal bar for band width
    ctx.beginPath(); ctx.moveTo(x2px(lamMin), y); ctx.lineTo(x2px(lamMax), y); ctx.stroke();
    // vertical error bar with caps
    const yTop = y2px(F_jy + sigma_jy), yBot = y2px(Math.max(F_jy - sigma_jy, yMin));
    ctx.beginPath(); ctx.moveTo(x, yTop); ctx.lineTo(x, yBot); ctx.stroke();
    const cap = 5;
    ctx.beginPath(); ctx.moveTo(x - cap, yTop); ctx.lineTo(x + cap, yTop); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - cap, yBot); ctx.lineTo(x + cap, yBot); ctx.stroke();
    // point marker
    ctx.beginPath(); ctx.arc(x, y, 3.2, 0, 2*Math.PI); ctx.fill();
    ctx.lineWidth = 1; // reset default

    // register for hover
    hoverPoints.push({ x, y, lamMin, lamMax, F_jy, sigma_jy, color, name });
  }

  // Color by survey
  function bandColor(key) {
    if (key.startsWith("G")) return "#58e8d6"; // Gaia
    if (["J","H","Ks"].includes(key)) return "#ffcc66"; // 2MASS
    if (["W1","W2"].includes(key)) return "#ff7693"; // WISE
    return "#c0c0c0";
  }

  for (const p of modelPhot) {
    const color = bandColor(p.key || "");
    drawPoint(p.lamMin, p.lamMax, p.FobsJy, p.sigmaJy, color, p.label);
  }
  if (useSpherex) for (const s of modelSph) drawPoint(s.lamMin, s.lamMax, s.FobsJy, s.sigmaJy, "#66aaff", `SPHEREx ${s.lamMin.toFixed(3)}–${s.lamMax.toFixed(3)} µm`);

  // Legend
  const legend = [
    { name: "Gaia", col: "#58e8d6" },
    { name: "2MASS", col: "#ffcc66" },
    { name: "WISE", col: "#ff7693" },
    ...(useSpherex ? [{ name: "SPHEREx", col: "#66aaff" }] : [])
  ];
  const lx = W - 160, ly = 26, lh = 18;
  ctx.fillStyle = "#0f1319"; ctx.strokeStyle = "#273142"; ctx.lineWidth = 1;
  ctx.fillRect(lx - 10, ly - 16, 150, legend.length * lh + 16);
  ctx.strokeRect(lx - 10, ly - 16, 150, legend.length * lh + 16);
  ctx.font = "12px system-ui";
  legend.forEach((e, i) => {
    ctx.fillStyle = e.col; ctx.fillRect(lx, ly + i * lh - 8, 20, 4);
    ctx.fillStyle = "#a6b0be"; ctx.fillText(e.name, lx + 28, ly + i * lh - 2);
  });
}

// Tooltip helpers
function showTooltip(pt, clientX, clientY) {
  const f_mJy = (pt.F_jy * 1000).toFixed(3);
  const s_mJy = (pt.sigma_jy * 1000).toFixed(3);
  tooltipEl.innerHTML = `
    <div style="font-weight:600; color:${pt.color}">${pt.name || "Band"}</div>
    <div style="color:#a6b0be">λ: ${pt.lamMin.toFixed(3)}–${pt.lamMax.toFixed(3)} µm</div>
    <div>Fν = ${f_mJy} ± ${s_mJy} mJy</div>
  `;
  tooltipEl.style.display = "block";
  const pad = 12;
  let left = clientX + pad + window.scrollX;
  let top = clientY + pad + window.scrollY;
  const rect = tooltipEl.getBoundingClientRect();
  const vw = window.innerWidth, vh = window.innerHeight;
  if (left + rect.width > vw - 8) left = clientX - rect.width - pad + window.scrollX;
  if (top + rect.height > vh - 8) top = clientY - rect.height - pad + window.scrollY;
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
}

function hideTooltip() {
  tooltipEl.style.display = "none";
}

canvas.addEventListener("mousemove", (e) => {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  let best = null; let bestD2 = Infinity;
  for (const p of hoverPoints) {
    const dx = x * (canvas.width / rect.width) - p.x; // handle CSS scaling
    const dy = y * (canvas.height / rect.height) - p.y;
    const d2 = dx*dx + dy*dy;
    if (d2 < bestD2) { bestD2 = d2; best = p; }
  }
  const r2 = 10 * 10; // hover radius squared in px
  if (best && bestD2 <= r2) {
    showTooltip(best, e.clientX, e.clientY);
  } else {
    hideTooltip();
  }
});

canvas.addEventListener("mouseleave", hideTooltip);

// UI wiring
toggleSpherexBtn.addEventListener("click", () => {
  useSpherex = !useSpherex;
  toggleSpherexBtn.classList.toggle("active", useSpherex);
  toggleSpherexBtn.textContent = `SPHEREx: ${useSpherex ? "ON" : "OFF"}`;
  compute();
});

for (const input of [teffEl, tdustEl, distEl, fdustEl]) {
  input.addEventListener("input", compute);
}

resetBtn.addEventListener("click", () => {
  teffEl.value = 5800; tdustEl.value = 300; distEl.value = 10; fdustEl.value = -3; useSpherex = true;
  toggleSpherexBtn.classList.add("active"); toggleSpherexBtn.textContent = "SPHEREx: ON";
  compute();
});

// README modal wiring
function openReadme(){
  readmeModal.classList.add("show");
  readmeOverlay.classList.add("show");
  readmeModal.setAttribute("aria-hidden","false");
  readmeOverlay.setAttribute("aria-hidden","false");
}
function closeReadme(){
  readmeModal.classList.remove("show");
  readmeOverlay.classList.remove("show");
  readmeModal.setAttribute("aria-hidden","true");
  readmeOverlay.setAttribute("aria-hidden","true");
}
readmeBtn.addEventListener("click", openReadme);
readmeClose.addEventListener("click", closeReadme);
readmeOverlay.addEventListener("click", closeReadme);
document.addEventListener("keydown", (e)=>{ if(e.key === "Escape") closeReadme(); });

// Initial compute
compute();
