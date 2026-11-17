// pulze-nam.js - Converte un file .nam nel blocco CLO che il Pulze Mini carica come Sound Clone, come fa
// l'app Hotone (lib5868USB.so, classe HTKPA). Porta in JavaScript di ricerca-nam/ (nam_a2.py, htkpa.py,
// converti.py), verificata col Python e con la cattura del 6 novembre (captures/2026-11-06-nam).
// Puro: gira nel browser (anche in un Worker) e in Node.
//
// Il flusso: il NAM suona un segnale di prova fisso (nam/segnale-prova-48k.s24: nostro, sintetico, fatto da ricerca-nam/genera44.py, v7;
// sul modello di quello dell'app, 70 s, 24 bit) → uscita × 0,31 quantizzata a 16 bit (l'app
// la passa da un WAV) → HTKPA.startClone stima distorsione + IR d'ingresso (128) + IR d'uscita (2048) →
// il CLO da 8840 byte con le IR a 44,1 kHz, che al Mini arrivano riportate a 48 kHz (i primi 8192 byte).
(function (g) {
  'use strict';

  const EPS = 1.1920929e-07;
  const FLT_MAX = 3.4028235e38;

  // ---------------------------------------------------------------- FFT (radice 2 e Bluestein)
  const cacheTw = new Map();
  function fft2(re, im, inv) {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) {
      let b = n >> 1;
      for (; j & b; b >>= 1) j ^= b;
      j ^= b;
      if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    let tw = cacheTw.get(n);
    if (!tw) {
      tw = { c: new Float64Array(n / 2), s: new Float64Array(n / 2) };
      for (let i = 0; i < n / 2; i++) { tw.c[i] = Math.cos(2 * Math.PI * i / n); tw.s[i] = Math.sin(2 * Math.PI * i / n); }
      cacheTw.set(n, tw);
    }
    const sg = inv ? 1 : -1;
    for (let len = 2; len <= n; len <<= 1) {
      const h = len >> 1, st = n / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < h; k++) {
          const wr = tw.c[k * st], wi = sg * tw.s[k * st];
          const a = i + k, b = a + h;
          const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        }
      }
    }
  }
  /** DFT di qualunque lunghezza, sul posto, senza 1/N. */
  function fft(re, im, inv) {
    const n = re.length;
    if ((n & (n - 1)) === 0) { fft2(re, im, inv); return; }
    let m = 1; while (m < 2 * n - 1) m <<= 1;
    const sg = inv ? 1 : -1;
    const wr = new Float64Array(n), wi = new Float64Array(n);
    for (let k = 0; k < n; k++) { const a = Math.PI * ((k * k) % (2 * n)) / n; wr[k] = Math.cos(a); wi[k] = sg * Math.sin(a); }
    const ar = new Float64Array(m), ai = new Float64Array(m), br = new Float64Array(m), bi = new Float64Array(m);
    for (let k = 0; k < n; k++) {
      ar[k] = re[k] * wr[k] - im[k] * wi[k]; ai[k] = re[k] * wi[k] + im[k] * wr[k];
    }
    br[0] = wr[0]; bi[0] = -wi[0];
    for (let k = 1; k < n; k++) { br[k] = br[m - k] = wr[k]; bi[k] = bi[m - k] = -wi[k]; }
    fft2(ar, ai, false); fft2(br, bi, false);
    for (let k = 0; k < m; k++) { const r = ar[k] * br[k] - ai[k] * bi[k]; ai[k] = ar[k] * bi[k] + ai[k] * br[k]; ar[k] = r; }
    fft2(ar, ai, true);
    for (let k = 0; k < n; k++) {
      const r = ar[k] / m, i = ai[k] / m;
      re[k] = r * wr[k] - i * wi[k]; im[k] = r * wi[k] + i * wr[k];
    }
  }
  /** |rfft(x)|, parte reale e immaginaria (nb = n/2+1). */
  function rfft(x, n) {
    const re = new Float64Array(n), im = new Float64Array(n);
    re.set(x.length > n ? x.subarray(0, n) : x);
    fft(re, im, false);
    const nb = (n >> 1) + 1;
    return { re: re.subarray(0, nb), im: im.subarray(0, nb) };
  }

  // ---------------------------------------------------------------- filtri e convoluzioni
  /** np.convolve(x, h)[:len(x)]: diretta per h corte, a blocchi FFT per le lunghe. */
  function conv(x, h) {
    const N = x.length, M = h.length, y = new Float64Array(N);
    if (M <= 160) {
      for (let n = 0; n < N; n++) {
        let s = 0; const kmax = Math.min(M - 1, n);
        for (let k = 0; k <= kmax; k++) s += h[k] * x[n - k];
        y[n] = s;
      }
      return y;
    }
    let F = 1; while (F < 4 * M) F <<= 1;
    const B = F - M + 1;
    const hr = new Float64Array(F), hi = new Float64Array(F); hr.set(h); fft2(hr, hi, false);
    const re = new Float64Array(F), im = new Float64Array(F);
    for (let s = 0; s < N; s += B) {
      re.fill(0); im.fill(0);
      re.set(x.subarray(s, Math.min(N, s + B)));
      fft2(re, im, false);
      for (let k = 0; k < F; k++) { const r = re[k] * hr[k] - im[k] * hi[k]; im[k] = re[k] * hi[k] + im[k] * hr[k]; re[k] = r; }
      fft2(re, im, true);
      const fine = Math.min(N, s + F);
      for (let n = s; n < fine; n++) y[n] += re[n - s] / F;
    }
    return y;
  }
  /** lfilter([b0 b1 b2], [1 a1 a2], x) */
  function biq(x, c) {
    const y = new Float64Array(x.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let n = 0; n < x.length; n++) {
      const v = c[0] * x[n] + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      x2 = x1; x1 = x[n]; y2 = y1; y1 = v; y[n] = v;
    }
    return y;
  }
  /** cascata di passa-tutto del primo ordine (a + z^-1)/(1 + a z^-1), sul posto */
  function ap(x, coefs) {
    for (const a of coefs) {
      let x1 = 0, y1 = 0;
      for (let n = 0; n < x.length; n++) { const v = a * x[n] + x1 - a * y1; x1 = x[n]; y1 = v; x[n] = v; }
    }
    return x;
  }
  const UP0 = [0.04572814702987671, 0.3325011134147644, 0.6632020473480225, 0.9338558316230774,
    0.16808754205703735, 0.5044857263565063, 0.8037808537483215];
  const UP1 = [0.05423077940940857, 0.3987969756126404, 0.8629178404808044, 0.19969958066940308, 0.6210968494415283];
  const DN0 = [0.05421752482652664, 0.3830873370170593, 0.7487209439277649,
    0.19679796695709229, 0.5731363892555237, 0.9142937064170837];
  const DN1 = [0.07076594978570938, 0.5131675601005554, 0.25785309076309204, 0.8173173666000366];
  function up2(x, c) {
    const h = c.length - (c.length >> 1);
    const a = ap(Float64Array.from(x), c.slice(0, h)), b = ap(Float64Array.from(x), c.slice(h));
    const out = new Float64Array(2 * x.length);
    for (let i = 0; i < x.length; i++) { out[2 * i] = a[i]; out[2 * i + 1] = b[i]; }
    return out;
  }
  function down2(x, c) {
    const h = c.length - (c.length >> 1), n = x.length >> 1;
    const p0 = new Float64Array(n), p1 = new Float64Array(n);
    for (let i = 0; i < n; i++) { p0[i] = x[2 * i]; p1[i] = x[2 * i + 1]; }
    ap(p0, c.slice(0, h)); ap(p1, c.slice(h));
    const out = new Float64Array(n);
    for (let i = 0; i < n; i++) out[i] = (p0[i] + (i ? p1[i - 1] : 0)) * 0.5;
    return out;
  }

  // ---------------------------------------------------------------- resample_poly di scipy
  function besselI0(x) {
    let s = 1, t = 1;
    for (let k = 1; k < 60; k++) { t *= (x / (2 * k)) * (x / (2 * k)); s += t; if (t < 1e-17 * s) break; }
    return s;
  }
  const cacheFir = new Map();
  function firResample(up, down) {
    const key = up + '/' + down;
    if (cacheFir.has(key)) return cacheFir.get(key);
    const mr = Math.max(up, down), fc = 1 / mr, half = 10 * mr, N = 2 * half + 1;
    const h = new Float64Array(N); let s = 0;
    const beta = 5.0, i0b = besselI0(beta);
    for (let i = 0; i < N; i++) {
      const m = i - (N - 1) / 2, a = fc * m;
      const sinc = a === 0 ? 1 : Math.sin(Math.PI * a) / (Math.PI * a);
      const r = 2 * i / (N - 1) - 1;
      const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / i0b;
      h[i] = fc * sinc * w; s += h[i];
    }
    for (let i = 0; i < N; i++) h[i] = h[i] / s * up;
    const r = { h, half };
    cacheFir.set(key, r);
    return r;
  }
  /** scipy.signal.resample_poly(x, up, down) con padtype 'constant' (zeri). */
  function resamplePoly(x, up, down) {
    const { h: h0, half } = firResample(up, down);
    const nPre = down - (half % down);
    const h = new Float64Array(nPre + h0.length); h.set(h0, nPre);
    const nIn = x.length, nOut = Math.floor((nIn * up + down - 1) / down);
    const pre = Math.floor((half + nPre) / down);
    const out = new Float64Array(nOut);
    for (let o = 0; o < nOut; o++) {
      const t = (o + pre) * down;              // indice nel segnale sovracampionato
      let s = 0;
      for (let k = t % up; k < h.length && k <= t; k += up) {
        const i = (t - k) / up;
        if (i < nIn) s += h[k] * x[i];
      }
      out[o] = s;
    }
    return out;
  }

  // ---------------------------------------------------------------- piccoli strumenti di HTKPA
  const mel = f => 2595.0 * Math.log10(f / 700.0 + 1.0);
  const imel = m => (Math.pow(10, m / 2595.0) - 1.0) * 700.0;
  function linspace(a, b, n) {
    const o = new Float64Array(n);
    if (n === 1) { o[0] = a; return o; }
    const st = (b - a) / (n - 1);
    for (let i = 0; i < n; i++) o[i] = a + i * st;
    o[n - 1] = b;
    return o;
  }
  /** HTKPA::interp1 (come htkpa.py). */
  function interp1(xs, ys, xq) {
    const n = xs.length, sl = new Float64Array(n), ic = new Float64Array(n);
    for (let i = 0; i < n - 1; i++) { sl[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]); ic[i] = ys[i] - sl[i] * xs[i]; }
    sl[n - 1] = sl[n - 2]; ic[n - 1] = ic[n - 2];
    const out = new Float64Array(xq.length);
    let j = -1;
    for (let q = 0; q < xq.length; q++) {
      const v = xq[q];
      // searchsorted right − 1 (xq quasi sempre crescente: si parte dal j precedente)
      if (j >= n || (j >= 0 && xs[j] > v)) j = -1;
      while (j + 1 < n && xs[j + 1] <= v) j++;
      out[q] = j >= 0 ? ic[j] + v * sl[j] : FLT_MAX;
    }
    return out;
  }
  function smoothdata(x, n) {
    const N = x.length;
    if (n < 1) return Float64Array.from(x);
    const w = new Float64Array(n); let ws = 0;
    for (let i = 0; i < n; i++) { const t = (i - Math.floor(n / 2)) * (5.0 / n); w[i] = Math.exp(-0.5 * t * t); ws += w[i]; }
    for (let i = 0; i < n; i++) w[i] = w[i] * (1e6 / ws) * 1e-6;
    const h = Math.trunc((n | 1) / 2);
    const out = new Float64Array(N);
    for (let k = 0; k < N; k++) {
      let num = 0, den = 0;
      for (let i = 0; i < n; i++) {
        const j = k - h + i;
        if (j >= 0 && j < N) { num += w[i] * x[j]; den += w[i]; }
      }
      out[k] = num / den;
    }
    return out;
  }
  /** downSampleSmoothFreq → { v, f } */
  function dssf(H, f, m, smooth = true) {
    const n = H.length, f0 = f[0], f1 = f[n - 1];
    const m0 = mel(f0), m1 = mel(f1);
    const meln = linspace(m0, m1, n), hzn = meln.map(imel); hzn[0] = f0; hzn[n - 1] = f1;
    const melm = linspace(m0, m1, m), hzm = melm.map(imel); hzm[0] = f0; hzm[m - 1] = f1;
    const lin = linspace(f0, f1, m);
    let db = H.map(v => 20 * Math.log10(v));
    let s;
    if (smooth) {
      db = smoothdata(db, Math.trunc(n * 0.002));
      s = smoothdata(interp1(f, db, hzn), Math.trunc(n / m) * 2);
    } else s = interp1(f, db, hzn);
    if (n !== m) s = interp1(meln, s, melm);
    const out = interp1(hzm, s, lin);
    return { v: out.map(v => Math.pow(10, v * 0.05)), f: lin };
  }
  function mps(s) {
    const N = s.length;
    let mx = 0; for (const v of s) mx = Math.max(mx, Math.abs(v));
    const fl = mx * 1e-5;
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = Math.log((mx !== 0 && Math.abs(s[i]) < fl ? fl : s[i]) + EPS);
    fft(re, im, true);
    for (let i = 0; i < N; i++) { re[i] /= N; im[i] /= N; }
    const fr = new Float64Array(N), fi = new Float64Array(N);
    fr[0] = re[0]; fi[0] = im[0];
    const h = N % 2 === 0 ? N / 2 : (N + 1) / 2;
    for (let i = 1; i < h; i++) { fr[i] = re[i] + re[N - i]; fi[i] = im[i] - im[N - i]; }
    if (N % 2 === 0) { fr[h] = re[h]; fi[h] = -im[h]; }
    fft(fr, fi, false);
    for (let i = 0; i < N; i++) { const e = Math.exp(fr[i]); const a = fi[i]; fr[i] = e * Math.cos(a); fi[i] = e * Math.sin(a); }
    return { re: fr, im: fi };
  }
  function minPhaseIR(H, L) {
    const n = H.length, N = 2 * n - 2;
    const full = new Float64Array(N);
    full.set(H); for (let i = 0; i < n - 2; i++) full[n + i] = H[n - 2 - i];
    const z = mps(full);
    fft(z.re, z.im, true);
    let E = 0; for (let i = 0; i < N; i++) { z.re[i] /= N; E += z.re[i] * z.re[i]; }
    const out = Float64Array.from(z.re.subarray(0, L));
    let mean = 0; for (const v of out) mean += v; mean /= L;
    let e2 = 0; for (let i = 0; i < L; i++) { out[i] -= mean; e2 += out[i] * out[i]; }
    const k = Math.sqrt(E) / Math.sqrt(e2);
    for (let i = 0; i < L; i++) out[i] *= k;
    return out;
  }
  function hamming(n) {
    const w = new Float64Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (n - 1));
    return w;
  }
  function tfestimate(x, y, seg, nfft, fs) {
    const nb = (nfft >> 1) + 1, w = hamming(seg);
    const Pxx = new Float64Array(nb), Pr = new Float64Array(nb), Pi = new Float64Array(nb);
    const L = x.length, last = L - seg;
    const a = new Float64Array(seg), b = new Float64Array(seg);
    const ar = new Float64Array(nfft), ai = new Float64Array(nfft), br = new Float64Array(nfft), bi = new Float64Array(nfft);
    let st = 0;
    for (;;) {
      const s4 = Math.min(st, last);
      let ma = 0, mb = 0;
      for (let i = 0; i < seg; i++) { a[i] = x[s4 + i] * 1000.0; b[i] = y[s4 + i] * 1000.0; ma += a[i]; mb += b[i]; }
      ma /= seg; mb /= seg;
      ar.fill(0); ai.fill(0); br.fill(0); bi.fill(0);
      for (let i = 0; i < seg; i++) { ar[i % nfft] += (a[i] - ma) * w[i]; br[i % nfft] += (b[i] - mb) * w[i]; }
      fft2(ar, ai, false); fft2(br, bi, false);
      for (let k = 0; k < nb; k++) {
        Pxx[k] += ar[k] * ar[k] + ai[k] * ai[k];
        Pr[k] += ar[k] * br[k] + ai[k] * bi[k];
        Pi[k] += ar[k] * bi[k] - ai[k] * br[k];
      }
      const nxt = s4 + (seg - Math.trunc(seg / 2.0));
      if (!(nxt < L && st < last)) break;
      st = nxt;
    }
    const H = new Float64Array(nb), f = new Float64Array(nb);
    for (let k = 0; k < nb; k++) { H[k] = Math.sqrt(Pr[k] * Pr[k] + Pi[k] * Pi[k]) / (Pxx[k] + EPS); f[k] = k / nfft * fs; }
    return { H, f };
  }
  const maxOf = a => { let m = -Infinity; for (const v of a) if (v > m) m = v; return m; };
  const sumSq = a => { let s = 0; for (const v of a) s += v * v; return s; };

  const FIR48 = [2.36980891e+00, 3.53219938e+00, 3.38600636e+00, 5.71152806e-01, -2.49451208e+00, -3.85038185e+00,
    -3.16384506e+00, -1.51175368e+00, -5.81693113e-01, -1.76165596e-01, -1.53762206e-01, 2.66270608e-01,
    4.05162007e-01, 3.89548510e-01, 1.13782898e-01, 1.53672799e-01, 2.60469586e-01, 3.56198996e-01,
    2.02282995e-01, -1.78810991e-02, -5.92595004e-02, -3.05259991e-02, 7.32804015e-02, -3.87939997e-02,
    -2.05725003e-02, 2.09499002e-02, 8.91723037e-02, -6.69899979e-04, 3.29804011e-02, 1.90768000e-02,
    9.51995030e-02, 9.39730033e-02, -2.69184001e-02, -2.81860009e-02, 3.53359990e-03, 8.51882026e-02,
    -2.84807999e-02, -7.66185001e-02, -8.21703970e-02, 1.29757002e-02, 5.08528985e-02, -6.22742996e-02,
    -1.22342698e-01, -2.20810995e-02, 8.03612992e-02, -2.01430004e-02, -9.81329009e-02, -5.81544004e-02,
    -3.25089996e-03, 3.92660014e-02];

  // ---------------------------------------------------------------- HTKPA
  function HTKPA(fs, avanza) {
    this.fs = fs = fs || 48000.0;
    this.avanza = avanza || function () {};
    this.nb = 1025; this.nfft = 2048; this.L1 = 128; this.L2 = 2048;
    this.seg = Math.trunc(fs * 0.125 + 0.5);
    this.bq1 = [1.0, 0, 0, 0, 0];
    const fs2 = fs * fs, d = fs2 + fs * 177.7158 + 15791.452;
    this.bq2 = [(fs2 - 9.763315e-25) / d, (-2 * fs2 - 1.952663e-24) / d, (fs2 - 9.763315e-25) / d,
      (-2 * fs2 + 31582.904) / d, (fs2 - fs * 177.7158 + 15791.452) / d];
    this.p = [0.5, 0.5, 0.5, 0.5];
    this.melhz = new Float64Array(512);
    for (let i = 0; i < 512; i++) this.melhz[i] = imel(121.95607 + 5.7754703 * i);
    this.melhz[0] = 80.0; this.melhz[511] = 10000.0;
  }
  HTKPA.prototype.nl = function (x) {
    const u = up2(up2(x, UP0), UP1);
    const [p0, p1, p2, p3] = this.p;
    for (let i = 0; i < u.length; i++) {
      const v = u[i];
      u[i] = v > 0 ? p0 * (1 - Math.exp(-p2 * v)) : -p1 * (1 - Math.exp(p3 * v));
    }
    return down2(down2(u, DN1), DN0);
  };
  HTKPA.prototype.chain = function (x, pre) {
    let s = x;                                   // bq1 è l'identità
    if (pre) s = conv(s, pre);
    return biq(this.nl(s), this.bq2);
  };
  HTKPA.prototype.initNonlinear = function (x, y, n) {
    const fr = this.fs * 0.1, k = Math.trunc(n / fr);
    const mx = new Float64Array(k), ymax = new Float64Array(k), ymin = new Float64Array(k);
    for (let i = 0; i < k; i++) {
      const a = Math.trunc(fr * i), b = Math.trunc(fr * (i + 1));
      let m = 0, M = -Infinity, mi = Infinity;
      for (let j = a; j < b; j++) { m = Math.max(m, Math.abs(x[j])); M = Math.max(M, y[j]); mi = Math.min(mi, y[j]); }
      mx[i] = Math.max(0, m); ymax[i] = Math.max(0, M); ymin[i] = Math.min(0, mi);
    }
    const Yp = maxOf(ymax); let Yn = 0; for (const v of ymin) Yn = Math.max(Yn, -v);
    const xs = [], ys = [];
    for (let i = k - 1; i >= 0; i--) { xs.push(-mx[i]); ys.push(ymin[i]); }
    for (let i = 0; i < k; i++) { xs.push(mx[i]); ys.push(ymax[i]); }
    const primo = c => { for (let i = 0; i < k; i++) if (c(i)) return i + 1; return 1; };
    const u = primo(i => ymax[i] >= Yp * 0.5), v = primo(i => ymin[i] <= -Yn * 0.5);
    let n1 = 0, d1 = 0, n2 = 0, d2 = 0;
    for (let i = 0; i < u; i++) { n1 += mx[i] * ymax[i]; d1 += mx[i] * mx[i]; }
    for (let i = 0; i < v; i++) { n2 += mx[i] * ymin[i]; d2 += mx[i] * mx[i]; }
    const sp = (n1 / d1) / Yp, sn = (-n2 / d2) / Yn;
    const err = (cp, cn) => {
      let e = 0;
      for (let i = 0; i < xs.length; i++) {
        const t = xs[i], pred = t > 0 ? Yp * (1 - Math.exp(t * cp)) : -Yn * (1 - Math.exp(t * cn));
        e += (ys[i] - pred) ** 2;
      }
      return e;
    };
    const grid = [];
    let f = Math.fround(0.8);
    while (f <= 1.2) { grid.push(f); f = Math.fround(f + 0.05); }
    let best = FLT_MAX, k1 = 1.0;
    for (const gg of grid) { const e = err(-sp * gg, sn); if (e <= best) { best = e; k1 = gg; } }
    best = FLT_MAX; let k2 = 1.0;
    for (const gg of grid) { const e = err(-sp * k1, sn * gg); if (e <= best) { best = e; k2 = gg; } }
    this.p = [Yp, Yn, sp * k1, sn * k2];
  };
  HTKPA.prototype.initH1H2 = function (x, y, H12) {
    const s = this.chain(conv(x, FIR48));
    const t2 = tfestimate(s, y, this.seg, this.nfft, this.fs);
    let H2 = smoothdata(smoothdata(t2.H, Math.trunc(this.nb * 0.001)), Math.trunc(this.nb * 0.005));
    const fl = maxOf(H12) * 0.001, t = 2 * fl;
    H2 = H2.map(v => v < t ? fl + v * ((t - fl) / (t * t)) * v : v);
    const H1 = H12.map((v, i) => v * 1e6 / (H2[i] * 1e6 + EPS));
    return { H1, H2, f: t2.f };
  };
  HTKPA.prototype.iterAmpCoeff = function (x, y, iters, H1, H2, f, w1, w2) {
    const nb = this.nb;
    let A0 = Float64Array.from(w1); const A1 = w2;
    let best = 100.0, gg = 1.0;
    let sav = [Float64Array.from(A0), Float64Array.from(this.IR1), Float64Array.from(this.IR2), Float64Array.from(H1), Float64Array.from(H2)];
    for (let it = 0; it < iters; it++) {
      A0 = A0.map((v, i) => Math.min(5.0, Math.max(0.2, Math.pow(v, gg * A1[i]))));
      const d1 = dssf(A0, f, nb); const d2 = dssf(d1.v, d1.f, nb); A0 = d2.v; f = d2.f;
      H2 = H2.map((v, i) => v * A0[i]); H1 = H1.map((v, i) => v / A0[i]);
      const k = Math.trunc((1.0 / (this.fs * 0.5)) * 60.0 * nb);
      if (k > 1) {
        let prev = Math.sqrt(H1[0] * Math.sqrt(H1[0] * H1[1])); H1[0] = prev;
        for (let j = 1; j < k; j++) { prev = Math.sqrt(H1[j] * Math.sqrt(prev * H1[j + 1])); H1[j] = prev; }
      }
      this.IR1 = minPhaseIR(dssf(H1, f, this.L1).v, this.L1);
      const s = this.chain(x, this.IR1);
      const t5 = tfestimate(s, y, this.seg, this.nfft, this.fs); const A5 = t5.H; f = t5.f;
      const A2 = A5.map((v, i) => v * 1e6 / (H2[i] * 1e6 + EPS));
      gg *= 0.9;
      const d3 = dssf(A2, f, nb); A0 = d3.v; f = d3.f;
      this.IR2 = minPhaseIR(A5, this.L2);
      const t6 = tfestimate(conv(s, this.IR2), y, this.seg, this.nfft, this.fs); f = t6.f;
      const A3 = interp1(f, t6.H, this.melhz);
      let e = 0; for (const v of A3) e += Math.abs(Math.log(v + EPS)); e /= 512.0;
      if (e < best) {
        sav = [Float64Array.from(A0), Float64Array.from(this.IR1), Float64Array.from(this.IR2), Float64Array.from(H1), Float64Array.from(H2)]; best = e;
      } else if (e > best * 1.2) {
        A0 = Float64Array.from(sav[0]); this.IR1 = Float64Array.from(sav[1]); this.IR2 = Float64Array.from(sav[2]);
        H1 = Float64Array.from(sav[3]); H2 = Float64Array.from(sav[4]); gg *= 0.5;
      }
      this.avanza('iter', e);
    }
    this.IR1 = Float64Array.from(sav[1]); this.IR2 = Float64Array.from(sav[2]);
    return { H1: Float64Array.from(sav[3]), H2: Float64Array.from(sav[4]), f };
  };
  HTKPA.prototype.finetuneH2 = function (x, y) {
    const N = Math.trunc(this.fs * 0.1), nb = Math.trunc(N * 0.5 + 1);
    const s = this.chain(x, this.IR1), sim = conv(s, this.IR2);
    const k = Math.trunc(x.length / N);
    const a = new Float64Array(N), b = new Float64Array(N);
    for (let j = 0; j < k; j++) for (let i = 0; i < N; i++) { a[i] += sim[j * N + i]; b[i] += y[j * N + i]; }
    const w = hamming(N);
    let ma = 0, mb = 0; for (let i = 0; i < N; i++) { ma += a[i]; mb += b[i]; } ma /= N; mb /= N;
    for (let i = 0; i < N; i++) { a[i] = (a[i] - ma) * w[i]; b[i] = (b[i] - mb) * w[i]; }
    const A = rfft(a, N), B = rfft(b, N);
    let Ma = new Float64Array(nb), Mb = new Float64Array(nb);
    for (let i = 0; i < nb; i++) { Ma[i] = Math.hypot(A.re[i], A.im[i]); Mb[i] = Math.hypot(B.re[i], B.im[i]); }
    const f = linspace(0, this.fs / 2, nb);
    Ma = dssf(Ma, f, nb).v; Mb = dssf(Mb, f, nb).v;
    const cl = v => Math.min(10, Math.max(0.1, v));
    let R = Mb.map((v, i) => cl(v * 1e6 / (Ma[i] * 1e6 + EPS)));
    R = smoothdata(R, Math.trunc(nb * 0.1)).map(cl);
    const h = minPhaseIR(dssf(R, f, 256).v, 256);
    const ir = conv(this.IR2, h);
    let m = 0; for (const v of ir) m += v; m /= ir.length;
    this.IR2 = ir.map(v => v - m);
    const out = conv(s, this.IR2);
    const g2 = Math.sqrt(sumSq(y)) / Math.sqrt(sumSq(out));
    this.IR2 = this.IR2.map(v => v * g2);
  };
  HTKPA.prototype.startClone = function (xin, yin) {
    const fs = this.fs, L = Math.trunc(fs * 70 + 600), n70 = Math.trunc(fs * 70);
    const X = new Float64Array(L), Y = new Float64Array(L);
    X.set(xin.subarray(0, n70)); Y.set(yin.subarray(0, n70));
    let m = 0; for (const v of Y) m += v; m /= L;
    for (let i = 0; i < L; i++) Y[i] -= m;
    let sYt = 0, sY = 0, st = 0, stt = 0;
    for (let i = 0; i < L; i++) { const t = i + 1; sYt += Y[i] * t; sY += Y[i]; st += t; stt += t * t; }
    const sl = (sYt * L - st * sY) / (stt * L - st * st);
    const c0 = (sY - st * sl) / L;
    for (let i = 0; i < L; i++) Y[i] -= c0 + (i + 1) * sl;
    const i6 = Math.trunc(fs) * 6;
    let j = 600; for (let k = 0; k < 600; k++) if (Math.abs(Y[i6 + k]) > 0.01) { j = k; break; }
    const Ya = Y.subarray(j), F = Math.trunc(fs);
    const pz = (A, a, n) => A.subarray(a * F, Math.min(A.length, (a + n) * F));
    this.IR1 = new Float64Array(this.L1); this.IR1[0] = 1;
    this.IR2 = new Float64Array(this.L2); this.IR2[0] = 1;
    this.initNonlinear(X, Ya, 5 * F);
    this.avanza('distorsione', this.p);
    const H12 = tfestimate(this.chain(pz(X, 6, 15)), pz(Ya, 6, 15), this.seg, this.nfft, fs).H;
    let { H1, H2, f } = this.initH1H2(pz(X, 23, 5), pz(Ya, 23, 5), H12);
    const nb = this.nb, w1 = new Float64Array(nb).fill(1), w2 = new Float64Array(nb).fill(1);
    const i27 = Math.trunc((1.0 / (fs * 0.5)) * 80.0 * nb), i10 = nb - i27;
    for (let i = 0; i <= i10 && i27 - 1 + i < nb; i++) w2[i27 - 1 + i] = i === i10 ? 0.5 : 1.0 - (0.5 / i10) * i;
    for (const [a, n, it] of [[23, 5, 3], [6, 15, 2], [30, 20, 5]]) {
      ({ H1, H2, f } = this.iterAmpCoeff(pz(X, a, n), pz(Ya, a, n), it, H1, H2, f, w1, w2));
    }
    this.finetuneH2(pz(X, 50, 20), pz(Ya, 50, 20));
    this.IR2 = this.IR2.map(v => v * 4.0);
  };
  /** Il CLO da 8840 byte. mini=false: come lo calcola l'app (IR a 44,1 kHz); mini=true: come arriva al
   *  Mini nel messaggio 0/5 (IR riportate a 48 kHz). Il CRC al byte 8 è quello visto nella cattura: il
   *  Mini l'ha accettato anche col CLO nostro (17 novembre), quindi non lo controlla. */
  HTKPA.prototype.pack = function (mini) {
    const b = new ArrayBuffer(0x2288), dv = new DataView(b);
    [0x56, 0x54, 0x53, 0x49].forEach((c, i) => dv.setUint8(i, c));
    dv.setUint32(4, 8840, true); dv.setUint32(8, 98398, true); dv.setUint32(12, 0, true);
    dv.setUint32(0x14, 0x2200, true);
    [...this.bq1, ...this.bq2].forEach((v, i) => dv.setFloat64(0x18 + 8 * i, v, true));
    this.p.forEach((v, i) => dv.setFloat32(0x68 + 4 * i, v, true));
    [0, this.L1, this.L1, this.L2].forEach((v, i) => dv.setUint32(0x78 + 4 * i, v, true));
    let r1 = resamplePoly(this.IR1, 147, 160).subarray(0, Math.trunc(this.L1 * 44100 / 48000));
    let r2 = resamplePoly(this.IR2, 147, 160).subarray(0, Math.trunc(this.L2 * 44100 / 48000));
    if (mini) {
      r1 = resamplePoly(r1, 160, 147).subarray(0, this.L1);
      r2 = resamplePoly(r2, 160, 147).subarray(0, this.L2);
    }
    r1.forEach((v, i) => dv.setFloat32(0x88 + 4 * i, v, true));
    r2.forEach((v, i) => dv.setFloat32(0x88 + 4 * (this.L1 + i), v, true));
    return new Uint8Array(b);
  };

  // ---------------------------------------------------------------- motore NAM «A2» (WaveNet 0.7)
  /** Il sottomodello che usa l'app: in un SlimmableContainer il primo con slim (1,0) < max_value,
   *  se no l'ultimo (cioè quello completo). */
  function sottomodello(nam, slim = 1.0) {
    if (nam.architecture !== 'SlimmableContainer') return nam;
    const subs = nam.config.submodels;
    for (const s of subs) if (slim < s.max_value) return s.model;
    return subs[subs.length - 1].model;
  }
  /** Controlla che il NAM sia di quelli che sappiamo far suonare; se no un Error col perché. */
  function A2(model) {
    const cfg = model.config || {};
    if (model.architecture !== 'WaveNet' || !Array.isArray(cfg.layers) || cfg.layers.length !== 1)
      throw new Error('formato');
    const la = cfg.layers[0];
    const C = la.channels;
    const act = Array.isArray(la.activation) ? la.activation : [la.activation];
    const okAtt = act.every(a => a && a.type === 'LeakyReLU');
    const gate = la.gating_mode == null || [].concat(la.gating_mode).every(v => v === 'none' || v === false);
    if (la.bottleneck !== C || !okAtt || !gate || (la.layer1x1 && la.layer1x1.active === false) ||
        (la.head1x1 && la.head1x1.active) || la.input_size !== 1 || la.head.out_channels !== 1)
      throw new Error('formato');
    this.C = C; this.ks = la.kernel_sizes; this.ds = la.dilations;
    this.slopes = this.ks.map((_, i) => (act[i] || act[0]).negative_slope);
    this.hk = la.head.kernel_size;
    this.fs = model.sample_rate || 48000;
    const w = model.weights; let p = 0;
    const take = n => { const v = Float64Array.from(w.slice(p, p + n)); p += n; return v; };
    this.rech = take(C);
    this.layers = this.ks.map((K, i) => ({
      K, D: this.ds[i],
      conv: take(C * C * K),   // [out][in][tap]
      cb: take(C), mix: take(C),
      l1: take(C * C),         // [out][in]
      l1b: take(C),
    }));
    this.headW = take(C * this.hk);   // [in][tap]
    this.headB = take(1)[0];
    this.headScale = take(1)[0];
    if (p !== w.length) throw new Error('formato');
    this.prewarm = 1 + this.layers.reduce((s, l) => s + (l.K - 1) * l.D, 0) + this.hk - 1;
  }
  /** Fa suonare il NAM su x (Float64Array); la storia iniziale è quella dopo il prewarm a silenzio.
   *  avanza(frazione) ogni tanto. */
  A2.prototype.process = function (x, avanza) {
    const C = this.C, nl = this.layers.length;
    // per ogni strato: la storia del suo ingresso (C canali) in un anello
    const anelli = this.layers.map(l => {
      let R = 1; while (R < (l.K - 1) * l.D + 1) R <<= 1;
      return { R, m: R - 1, buf: new Float64Array(R * C) };
    });
    let HR = 1; while (HR < this.hk) HR <<= 1;
    const hbuf = new Float64Array(HR * C), hm = HR - 1;
    const lin = new Float64Array(C), z = new Float64Array(C), hs = new Float64Array(C);
    const tot = this.prewarm + x.length, y = new Float64Array(x.length);
    for (let t = 0; t < tot; t++) {
      const xv = t < this.prewarm ? 0 : x[t - this.prewarm];
      for (let c = 0; c < C; c++) { lin[c] = this.rech[c] * xv; hs[c] = 0; }
      for (let li = 0; li < nl; li++) {
        const L = this.layers[li], A = anelli[li], buf = A.buf, K = L.K, D = L.D;
        const pos = t & A.m;
        for (let c = 0; c < C; c++) buf[pos * C + c] = lin[c];
        for (let o = 0; o < C; o++) z[o] = L.cb[o] + L.mix[o] * xv;
        for (let k = 0; k < K; k++) {
          const q = ((t - (K - 1 - k) * D) & A.m) * C;
          for (let o = 0; o < C; o++) {
            const base = o * C * K + k; let s = 0;
            for (let i = 0; i < C; i++) s += L.conv[base + i * K] * buf[q + i];
            z[o] += s;
          }
        }
        const sl = this.slopes[li];
        for (let o = 0; o < C; o++) { if (z[o] < 0) z[o] *= sl; hs[o] += z[o]; }
        for (let o = 0; o < C; o++) {
          let s = L.l1b[o];
          for (let i = 0; i < C; i++) s += L.l1[o * C + i] * z[i];
          lin[o] += s;
        }
      }
      const hp = (t & hm) * C;
      for (let c = 0; c < C; c++) hbuf[hp + c] = hs[c];
      if (t >= this.prewarm) {
        let v = this.headB;
        for (let k = 0; k < this.hk; k++) {
          const q = ((t - (this.hk - 1 - k)) & hm) * C;
          for (let c = 0; c < C; c++) v += this.headW[c * this.hk + k] * hbuf[q + c];
        }
        y[t - this.prewarm] = v * this.headScale;
      }
      if (avanza && (t & 0xffff) === 0) avanza(t / tot);
    }
    return y;
  };

  /** Arrotonda come numpy (pari ai mezzi). */
  function rintPari(v) {
    const r = Math.round(v);
    return (Math.abs(v % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r;
  }
  /** L'app salva l'uscita del NAM in un WAV a 16 bit (JUCE: int32 arrotondato, poi i 16 bit alti). */
  function wav16(v) {
    const o = new Float64Array(v.length);
    for (let i = 0; i < v.length; i++) {
      const c = Math.min(1, Math.max(-1, v[i]));
      o[i] = Math.floor(rintPari(c * 2147483647.0) / 65536) / 32768.0;
    }
    return o;
  }
  /** L'ingresso fisso: 24 bit LE con segno → Float64Array. */
  function leggiIngresso(byte) {
    const n = Math.floor(byte.length / 3), x = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let v = byte[3 * i] | (byte[3 * i + 1] << 8) | (byte[3 * i + 2] << 16);
      if (v & 0x800000) v -= 0x1000000;
      x[i] = v / 8388608;
    }
    return x;
  }

  /** nam = il JSON del .nam (oggetto); ingresso = Float64Array (leggiIngresso). avanza(fase, frazione)
   *  con fase 'nam' (0-1) o 'clone' (0-1). Ritorna { clo (come l'app), mini (come va al Mini), canali }. */
  function converti(nam, ingresso, avanza) {
    avanza = avanza || function () {};
    const m = new A2(sottomodello(nam));
    if (m.fs !== 48000) throw new Error('frequenza');
    const y = m.process(ingresso, f => avanza('nam', f));
    for (let i = 0; i < y.length; i++) y[i] *= 0.31;
    avanza('clone', 0);
    let passi = 0;
    const k = new HTKPA(48000.0, () => { passi++; avanza('clone', Math.min(0.95, passi / 11)); });
    k.startClone(ingresso, wav16(y));
    avanza('clone', 1);
    return { clo: k.pack(false), mini: k.pack(true), canali: m.C, p: k.p };
  }

  /** Il corpo del messaggio 0/5 (cattura del 6 novembre): posto (0-9), 0×7, nome (16 byte, al massimo
   *  15 caratteri e lo 0), poi i primi 8192 byte del CLO. Il Mini risponde 09/02 (0 0 5 0 posto 0 1 0). */
  function corpoClone(posto, nome, mini) {
    const c = new Array(24).fill(0);
    c[0] = posto & 0xff;
    const n = String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').slice(0, 15);
    for (let i = 0; i < n.length; i++) c[8 + i] = n.charCodeAt(i);
    return c.concat(Array.from(mini.subarray(0, 8192)));
  }

  // ---------------------------------------------------------------- IR utente (cab)
  // Il messaggio 0/4 dell'app (cattura del 6/11, «Mesa OS - V30 1»): corpo 4120 byte = posto, 0×7,
  // nome (16), poi 1024 campioni int32 little endian a 48 kHz, col picco portato a 2^23 − 1.
  const IR_CAMPIONI = 1024, IR_PICCO = 8388607;
  /** campioni: l'IR già a 48 kHz (numeri qualsiasi); ritorna il corpo del messaggio 0/4. */
  function corpoIR(posto, nome, campioni) {
    const c = new Array(24).fill(0);
    c[0] = posto & 0xff;
    const n = String(nome).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7e]/g, '').slice(0, 15);
    for (let i = 0; i < n.length; i++) c[8 + i] = n.charCodeAt(i);
    let picco = 0;
    for (let i = 0; i < Math.min(IR_CAMPIONI, campioni.length); i++) picco = Math.max(picco, Math.abs(campioni[i]));
    if (!(picco > 0)) throw new Error('muto');
    const b = new Uint8Array(IR_CAMPIONI * 4), dv = new DataView(b.buffer);
    for (let i = 0; i < IR_CAMPIONI && i < campioni.length; i++) dv.setInt32(i * 4, Math.round(campioni[i] / picco * IR_PICCO), true);
    return c.concat(Array.from(b));
  }

  // ---------------------------------------------------------------- «porta il tuo file»
  // Chi vuole il Sound Clone identico a quello dell'app usa il segnale di prova dell'app stessa:
  // assets/flutter_assets/assets/clone_config/nam_input_file.wav dentro l'APK Hotone (o il .wav già estratto). MazzRig non lo
  // distribuisce: lo legge dal file che sceglie l'utente e lo tiene nel suo browser. Va portato a 48 kHz
  // ESATTAMENTE come fa l'app (r8brain): con un altro ricampionatore cambia l'impulso a 6 s, il ritardo
  // misurato e quindi il clone. nam/r8b-44-48.bin = le risposte all'impulso di r8brain per 44,1 → 48 kHz
  // (lineare e periodico: 147 fasi), ricavate in ricerca-nam/r8b_nucleo.py; danno lo stesso segnale a 24 bit.
  const APK_WAV = /(^|\/)clone_config\/nam_input_file\.wav$/;   // nell'APK 2.1.3: assets/flutter_assets/assets/…
  const SHA_APP_213 = '9bb6c1b136dfbeb7538a6060499d98c89342b76ec568b76836e36ab98b29aa1a';   // app 2.1.3

  /** Il WAV PCM a 16 bit: { fs, x (canale sinistro, Float64Array) }. Salta i blocchi che non servono (JUNK…). */
  function leggiWav16(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const tag = i => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    if (b.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('wav');
    let fmt = null;
    for (let i = 12; i + 8 <= b.length;) {
      const id = tag(i), n = v.getUint32(i + 4, true);
      if (id === 'fmt ') fmt = { tipo: v.getUint16(i + 8, true), canali: v.getUint16(i + 10, true), fs: v.getUint32(i + 12, true), bit: v.getUint16(i + 22, true) };
      if (id === 'data') {
        if (!fmt || fmt.tipo !== 1 || fmt.bit !== 16) throw new Error('wav');
        const m = Math.floor(Math.min(n, b.length - i - 8) / (2 * fmt.canali)), x = new Float64Array(m);
        for (let k = 0; k < m; k++) x[k] = v.getInt16(i + 8 + 2 * fmt.canali * k, true) / 32768;
        return { fs: fmt.fs, x };
      }
      i += 8 + n + (n & 1);
    }
    throw new Error('wav');
  }

  /** Le voci della directory centrale di uno zip: [{ nome, metodo, compr, loc }]. */
  function vociZip(b) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) throw new Error('zip');
    const tot = v.getUint16(e + 10, true), dec = new TextDecoder(), voci = [];
    let p = v.getUint32(e + 16, true);
    for (let k = 0; k < tot && p + 46 <= b.length && v.getUint32(p, true) === 0x02014b50; k++) {
      const ln = v.getUint16(p + 28, true), le = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true);
      voci.push({ nome: dec.decode(b.subarray(p + 46, p + 46 + ln)), metodo: v.getUint16(p + 10, true),
        compr: v.getUint32(p + 20, true), loc: v.getUint32(p + 42, true) });
      p += 46 + ln + le + lc;
    }
    return voci;
  }
  const elencoZip = b => vociZip(b).map(x => x.nome);

  /** Un file di un archivio zip (l'APK è uno zip), cercato per nome (o con una RegExp). Asincrona: usa DecompressionStream. */
  async function estraiZip(b, nome) {
    const x = vociZip(b).find(y => (nome instanceof RegExp ? nome.test(y.nome) : y.nome === nome));
    if (!x) throw new Error('apk');
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const inizio = x.loc + 30 + v.getUint16(x.loc + 26, true) + v.getUint16(x.loc + 28, true);
    const dati = b.subarray(inizio, inizio + x.compr);
    if (x.metodo === 0) return dati;
    if (x.metodo !== 8) throw new Error('zip');
    const s = new Blob([dati]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }

  /** x a 44,1 kHz → 48 kHz come r8brain nell'app (nucleo = byte di nam/r8b-44-48.bin), 70 s, arrotondato a 24 bit. */
  function r8b44a48(x, nucleo) {
    const v = new DataView(nucleo.buffer, nucleo.byteOffset, nucleo.byteLength);
    if (v.getUint32(0, true) !== 0x31423852) throw new Error('nucleo');   // "R8B1"
    const P = v.getInt32(4, true), L = v.getInt32(8, true);
    const rel = new Int32Array(P), g = new Float32Array(P * L);
    for (let p = 0; p < P; p++) rel[p] = v.getInt32(12 + 4 * p, true);
    for (let i = 0; i < P * L; i++) g[i] = v.getFloat32(12 + 4 * P + 4 * i, true);
    const M = 70 * 48000, y = new Float64Array(M);
    for (let n = 0; n < x.length; n++) {
      const a = x[n];
      if (a === 0) continue;
      const p = n % P, base = 160 * ((n - p) / P) + rel[p], h = p * L;
      const k0 = Math.max(0, -base), k1 = Math.min(L, M - base);
      for (let k = k0; k < k1; k++) y[base + k] += a * g[h + k];
    }
    for (let i = 0; i < M; i++) y[i] = Math.round(y[i] * 8388608) / 8388608;
    return y;
  }

  /** Dal file scelto dall'utente (APK Hotone o nam_input_file.wav) al segnale di prova a 48 kHz dell'app.
   *  Ritorna { ingresso: Float64Array, noto: true se è proprio il file dell'app 2.1.3 }. */
  async function ingressoDaApp(byte, nucleo) {
    let wav = byte;
    if (byte[0] === 0x50 && byte[1] === 0x4b) {                                        // "PK": APK
      try { wav = await estraiZip(byte, APK_WAV); } catch (x) {
        if (x.message !== 'apk') throw x;
        // XAPK / APKS (per esempio da APKPure): uno zip con dentro gli APK; il segnale sta in quello base
        let trovato = null;
        for (const n of elencoZip(byte).filter(n => /\.apk$/i.test(n))) {
          try { trovato = await estraiZip(await estraiZip(byte, n), APK_WAV); break; } catch (y) { /* il prossimo */ }
        }
        if (!trovato) throw x;
        wav = trovato;
      }
    }
    let noto = false;
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', wav));
      noto = Array.from(h, c => c.toString(16).padStart(2, '0')).join('') === SHA_APP_213;
    }
    const { fs, x } = leggiWav16(wav);
    if (fs !== 44100 || x.length < 69 * 44100 || x.length > 71 * 44100) throw new Error('segnale');
    return { ingresso: r8b44a48(x, nucleo), noto };
  }

  const N = { converti, corpoClone, corpoIR,leggiIngresso, sottomodello, A2, HTKPA, wav16, resamplePoly, fft, conv,
    leggiWav16, estraiZip, r8b44a48, ingressoDaApp };
  if (typeof module !== 'undefined' && module.exports) module.exports = N; else g.PulzeNam = N;
})(this);
