/*
 * Star cluster dissolution simulator
 *
 * This script implements a simple, computationally inexpensive model for the
 * dissolution of a star cluster orbiting in the plane of the Milky Way.
 * In the absence of the galactic dynamics library (e.g., gala), we
 * approximate the Milky Way potential by adopting a flat rotation curve.
 * Under this assumption the gravitational acceleration satisfies
 *
 *     a_R = -v0^2 / R,
 *
 * where R is the cylindrical galactocentric radius and v0 ≈ 220 km/s is the
 * amplitude of the rotation curve【170799744810650†L164-L170】.  A flat rotation curve
 * corresponds physically to a combination of a spherical nucleus and bulge,
 * a multi-component disk, and an extended dark matter halo whose inner
 * density falls off roughly as ρ ∝ R⁻²【170799744810650†L164-L170】.
 *
 * The simulation integrates the equations of motion for a population of
 * test particles (stars) subject to this force law.  Stars are initialized
 * in a small spherical distribution around a chosen galactocentric radius
 * and given a bulk circular velocity plus a Gaussian velocity dispersion.
 * Their positions are advanced in time using a simple explicit integrator.
 */

(function() {
  // Constants
  // Conversion factor from km/s to kpc/Myr.  One Myr = 1e6 yr; one year = 365.25*24*3600 s;
  // one kpc = 3.08567758149e16 km.  Therefore:
  const KM_PER_S_TO_KPC_PER_MYR = (1e6 * 365.25 * 24 * 3600) / 3.08567758149e16;
  // Parameters of the rotation curve following Eilers et al. (2019).  The
  // circular speed at the Solar radius (R0=8 kpc) is 229 km/s and the
  // gradient dvc/dR is −1.7 km s⁻¹ kpc⁻¹ for 5 ≤ R ≤ 25 kpc.  Outside this
  // interval the curve flattens at the values at R=5 and R=25.  We do not
  // explicitly specify a gravitational potential; instead we compute
  // a_R = −v_c(R)^2 / R to mimic the desired rotation curve.  The
  // conversion from km/s to kpc/Myr is applied downstream.
  const V0_KMS_SOLAR = 229;
  const SLOPE_DVC_DKPC = -1.7; // km/s per kpc

  // Gravitational constant in (kpc^3 / Msun / Myr^2)
  const G_KPC3_PER_MSUN_PER_MYR2 = 4.4985e-12;

  // GMC structural defaults
  const GMC_DEFAULTS = {
    beta: 1.8,                 // dN/dM ∝ M^-beta
    Mmin: 3e4,                 // Msun
    MmaxOuter: 3.2e6,          // Msun (outer disk)
    SigmaGMC_Msun_per_pc2: 120,
    epsFactor: 0.5,            // ε = epsFactor * R_eff
    H2_scaleheight_pc: 55,
    sigmaCloud_kms: 3.0,       // cloud CoM dispersion
    rForceCut_kpc: 1.5,        // neighbor cutoff (1.5 kpc)
    rebuildEvery: 5,           // steps between grid rebuilds
    lognSigma: 0.3             // lifetime ln scatter
  };

  /*
   * Non-axisymmetric rotating bar potential (quadrupole) parameters and helpers.
   * Assumptions:
   *  - Pattern speed Ω_bar ≈ 39 km s⁻¹ kpc⁻¹ (within 34–40; e.g., Bovy 2019; Monari et al. 2019; Binney 2020; Frankel et al. 2022).
   *  - Present-day bar angle ≈ 25° from the Sun–GC line (e.g., Bovy 2019).
   *  - Moderate bar strength Q_T ≈ 0.05 at R0, encoded via ε_bar = Q_T/2 ≈ 0.025.
   *  - Characteristic bar radius R_bar ≈ 5 kpc with a smooth outer taper; softening a ≈ 0.5 kpc.
   */
  const BAR_PARAMS = {
    patternSpeed_kms_per_kpc: 39, // km/s/kpc
    angle_deg: 25,                // degrees
    epsilon: 0.025,               // dimensionless bar strength parameter
    R0_kpc: 8.0,                  // Solar radius for normalization
    Rbar_kpc: 5.0,                // bar length scale
    taper_m: 4,                   // outer taper steepness
    soft_kpc: 0.5                 // softening length
  };
  const OMEGA_BAR_PER_MYR = BAR_PARAMS.patternSpeed_kms_per_kpc * KM_PER_S_TO_KPC_PER_MYR; // Myr^-1
  const PHI_BAR0_RAD = BAR_PARAMS.angle_deg * Math.PI / 180.0;
  const VC0_KPC_PER_MYR = (function(){
    // Use the rotation curve evaluated at R0 to set the amplitude
    return rotationCurve(BAR_PARAMS.R0_kpc) * KM_PER_S_TO_KPC_PER_MYR;
  })();
  // Base amplitude constant C = ε v0^2 R0^3 (units kpc^5 / Myr^2)
  const BAR_C = BAR_PARAMS.epsilon * (VC0_KPC_PER_MYR * VC0_KPC_PER_MYR) * Math.pow(BAR_PARAMS.R0_kpc, 3);

  /**
   * Piecewise linear rotation curve approximation.  Returns the circular
   * velocity (in km/s) at a given galactocentric radius R (kpc).  For
   * 5 ≤ R ≤ 25 kpc the velocity declines linearly from its value at the
   * Solar radius.  Inside 5 kpc the curve is held constant at the value
   * computed at R=5, and beyond 25 kpc it is held constant at the value at
   * R=25.
   *
   * @param {number} Rkpc - radial distance from the Galactic centre (kpc)
   * @returns {number} circular speed in km/s
   */
  function rotationCurve(Rkpc) {
    // Linear relation about 8 kpc: v_c(R) = v0 + slope * (R - 8)
    const vcLinear = V0_KMS_SOLAR + SLOPE_DVC_DKPC * (Rkpc - 8);
    // Evaluate the plateau values at 5 kpc and 25 kpc
    const vcAt5 = V0_KMS_SOLAR + SLOPE_DVC_DKPC * (5 - 8);
    const vcAt25 = V0_KMS_SOLAR + SLOPE_DVC_DKPC * (25 - 8);
    if (Rkpc < 5) {
      return vcAt5;
    } else if (Rkpc > 25) {
      return vcAt25;
    } else {
      return vcLinear;
    }
  }

  /**
   * Bar acceleration at (x,y) and time t (Myr) using a simple rotating quadrupole.
   * Φ_b ∝ ε v0^2 (R0/R)^3 cos(2[φ − Ω_b t − φ_b]);
   * a_R = +3C cos(2θ)/R^4, a_φ = +2C sin(2θ)/R^4 with C = ε v0^2 R0^3,
   * softened and tapered radially for realism and stability.
   */
  function barAcceleration(x, y, tMyr) {
    const r2 = x * x + y * y;
    const r2s = r2 + BAR_PARAMS.soft_kpc * BAR_PARAMS.soft_kpc; // softening
    const R = Math.sqrt(r2 + 1e-20);
    const phi = Math.atan2(y, x);
    const phiBar = PHI_BAR0_RAD - OMEGA_BAR_PER_MYR * tMyr;
    const theta = phi - phiBar;
    const cos2t = Math.cos(2 * theta);
    const sin2t = Math.sin(2 * theta);
    const taper = 1.0 / (1.0 + Math.pow(R / BAR_PARAMS.Rbar_kpc, BAR_PARAMS.taper_m));
    const denom = r2s * r2s; // ~ R^4 with softening
    const aR = (3.0 * BAR_C * cos2t * taper) / denom;
    const aPhi = (2.0 * BAR_C * sin2t * taper) / denom;
    const c = Math.cos(phi), s = Math.sin(phi);
    const ax = aR * c - aPhi * s;
    const ay = aR * s + aPhi * c;
    return { ax, ay };
  }

  // HTML elements
  const canvas = document.getElementById('canvas');
  const ctx = canvas.getContext('2d');
  const numStarsSlider = document.getElementById('numStars');
  const radiusSlider = document.getElementById('radius');
  const dispersionSlider = document.getElementById('dispersion');
  const timeRateSlider = document.getElementById('timeRate');
  const resetBtn = document.getElementById('resetBtn');
  // Bottom‑right playback controls and time display
  const playBtn = document.getElementById('playBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const timeDisplay = document.getElementById('timeDisplay');
  const numStarsVal = document.getElementById('numStarsVal');
  const radiusVal = document.getElementById('radiusVal');
  const dispersionVal = document.getElementById('dispersionVal');
  const timeRateVal = document.getElementById('timeRateVal');
  // GMC UI elements
  const enableGMC = document.getElementById('enableGMC');
  const numGMC = document.getElementById('numGMC');
  const numGMCVal = document.getElementById('numGMCVal');
  const tauGMC = document.getElementById('tauGMC');
  const tauGMCVal = document.getElementById('tauGMCVal');
  // README UI elements
  const openReadme = document.getElementById('openReadme');
  const readmeBackdrop = document.getElementById('readmeBackdrop');
  const readmeClose = document.getElementById('readmeClose');

  // State variables
  let stars = [];
  let running = true;
  let lastTimestamp = performance.now();
  let scale = 1;          // kpc to pixels
  let elapsedMyr = 0;      // total simulation time in megayears

  /**
   * Generate a normally distributed random number using the Box–Muller
   * transformation.  Returns a random variate with mean zero and unit
   * variance.
   */
  function gaussianRandom() {
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  }

  // ---------------- GMC (clumpy) potential manager ----------------
  class GMCManager {
    constructor(basePotential) {
      this.base = basePotential; // reserved for future coupling
      this.enabled = true;
      this.rng = Math.random;
      this.clouds = [];        // {x,y,vx,vy,M,eps,deathMyr}
      this.grid = new Map();   // "i,j" -> indices
      this.cell = GMC_DEFAULTS.rForceCut_kpc;
      this.stepsSinceRebuild = 0;
      this.targetN = 3000;
      this.tauMedMyr = 20;
    }

    // ----- Public API -----
    configureFromUI() {
      if (enableGMC) this.enabled = enableGMC.checked;
      if (numGMC) this.targetN = parseInt(numGMC.value, 10);
      if (tauGMC) this.tauMedMyr = parseFloat(tauGMC.value);
    }

    spawnInitial() {
      this.clouds = [];
      while (this.clouds.length < this.targetN) this.clouds.push(this._spawnOne());
      this._rebuildGrid();
    }

    step(dtMyr) {
      if (!this.enabled) return;
      // Advect clouds in the same background + bar field
      for (let c of this.clouds) {
        const r2 = c.x * c.x + c.y * c.y;
        if (r2 > 1e-12) {
          const R = Math.sqrt(r2);
          const vc = rotationCurve(R) * KM_PER_S_TO_KPC_PER_MYR;
          const f = - (vc * vc) / r2;
          let ax = f * c.x;
          let ay = f * c.y;
          const aBar = barAcceleration(c.x, c.y, elapsedMyr);
          ax += aBar.ax; ay += aBar.ay;
          c.vx += ax * dtMyr;
          c.vy += ay * dtMyr;
          c.x  += c.vx * dtMyr;
          c.y  += c.vy * dtMyr;
        }
      }
      // Lifecycle maintenance
      const now = elapsedMyr;
      for (let i = this.clouds.length - 1; i >= 0; --i) {
        if (now >= this.clouds[i].deathMyr) this.clouds.splice(i, 1);
      }
      while (this.clouds.length < this.targetN) this.clouds.push(this._spawnOne());
      // Periodic grid rebuild for neighbor queries
      this.stepsSinceRebuild++;
      if (this.stepsSinceRebuild >= GMC_DEFAULTS.rebuildEvery) {
        this._rebuildGrid();
        this.stepsSinceRebuild = 0;
      }
    }

    accelerationAt(x, y) {
      if (!this.enabled || this.clouds.length === 0) return { ax: 0, ay: 0 };
      const h = this.cell;
      const i0 = Math.floor(x / h), j0 = Math.floor(y / h);
      let ax = 0, ay = 0;
      for (let di = -1; di <= 1; di++) {
        for (let dj = -1; dj <= 1; dj++) {
          const key = `${i0 + di},${j0 + dj}`;
          const idxs = this.grid.get(key);
          if (!idxs) continue;
          for (let k = 0; k < idxs.length; k++) {
            const c = this.clouds[idxs[k]];
            const dx = x - c.x, dy = y - c.y;
            const r2 = dx * dx + dy * dy + c.eps * c.eps;
            const inv = 1.0 / Math.sqrt(r2 * r2 * r2);
            const fac = - G_KPC3_PER_MSUN_PER_MYR2 * c.M * inv;
            ax += fac * dx;
            ay += fac * dy;
          }
        }
      }
      return { ax, ay };
    }

    // ----- Internals -----
    _spawnOne() {
      // Mass
      const M = this._samplePowerLaw(GMC_DEFAULTS.beta, GMC_DEFAULTS.Mmin, this._MmaxOfR());
      // Size & softening
      const Sigma_kpc = GMC_DEFAULTS.SigmaGMC_Msun_per_pc2 * 1e6; // Msun/kpc^2
      const Reff = Math.sqrt(M / (Math.PI * Sigma_kpc));          // kpc
      const eps  = GMC_DEFAULTS.epsFactor * Reff;                  // kpc
      // Position from simple Σ_H2(R) ring + tail
      const { R, phi } = this._sampleRphi();
      const x = R * Math.cos(phi), y = R * Math.sin(phi);
      // Velocity: circular + small cloud dispersion
      const vc = rotationCurve(R) * KM_PER_S_TO_KPC_PER_MYR;
      const sig = GMC_DEFAULTS.sigmaCloud_kms * KM_PER_S_TO_KPC_PER_MYR;
      const vx =  vc * Math.sin(phi) + gaussianRandom() * sig; // reversed for clockwise
      const vy = -vc * Math.cos(phi) + gaussianRandom() * sig; // reversed for clockwise
      // Lifetime (log-normal around tauMed(R))
      const tauMed = this._tauMedOfR(R);
      const lnSigma = GMC_DEFAULTS.lognSigma;
      const tau = Math.exp(Math.log(tauMed) + lnSigma * gaussianRandom());
      return { x, y, vx, vy, M, eps, Reff, deathMyr: elapsedMyr + Math.max(5, tau) };
    }

    _rebuildGrid() {
      this.grid.clear();
      const h = this.cell;
      for (let idx = 0; idx < this.clouds.length; idx++) {
        const c = this.clouds[idx];
        const i = Math.floor(c.x / h), j = Math.floor(c.y / h);
        const key = `${i},${j}`;
        if (!this.grid.has(key)) this.grid.set(key, []);
        this.grid.get(key).push(idx);
      }
    }

    _samplePowerLaw(beta, xmin, xmax) {
      const u = Math.random();
      const b1 = 1.0 - beta;
      const x1 = Math.pow(xmax, b1), x0 = Math.pow(xmin, b1);
      return Math.pow(x0 + (x1 - x0) * u, 1.0 / b1);
    }

    _MmaxOfR() {
      // Simple constant fallback approximation
      return 3.16e6;
    }

    _tauMedOfR(R) {
      const val = 20 * (1 + 0.5 * (8 / Math.max(2, R)));
      return Math.max(10, Math.min(40, val));
    }

    _sampleRphi() {
      const Rmin = 3, Rmax = 12;
      const s1 = 1.2, mu1 = 5.5;
      const tail = (R) => Math.exp(-(R - 8) / 3);
      const ring = (R) => Math.exp(-0.5 * ((R - mu1) / s1) ** 2);
      const w = (R) => R * (ring(R) + 0.25 * Math.max(0, tail(R)));
      let R, y, ymax = w(mu1);
      do {
        R = Rmin + Math.random() * (Rmax - Rmin);
        y = Math.random() * ymax;
      } while (y > w(R));
      const phi = Math.random() * 2 * Math.PI;
      return { R, phi };
    }
  }

  // Instantiate GMC manager
  let gmc = new GMCManager();

  /**
   * Initialize the star cluster according to the current settings.  Stars
   * are distributed within a small sphere around the cluster center and
   * receive an isotropic Gaussian velocity dispersion.  A bulk circular
   * velocity equal to the rotation curve amplitude is added.
   */
  function initStars() {
    const n = parseInt(numStarsSlider.value, 10);
    const R = parseFloat(radiusSlider.value);
    const sigma_kms = parseFloat(dispersionSlider.value);
    const sigma = sigma_kms * KM_PER_S_TO_KPC_PER_MYR;
    stars = [];
    // Choose a small physical size for the cluster (in kpc).  We adopt 50 pc.
    const clusterRadius = 0.05; // 50 parsecs ≈ 0.05 kpc
    for (let i = 0; i < n; i++) {
      // Sample a random radius with uniform density in 3D (r^2 dr) collapsed to 2D
      const u = Math.random();
      const r = clusterRadius * Math.sqrt(u);
      const phi = Math.random() * 2 * Math.PI;
      const dx = r * Math.cos(phi);
      const dy = r * Math.sin(phi);
      // Position of the star in galactocentric coordinates
      const x = R + dx;
      const y = dy;
      // Bulk circular velocity at the cluster radius is tangential along +y direction
      const vc_kms = rotationCurve(R);
      const vc = vc_kms * KM_PER_S_TO_KPC_PER_MYR;
      let vx = 0;
      let vy = -vc; // negative for clockwise rotation
      // Add isotropic Gaussian velocity dispersion
      vx += gaussianRandom() * sigma;
      vy += gaussianRandom() * sigma;
      stars.push({ x: x, y: y, vx: vx, vy: vy });
    }
  }

  /**
   * Update the scale used to convert from physical units (kpc) to pixels.
   * The canvas is always centered on the galactic center; we scale so that
   * the simulation fits comfortably within the viewport even as the
   * galactocentric radius slider is adjusted.
   */
  function updateScale() {
    const R = parseFloat(radiusSlider.value);
    const maxRadius = Math.max(12, R * 1.5);
    // Determine the smaller of the two dimensions to preserve aspect ratio
    const minDim = Math.min(canvas.width, canvas.height);
    // Reserve a 10% margin around the edges
    scale = (minDim * 0.45) / maxRadius;
  }

  /**
   * Resize the canvas to match the window size.  Called on load and when
   * the window resizes.
   */
  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    updateScale();
  }

  /**
   * Advance the positions and velocities of all stars by an amount dt (in
   * Myr).  Accelerations are computed assuming a flat rotation curve.  The
   * integrator is a simple leapfrog-like explicit method suitable for
   * small time steps.
   *
   * @param {number} dtMyr - time step in megayears
   */
  function updatePositions(dtMyr) {
    const tNowMyr = elapsedMyr; // bar phase at start of step
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      const x = star.x;
      const y = star.y;
      const r2 = x * x + y * y;
      let axTot = 0;
      let ayTot = 0;
      // Axisymmetric background acceleration from rotation curve
      if (r2 > 1e-12) {
        const R = Math.sqrt(r2);
        const vc_kms = rotationCurve(R);
        const vc = vc_kms * KM_PER_S_TO_KPC_PER_MYR;
        const factor = - (vc * vc) / r2;
        axTot += factor * x;
        ayTot += factor * y;
      }
      // Add non-axisymmetric bar acceleration
      const aBar = barAcceleration(x, y, tNowMyr);
      axTot += aBar.ax;
      ayTot += aBar.ay;
      // Add GMC clumpy acceleration
      const aGMC = gmc.accelerationAt(x, y);
      axTot += aGMC.ax;
      ayTot += aGMC.ay;
      // Integrate velocities and positions
      star.vx += axTot * dtMyr;
      star.vy += ayTot * dtMyr;
      star.x += star.vx * dtMyr;
      star.y += star.vy * dtMyr;
    }
  }

  /**
   * Render the star cluster to the canvas.  Stars are drawn as single
   * white pixels.  The galactic center is at the centre of the canvas.  A
   * faint crosshair marks the origin for reference.
   */
  function draw() {
    // Clear the canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    // Draw grid (axes and reference circles at 5 and 10 kpc)
    drawGrid(cx, cy);
    // Draw each star
    ctx.fillStyle = '#fff';
    const s = scale;
    for (let i = 0; i < stars.length; i++) {
      const star = stars[i];
      const px = cx + star.x * s;
      const py = cy - star.y * s;
      // Only draw if within the canvas bounds
      if (px >= 0 && px < canvas.width && py >= 0 && py < canvas.height) {
        ctx.fillRect(Math.round(px), Math.round(py), 1, 1);
      }
    }
    // Draw rotating bar orientation as a semi-transparent line of length 8 kpc
    drawBar(cx, cy);
    // Draw GMC clumps as transparent circles scaled by Reff
    drawGMCs(cx, cy);
  }

  /**
   * Draw grid overlays: X and Y axes and circles at R=5 and R=10 kpc.
   * Uses lower opacity than the bar visualization.
   */
  function drawGrid(cx, cy) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    // X axis (Galactocentric X)
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(canvas.width, cy);
    ctx.stroke();
    // Y axis (Galactocentric Y)
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, canvas.height);
    ctx.stroke();
    // Reference circles at 5 kpc and 10 kpc
    const s = scale;
    const radii = [5, 10];
    for (let i = 0; i < radii.length; i++) {
      const r = radii[i] * s;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Draw the bar’s present orientation as a line of total length 8 kpc,
   * centered at the origin. Slightly heavier opacity than the grid.
   */
  function drawBar(cx, cy) {
    const halfLenKpc = 4.0; // total 8 kpc length
    const s = scale;
    // Bar phase: φ_bar(t) = φ_bar0 + Ω_bar t
    const phiBar = PHI_BAR0_RAD - OMEGA_BAR_PER_MYR * elapsedMyr;
    const dx = halfLenKpc * Math.cos(phiBar);
    const dy = halfLenKpc * Math.sin(phiBar);
    const x1 = cx + (-dx) * s;
    const y1 = cy - (-dy) * s; // minus for screen Y
    const x2 = cx + ( dx) * s;
    const y2 = cy - ( dy) * s;
    ctx.save();
    ctx.strokeStyle = 'rgba(180,180,180,0.35)'; // heavier than grid
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw GMC clumps as translucent circles. Radius scales with Reff.
   * Uses stroke only to keep rendering light.
   */
  function drawGMCs(cx, cy) {
    if (!gmc || !gmc.enabled || !gmc.clouds || gmc.clouds.length === 0) return;
    const s = scale;
    ctx.save();
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.18)';
    ctx.lineWidth = 1;
    const marginPx = 10;
    for (let i = 0; i < gmc.clouds.length; i++) {
      const c = gmc.clouds[i];
      const px = cx + c.x * s;
      const py = cy - c.y * s;
      const Reff = c.Reff ? c.Reff : (c.eps / GMC_DEFAULTS.epsFactor);
      const pr = Math.max(0.5, Reff * s); // at least half pixel radius
      if (px + pr < -marginPx || px - pr > canvas.width + marginPx ||
          py + pr < -marginPx || py - pr > canvas.height + marginPx) {
        continue;
      }
      ctx.beginPath();
      ctx.arc(px, py, pr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Animation loop.  Uses requestAnimationFrame to step the simulation at
   * the browser’s refresh rate.  The time step is scaled by the
   * time‑rate slider.
   *
   * @param {DOMHighResTimeStamp} timestamp - current time from requestAnimationFrame
   */
  function animate(timestamp) {
    if (!running) return;
    const deltaMs = timestamp - lastTimestamp;
    lastTimestamp = timestamp;
    const timeRate = parseFloat(timeRateSlider.value);
    const dtMyr = (deltaMs / 1000.0) * timeRate;
    // Advance GMC field and particle positions
    gmc.step(dtMyr);
    updatePositions(dtMyr);
    // Accumulate elapsed time and update readout
    elapsedMyr += dtMyr;
    timeDisplay.textContent = elapsedMyr.toFixed(1) + '\u00a0Myr';
    draw();
    requestAnimationFrame(animate);
  }

  /**
   * Update the numeric readouts next to each slider.
   */
  function updateReadouts() {
    numStarsVal.textContent = numStarsSlider.value;
    radiusVal.textContent = radiusSlider.value;
    dispersionVal.textContent = dispersionSlider.value;
    timeRateVal.textContent = timeRateSlider.value;
    if (numGMCVal) numGMCVal.textContent = numGMC.value;
    if (tauGMCVal) tauGMCVal.textContent = tauGMC.value;
  }

  /**
   * Reset the simulation with the current slider values.  Also updates
   * the scale and restarts the animation if necessary.
   */
  function resetSimulation() {
    updateScale();
    initStars();
    // Configure and (re)spawn GMCs from UI before running
    gmc.configureFromUI();
    gmc.spawnInitial();
    elapsedMyr = 0;
    timeDisplay.textContent = elapsedMyr.toFixed(1) + '\u00a0Myr';
    lastTimestamp = performance.now();
    // Automatically resume animation when resetting
    running = true;
    requestAnimationFrame(animate);
  }

  // Event listeners for controls
  numStarsSlider.addEventListener('input', () => {
    updateReadouts();
  });
  radiusSlider.addEventListener('input', () => {
    updateReadouts();
    updateScale();
  });
  dispersionSlider.addEventListener('input', updateReadouts);
  timeRateSlider.addEventListener('input', updateReadouts);
  resetBtn.addEventListener('click', resetSimulation);
  // GMC control listeners
  ;[enableGMC, numGMC, tauGMC].forEach(el => {
    if (!el) return;
    el.addEventListener('input', () => {
      updateReadouts();
      gmc.configureFromUI();
    });
  });
  // Playback control: pause halts the animation loop, play restarts it.
  pauseBtn.addEventListener('click', () => {
    running = false;
  });
  playBtn.addEventListener('click', () => {
    if (!running) {
      running = true;
      lastTimestamp = performance.now();
      requestAnimationFrame(animate);
    }
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    resizeCanvas();
    draw();
  });

  // README modal behavior
  function showReadme() {
    if (!readmeBackdrop) return;
    readmeBackdrop.style.display = 'flex';
    // Pause simulation while reading
    running = false;
  }
  function hideReadme() {
    if (!readmeBackdrop) return;
    readmeBackdrop.style.display = 'none';
  }
  if (openReadme) openReadme.addEventListener('click', showReadme);
  if (readmeClose) readmeClose.addEventListener('click', hideReadme);
  if (readmeBackdrop) {
    readmeBackdrop.addEventListener('click', (e) => {
      if (e.target === readmeBackdrop) hideReadme();
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && readmeBackdrop && readmeBackdrop.style.display === 'flex') {
      hideReadme();
    }
  });

  // Initialize simulation on page load
  updateReadouts();
  resizeCanvas();
  initStars();
  // Initialize GMCs from current UI state
  gmc.configureFromUI();
  gmc.spawnInitial();
  requestAnimationFrame(animate);
})();
