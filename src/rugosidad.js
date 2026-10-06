/*
 * Motor de predicción de rugosidad en fresado.
 *
 * Modelo:
 *  1. Rugosidad cinemática: se simula numéricamente el perfil que deja la
 *     envolvente de las pasadas de cada filo (con excentricidad / runout) y se
 *     calculan Ra, Rz y Rt sobre ese perfil.
 *       - Pared (fresado periférico): arcos de radio efectivo de Martellotti
 *         R ± f_rev/π (+ oposición, − concordancia).
 *       - Suelo, dirección de avance: perfil de la punta del filo (arista viva,
 *         chaflán, radio de punta o esférica, con ángulo de dish) desplazado fz.
 *       - Suelo, dirección transversal: perfil barrido desplazado el paso
 *         lateral ae (cresta entre pasadas, clave en copiado 3D con esférica).
 *  2. Corrección por espesor mínimo de viruta (Brammertz) con el radio de filo.
 *  3. Factor dinámico empírico (filo recrecido, voladizo largo) y factor de
 *     calibración del usuario a partir de mediciones reales.
 *  4. Fuerzas de corte (Kienzle, simulación angular con hélice) y flexión de la
 *     herramienta escalonada (D1/L2, D3/L3, D2 hasta el voladizo).
 *
 * Unidades internas: mm, N, MPa. Las rugosidades se devuelven en µm.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Rugosidad = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DEG = Math.PI / 180;

  // kc1.1 [N/mm²] y mc (Kienzle); lambda = h_min / radio de filo;
  // bue = rango de Vc [m/min] con riesgo de filo recrecido.
  const MATERIALES = {
    acero_bajo: { nombre: 'Acero bajo carbono (C15–C45)', kc11: 1500, mc: 0.25, lambda: 0.25, bue: [0, 80] },
    acero_aleado: { nombre: 'Acero aleado bonificado (42CrMo4)', kc11: 1800, mc: 0.25, lambda: 0.25, bue: [0, 70] },
    acero_templado: { nombre: 'Acero templado 45–55 HRC', kc11: 3000, mc: 0.22, lambda: 0.3, bue: null },
    inox: { nombre: 'Inoxidable austenítico (304/316)', kc11: 2000, mc: 0.21, lambda: 0.35, bue: [0, 60] },
    fundicion: { nombre: 'Fundición gris (GG25)', kc11: 1100, mc: 0.28, lambda: 0.2, bue: null },
    aluminio: { nombre: 'Aluminio aleado (6082/7075)', kc11: 700, mc: 0.25, lambda: 0.15, bue: [0, 150] },
    titanio: { nombre: 'Titanio Ti-6Al-4V', kc11: 1450, mc: 0.23, lambda: 0.35, bue: null },
    inconel: { nombre: 'Superaleación de Ni (Inconel 718)', kc11: 2750, mc: 0.25, lambda: 0.4, bue: null },
  };

  const MATERIAL_HERRAMIENTA = {
    MD: { nombre: 'Metal duro', E: 580000 },
    HSS: { nombre: 'Acero rápido (HSS)', E: 210000 },
  };

  const GRADOS_ISO = [
    ['N1', 0.025], ['N2', 0.05], ['N3', 0.1], ['N4', 0.2], ['N5', 0.4], ['N6', 0.8],
    ['N7', 1.6], ['N8', 3.2], ['N9', 6.3], ['N10', 12.5], ['N11', 25], ['N12', 50],
  ];

  const TOOL_DEFAULTS = {
    z: 4, D1: 10, D2: 10, D3: 9.5, L1: 72, L2: 22, L3: 30,
    arista: 'AV', // 'AV' arista viva | 'CH' chaflán | 'R' radio de punta | 'ESF' esférica
    chR: 0, helice: 35, dish: 1.5, runout: 5, runoutAxial: 2, radioFilo: 8, material: 'MD',
  };

  const CUT_DEFAULTS = {
    material: 'acero_aleado', vc: 150, fz: 0.05, ap: 10, ae: 1,
    sentido: 'concordancia', voladizo: 35, kcal: 1,
  };

  function num(v, def) {
    const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : v;
    return Number.isFinite(n) ? n : def;
  }

  function normalizeTool(t) {
    const o = Object.assign({}, TOOL_DEFAULTS, t || {});
    for (const k of Object.keys(TOOL_DEFAULTS)) {
      if (typeof TOOL_DEFAULTS[k] === 'number') o[k] = num(o[k], TOOL_DEFAULTS[k]);
    }
    o.z = Math.max(1, Math.round(o.z));
    o.D1 = Math.max(0.1, o.D1);
    if (!(o.D2 > 0)) o.D2 = o.D1;
    if (!(o.D3 > 0) || o.D3 > o.D1) o.D3 = o.D1;
    const R1 = o.D1 / 2;
    if (o.arista === 'ESF') o.chR = R1;
    else if (o.arista === 'AV') o.chR = 0;
    else o.chR = Math.min(Math.max(o.chR, 0), R1);
    if (o.arista !== 'AV' && o.arista !== 'ESF' && o.chR === 0) o.arista = 'AV';
    if (o.arista === 'R' && o.chR >= R1) o.arista = 'ESF';
    o.dish = Math.min(Math.max(o.dish, 0), 10);
    o.runout = Math.max(0, o.runout);
    o.runoutAxial = Math.max(0, o.runoutAxial);
    o.radioFilo = Math.max(0, o.radioFilo);
    if (!MATERIAL_HERRAMIENTA[o.material]) o.material = 'MD';
    return o;
  }

  function normalizeCut(c) {
    const o = Object.assign({}, CUT_DEFAULTS, c || {});
    for (const k of Object.keys(CUT_DEFAULTS)) {
      if (typeof CUT_DEFAULTS[k] === 'number') o[k] = num(o[k], CUT_DEFAULTS[k]);
    }
    o.fz = Math.max(1e-4, o.fz);
    o.ap = Math.max(1e-3, o.ap);
    o.ae = Math.max(1e-3, o.ae);
    o.vc = Math.max(1, o.vc);
    o.kcal = o.kcal > 0 ? o.kcal : 1;
    if (!MATERIALES[o.material]) o.material = CUT_DEFAULTS.material;
    if (o.sentido !== 'oposicion') o.sentido = 'concordancia';
    return o;
  }

  // ---------------------------------------------------------------- geometría

  /** Radio en el que está el punto más bajo de la punta de la herramienta. */
  function radioPuntoBajo(t) {
    const R1 = t.D1 / 2;
    if (t.arista === 'ESF') return 0;
    if (t.arista === 'AV') return R1;
    return R1 - t.chR;
  }

  /** Altura del filo frontal sobre su punto más bajo, a radio r (0..D1/2). */
  function alturaFilo(t, r) {
    const R1 = t.D1 / 2;
    const tanD = Math.tan(t.dish * DEG);
    const c = t.chR;
    switch (t.arista) {
      case 'ESF':
        return R1 - Math.sqrt(Math.max(0, R1 * R1 - r * r));
      case 'CH':
        return r >= R1 - c ? r - (R1 - c) : (R1 - c - r) * tanD;
      case 'R': {
        if (r >= R1 - c) {
          const u = r - (R1 - c);
          return c - Math.sqrt(Math.max(0, c * c - u * u));
        }
        return (R1 - c - r) * tanD;
      }
      default:
        return (R1 - r) * tanD;
    }
  }

  /** Diámetro efectivo de corte (esférica / tórica con ap pequeña). */
  function diametroEfectivo(t, ap) {
    const R1 = t.D1 / 2;
    if (t.arista === 'ESF') return ap >= R1 ? t.D1 : 2 * Math.sqrt(ap * (t.D1 - ap));
    if (t.arista === 'R' && ap < t.chR) {
      const c = t.chR;
      return 2 * (R1 - c + Math.sqrt(c * c - (c - ap) * (c - ap)));
    }
    return t.D1;
  }

  // ------------------------------------------------------------ perfil y Ra

  /**
   * Envolvente de pasadas periódicas. Cada filo j deja la huella g(x − x0) + dz
   * con x0 = k·periodo + off_j. g es +∞ fuera de [sMin, sMax] y monótona a cada
   * lado de sLow, por lo que basta mirar las pasadas a menos de un periodo de sLow.
   */
  function envolvente({ g, sMin, sMax, sLow, periodo, offsets, longitud, n, techo }) {
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const W = periodo * 1.05;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * longitud;
      let best = Infinity;
      for (const { dx, dz } of offsets) {
        const kMin = Math.floor((x - sLow - W - dx) / periodo);
        const kMax = Math.ceil((x - sLow + W - dx) / periodo);
        for (let k = kMin; k <= kMax; k++) {
          const s = x - (k * periodo + dx);
          if (s < sMin || s > sMax) continue;
          const y = g(s) + dz;
          if (y < best) best = y;
        }
      }
      xs[i] = x;
      ys[i] = Math.min(best, techo);
    }
    return { xs, ys };
  }

  function parametrosPerfil(ys) {
    const n = ys.length;
    let m = 0;
    for (let i = 0; i < n; i++) m += ys[i];
    m /= n;
    let ra = 0, rq = 0, mn = Infinity, mx = -Infinity;
    for (let i = 0; i < n; i++) {
      const d = ys[i] - m;
      ra += Math.abs(d);
      rq += d * d;
      if (ys[i] < mn) mn = ys[i];
      if (ys[i] > mx) mx = ys[i];
    }
    // Rz: media de Rt en 5 longitudes de muestreo
    let rz = 0;
    const seg = Math.floor(n / 5);
    for (let s = 0; s < 5; s++) {
      let a = Infinity, b = -Infinity;
      for (let i = s * seg; i < (s + 1) * seg; i++) {
        if (ys[i] < a) a = ys[i];
        if (ys[i] > b) b = ys[i];
      }
      rz += b - a;
    }
    return { Ra: ra / n, Rq: Math.sqrt(rq / n), Rz: rz / 5, Rt: mx - mn };
  }

  function offsetsRunout(t, fz, enAvance) {
    const out = [];
    for (let j = 0; j < t.z; j++) {
      const ph = Math.cos((2 * Math.PI * j) / t.z);
      const e = (t.runout / 1000) * ph;
      const ea = (t.runoutAxial / 1000) * ph;
      // pared: el filo que sobresale corta más profundo; suelo: desplaza la
      // marca en avance (radial) y en altura (axial)
      out.push(enAvance ? { dx: j * fz + e, dz: -ea } : { dx: j * fz, dz: -e });
    }
    return out;
  }

  function perfilPared(t, c, nPts) {
    const R = t.D1 / 2;
    const frev = c.fz * t.z;
    const Reff = Math.max(R * 0.1, R + (c.sentido === 'oposicion' ? 1 : -1) * frev / Math.PI);
    const half = Math.min(Reff, frev * 2 + 1e-6);
    return envolvente({
      g: (s) => Reff - Math.sqrt(Math.max(0, Reff * Reff - s * s)),
      sMin: -half, sMax: half, sLow: 0, periodo: frev,
      offsets: offsetsRunout(t, c.fz, false),
      longitud: 5 * frev, n: nPts, techo: c.ae,
    });
  }

  function perfilSueloAvance(t, c, nPts) {
    const R1 = t.D1 / 2;
    const frev = c.fz * t.z;
    // s medido desde la periferia delantera hacia el eje (y más allá, cara trasera)
    return envolvente({
      g: (s) => alturaFilo(t, Math.abs(R1 - s)),
      sMin: 0, sMax: 2 * R1, sLow: R1 - radioPuntoBajo(t), periodo: frev,
      offsets: offsetsRunout(t, c.fz, true),
      longitud: 5 * frev, n: nPts, techo: c.ap,
    });
  }

  function perfilSueloTransversal(t, c, nPts) {
    const R1 = t.D1 / 2;
    const rLow = radioPuntoBajo(t);
    // perfil barrido: cada radio r ≥ |y| pasa por y al girar
    const g = (s) => {
      const a = Math.abs(s);
      return a <= rLow ? 0 : alturaFilo(t, a);
    };
    return envolvente({
      g, sMin: -R1, sMax: R1, sLow: 0, periodo: c.ae,
      offsets: [{ dx: 0, dz: 0 }],
      longitud: 5 * c.ae, n: nPts, techo: c.ap,
    });
  }

  // ------------------------------------------------------- fuerzas y flexión

  function fuerzas(t, c) {
    const mat = MATERIALES[c.material];
    const D = diametroEfectivo(t, c.ap);
    const R = D / 2;
    const ae = Math.min(c.ae, D);
    const phiS = Math.acos(1 - (2 * ae) / D);
    const [phiIn, phiOut] = c.sentido === 'oposicion' ? [0, phiS] : [Math.PI - phiS, Math.PI];
    const nSl = 30;
    const dz = c.ap / nSl;
    const lag = (2 * Math.tan(t.helice * DEG)) / D;
    const Kr = 0.35;
    const pasoFilo = (2 * Math.PI) / t.z;
    const nAng = 120;
    let FyMax = 0, Fmax = 0, par = 0;
    for (let a = 0; a < nAng; a++) {
      const phi = (a / nAng) * pasoFilo;
      let Fx = 0, Fy = 0, T = 0;
      for (let j = 0; j < t.z; j++) {
        for (let k = 0; k < nSl; k++) {
          let th = (phi + j * pasoFilo - lag * (k + 0.5) * dz) % (2 * Math.PI);
          if (th < 0) th += 2 * Math.PI;
          if (th < phiIn || th > phiOut) continue;
          const h = c.fz * Math.sin(th);
          if (h <= 0) continue;
          const kc = mat.kc11 * Math.pow(Math.max(h, 0.005), -mat.mc);
          const dFt = kc * h * dz;
          const dFr = Kr * dFt;
          Fx += -dFt * Math.cos(th) - dFr * Math.sin(th);
          Fy += dFt * Math.sin(th) - dFr * Math.cos(th);
          T += dFt * R;
        }
      }
      FyMax = Math.max(FyMax, Math.abs(Fy));
      Fmax = Math.max(Fmax, Math.hypot(Fx, Fy));
      par += T / nAng;
    }
    const n = (1000 * c.vc) / (Math.PI * D);
    const potencia = (par / 1000) * (2 * Math.PI * n / 60) / 1000; // kW
    const hex = phiS >= Math.PI / 2 ? c.fz : c.fz * Math.sin(phiS);
    return { FyMax, Fmax, par: par / 1000, potencia, hex };
  }

  /** Flexibilidad [mm/N] en el punto de carga (ap/2 desde la punta). */
  function flexibilidad(t, c) {
    const E = MATERIAL_HERRAMIENTA[t.material].E;
    const Lo = Math.max(c.voladizo, 1e-3);
    const a = Math.min(c.ap / 2, Lo);
    const dCorte = 0.8 * t.D1; // núcleo equivalente de la zona con hélices
    const diam = (x) => (x <= t.L2 ? dCorte : x <= t.L3 ? Math.min(t.D3, t.D1) : t.D2);
    const N = 400;
    let s = 0;
    for (let i = 0; i < N; i++) {
      const x = a + ((i + 0.5) / N) * (Lo - a);
      const d = diam(x);
      const I = (Math.PI * d ** 4) / 64;
      s += ((x - a) ** 2 / (E * I)) * ((Lo - a) / N);
    }
    return s;
  }

  // ---------------------------------------------------------- predicción

  function gradoISO(ra) {
    for (const [g, v] of GRADOS_ISO) if (ra <= v * 1.0001) return g;
    return '> N12';
  }

  function factorDinamico(t, c) {
    const mat = MATERIALES[c.material];
    let k = 1;
    const bue = mat.bue && c.vc >= mat.bue[0] && c.vc < mat.bue[1];
    if (bue) k *= 1.5;
    const esbeltez = c.voladizo / t.D1;
    if (esbeltez > 3) k *= 1 + 0.12 * (esbeltez - 3);
    return { k, bue, esbeltez };
  }

  function combinar(cin, rtAdd, kdyn, kcal) {
    const Ra = (kdyn * cin.Ra + rtAdd / 4) * kcal;
    const Rz = (kdyn * cin.Rz + rtAdd) * kcal;
    const Rt = (kdyn * cin.Rt + rtAdd) * kcal;
    return {
      Ra: Ra * 1000, Rz: Rz * 1000, Rt: Rt * 1000,
      RaCin: cin.Ra * 1000, RzCin: cin.Rz * 1000, RtCin: cin.Rt * 1000,
      grado: gradoISO(Ra * 1000),
    };
  }

  /**
   * Predicción completa.
   * @param {object} toolIn  parámetros de herramienta (ver TOOL_DEFAULTS)
   * @param {object} cutIn   condiciones de corte (ver CUT_DEFAULTS)
   * @param {object} [opt]   { puntos, sinFuerzas }
   */
  function predecir(toolIn, cutIn, opt) {
    const t = normalizeTool(toolIn);
    const c = normalizeCut(cutIn);
    const nPts = (opt && opt.puntos) || 1500;
    const mat = MATERIALES[c.material];
    const hmin = (mat.lambda * t.radioFilo) / 1000;
    const R1 = t.D1 / 2;
    const dyn = factorDinamico(t, c);
    const frev = c.fz * t.z;

    const out = { tool: t, cut: c, avisos: [] };

    // Pared
    if (t.arista === 'ESF' && c.ap < R1) {
      out.pared = null;
    } else {
      const p = perfilPared(t, c, nPts);
      const Reff = R1 + (c.sentido === 'oposicion' ? 1 : -1) * frev / Math.PI;
      const brm = Math.min((Reff * hmin) / (c.fz * c.fz), 1);
      out.pared = Object.assign(combinar(parametrosPerfil(p.ys), (hmin / 2) * (1 + brm), dyn.k, c.kcal), { perfil: p });
    }

    // Suelo, avance
    {
      const p = perfilSueloAvance(t, c, nPts);
      const rc = t.arista === 'R' || t.arista === 'ESF' ? t.chR : 0;
      const brm = Math.min((rc * hmin) / (c.fz * c.fz), 1);
      out.sueloAvance = Object.assign(combinar(parametrosPerfil(p.ys), (hmin / 2) * (1 + brm), dyn.k, c.kcal), { perfil: p });
    }

    // Suelo, transversal (cresta entre pasadas)
    if (c.ae < t.D1) {
      const p = perfilSueloTransversal(t, c, nPts);
      out.sueloTransversal = Object.assign(combinar(parametrosPerfil(p.ys), 0, 1, c.kcal), { perfil: p });
    } else {
      out.sueloTransversal = null;
      out.avisos.push({ nivel: 'info', texto: 'ae ≥ D1: no hay solape entre pasadas en el suelo; la rugosidad transversal no aplica (quedaría un escalón).' });
    }

    out.suelo = out.sueloTransversal && out.sueloTransversal.Ra > out.sueloAvance.Ra
      ? Object.assign({ direccion: 'transversal' }, out.sueloTransversal)
      : Object.assign({ direccion: 'avance' }, out.sueloAvance);

    // Cinemática de máquina
    const Deff = diametroEfectivo(t, c.ap);
    const n = (1000 * c.vc) / (Math.PI * Deff);
    out.maquina = { Deff, n, vf: n * frev, Q: (c.ap * Math.min(c.ae, t.D1) * n * frev) / 1000 };

    if (!(opt && opt.sinFuerzas)) {
      const f = fuerzas(t, c);
      const C = flexibilidad(t, c);
      out.fuerzas = Object.assign(f, { rigidez: 1 / C / 1000, flexion: f.FyMax * C * 1000, flexionMax: f.Fmax * C * 1000 });
    }

    // Avisos
    const av = out.avisos;
    if (c.ap > t.L2) av.push({ nivel: 'error', texto: `ap (${c.ap} mm) supera la longitud de corte L2 (${t.L2} mm).` });
    if (t.D3 < t.D1 && c.ap > t.L3) av.push({ nivel: 'error', texto: 'ap supera la longitud del cuello L3: el cuello rozaría la pared.' });
    if (c.voladizo < t.L3) av.push({ nivel: 'aviso', texto: 'El voladizo es menor que L3: la pinza amarraría sobre el cuello.' });
    if (c.voladizo > t.L1) av.push({ nivel: 'error', texto: 'El voladizo es mayor que la longitud total L1.' });
    if (dyn.esbeltez > 4) av.push({ nivel: 'aviso', texto: `Voladizo/D1 = ${dyn.esbeltez.toFixed(1)}: riesgo de vibración (chatter). La predicción es optimista.` });
    if (dyn.bue) av.push({ nivel: 'aviso', texto: `Vc = ${c.vc} m/min está en la zona de filo recrecido para ${mat.nombre}. Subir Vc mejora el acabado.` });
    if (out.fuerzas && out.fuerzas.hex < hmin) av.push({ nivel: 'aviso', texto: `Espesor de viruta máx. (${(out.fuerzas.hex * 1000).toFixed(1)} µm) menor que el mínimo (${(hmin * 1000).toFixed(1)} µm): el filo roza en lugar de cortar.` });
    if (t.arista === 'ESF' && c.ap < R1) av.push({ nivel: 'info', texto: `Esférica con ap < R: Vc se aplica al diámetro efectivo ${Deff.toFixed(2)} mm. Rugosidad de pared no aplica.` });
    if (out.fuerzas && out.fuerzas.flexion > 20) av.push({ nivel: 'aviso', texto: `Flexión de la herramienta ≈ ${out.fuerzas.flexion.toFixed(0)} µm: error de forma apreciable en la pared.` });
    if (t.arista === 'CH' && c.fz > t.chR) av.push({ nivel: 'info', texto: 'fz mayor que el chaflán: la marca la genera el filo frontal (dish), no el chaflán.' });
    return out;
  }

  /** Mayor fz que cumple Ra ≤ objetivo [µm] en la superficie indicada ('pared' | 'suelo'). */
  function fzParaRa(tool, cut, objetivo, superficie) {
    let mejor = null;
    const fzs = [];
    for (let i = 0; i <= 80; i++) fzs.push(0.003 * Math.pow(0.6 / 0.003, i / 80));
    for (const fz of fzs) {
      const r = predecir(tool, Object.assign({}, cut, { fz }), { puntos: 500, sinFuerzas: true });
      const s = r[superficie];
      if (!s) return null;
      if (s.Ra <= objetivo) mejor = fz;
    }
    return mejor;
  }

  /** Curva Ra(fz) para pared y suelo. */
  function curvaFz(tool, cut, fzMin, fzMax, n) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const fz = fzMin + ((fzMax - fzMin) * i) / (n - 1);
      const r = predecir(tool, Object.assign({}, cut, { fz }), { puntos: 500, sinFuerzas: true });
      pts.push({ fz, pared: r.pared ? r.pared.Ra : null, suelo: r.suelo.Ra });
    }
    return pts;
  }

  /**
   * Ajusta el factor de calibración por mínimos cuadrados (recta por el origen)
   * a partir de mediciones: [{ fz, vc, ap, ae, superficie, ra }].
   */
  function calibrar(tool, cut, medidas) {
    let num_ = 0, den = 0;
    const filas = [];
    for (const m of medidas) {
      const c = Object.assign({}, cut, { kcal: 1 });
      for (const k of ['fz', 'vc', 'ap', 'ae']) if (Number.isFinite(m[k])) c[k] = m[k];
      const r = predecir(tool, c, { puntos: 800, sinFuerzas: true });
      const s = r[m.superficie === 'pared' ? 'pared' : 'suelo'];
      if (!s || !(m.ra > 0)) continue;
      num_ += m.ra * s.Ra;
      den += s.Ra * s.Ra;
      filas.push({ medida: m.ra, prediccion: s.Ra });
    }
    if (!den) return null;
    const k = num_ / den;
    const err = filas.map((f) => Math.abs(f.prediccion * k - f.medida) / f.medida);
    return { kcal: k, filas, errorMedio: err.reduce((a, b) => a + b, 0) / err.length };
  }

  return {
    MATERIALES, MATERIAL_HERRAMIENTA, GRADOS_ISO, TOOL_DEFAULTS, CUT_DEFAULTS,
    normalizeTool, normalizeCut, alturaFilo, radioPuntoBajo, diametroEfectivo,
    parametrosPerfil, predecir, fzParaRa, curvaFz, calibrar, gradoISO, flexibilidad, fuerzas,
  };
});
