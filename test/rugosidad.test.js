const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../src/rugosidad.js');

const ideal = { z: 4, D1: 10, runout: 0, runoutAxial: 0, radioFilo: 0, dish: 1.5 };
const corte = { fz: 0.1, ap: 5, ae: 1, voladizo: 30, vc: 200 };
const um = (mm) => mm * 1000;
const cerca = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${a} ≉ ${b}`);

test('pared: Rt cinemática coincide con Martellotti (concordancia)', () => {
  const r = R.predecir(ideal, corte);
  const frev = 0.4;
  cerca(r.pared.RtCin, um(0.1 ** 2 / (8 * (5 - frev / Math.PI))), 0.02);
});

test('pared: oposición deja menos cresta que concordancia', () => {
  const a = R.predecir(ideal, { ...corte, sentido: 'oposicion' });
  const b = R.predecir(ideal, { ...corte, sentido: 'concordancia' });
  assert.ok(a.pared.RtCin < b.pared.RtCin);
});

test('suelo arista viva: Rt = fz·tan(dish)', () => {
  const r = R.predecir(ideal, corte);
  cerca(r.sueloAvance.RtCin, um(0.1 * Math.tan((1.5 * Math.PI) / 180)), 0.02);
});

test('suelo chaflán 45°: Rt = fz/(cot45 + cot dish)', () => {
  const r = R.predecir({ ...ideal, arista: 'CH', chR: 0.5 }, corte);
  cerca(r.sueloAvance.RtCin, um(0.1 / (1 + 1 / Math.tan((1.5 * Math.PI) / 180))), 0.02);
});

test('suelo radio de punta sin dish: Rt ≈ fz²/(8R)', () => {
  const r = R.predecir({ ...ideal, arista: 'R', chR: 1, dish: 0 }, corte);
  // sin dish la cara frontal es plana: la cresta es arco-plano, por debajo de arco-arco
  assert.ok(r.sueloAvance.RtCin <= um(0.1 ** 2 / 8) * 1.02);
  const r2 = R.predecir({ ...ideal, arista: 'R', chR: 1, dish: 1.5 }, corte);
  assert.ok(r2.sueloAvance.RtCin > r.sueloAvance.RtCin);
});

test('esférica: cresta transversal = R − √(R² − (ae/2)²)', () => {
  const r = R.predecir({ ...ideal, arista: 'ESF' }, { ...corte, ae: 0.5, ap: 0.3 });
  cerca(r.sueloTransversal.RtCin, um(5 - Math.sqrt(25 - 0.25 ** 2)), 0.01);
  assert.equal(r.pared, null);
  assert.equal(r.suelo.direccion, 'transversal');
});

test('perfil triangular: Ra = Rt/4', () => {
  const ys = [];
  for (let i = 0; i < 10000; i++) ys.push(Math.abs(((i % 100) - 50) / 50));
  const p = R.parametrosPerfil(ys);
  cerca(p.Ra, p.Rt / 4, 0.01);
});

test('runout radial aumenta la rugosidad de pared', () => {
  const a = R.predecir(ideal, corte);
  const b = R.predecir({ ...ideal, runout: 10 }, corte);
  assert.ok(b.pared.RtCin > a.pared.RtCin * 2);
});

test('más avance → más rugosidad', () => {
  const a = R.predecir({}, { fz: 0.03 });
  const b = R.predecir({}, { fz: 0.15 });
  assert.ok(b.pared.Ra > a.pared.Ra);
  assert.ok(b.suelo.Ra > a.suelo.Ra);
});

test('flexión: viga escalonada con cuello más fino es más flexible', () => {
  const c = R.normalizeCut({ voladizo: 40, ap: 10 });
  const sin = R.flexibilidad(R.normalizeTool({ D3: 10, L3: 30 }), c);
  const con = R.flexibilidad(R.normalizeTool({ D3: 8, L3: 30 }), c);
  assert.ok(con > sin);
  // cilindro macizo: δ = F·L³/(3EI)
  const t = R.normalizeTool({ D1: 10, D2: 8, D3: 8, L2: 0, L3: 0 });
  const cc = R.normalizeCut({ voladizo: 40, ap: 0.002 });
  const I = (Math.PI * 8 ** 4) / 64;
  cerca(R.flexibilidad(t, cc), 40 ** 3 / (3 * 580000 * I), 0.01);
});

test('fzParaRa devuelve un avance que cumple el objetivo', () => {
  const fz = R.fzParaRa({}, {}, 1.0, 'pared');
  assert.ok(fz > 0);
  const r = R.predecir({}, { fz });
  assert.ok(r.pared.Ra <= 1.0 * 1.05);
});

test('calibración recupera un factor conocido', () => {
  const med = [0.04, 0.08, 0.12].map((fz) => ({
    fz, superficie: 'pared', ra: R.predecir({}, { fz }, { sinFuerzas: true, puntos: 800 }).pared.Ra * 1.7,
  }));
  const cal = R.calibrar({}, {}, med);
  cerca(cal.kcal, 1.7, 0.001);
});

test('avisos: ap mayor que L2', () => {
  const r = R.predecir({ L2: 10 }, { ap: 15 });
  assert.ok(r.avisos.some((a) => a.nivel === 'error' && a.texto.includes('L2')));
});

test('grados ISO 1302', () => {
  assert.equal(R.gradoISO(0.8), 'N6');
  assert.equal(R.gradoISO(0.81), 'N7');
  assert.equal(R.gradoISO(3.0), 'N8');
});
