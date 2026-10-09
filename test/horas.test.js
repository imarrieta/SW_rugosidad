const test = require('node:test');
const assert = require('node:assert/strict');
const H = require('../src/horas.js');

const { HORA, MIN } = H;
const t = (dia, hora) => H.aMs(dia, hora);

function base() {
  let s = H.estadoVacio();
  let r = H.crearProyecto(s, { nombre: 'Alfa', tarifa: 40 }); s = r.estado; const a = r.proyecto;
  r = H.crearProyecto(s, { nombre: 'Beta' }); s = r.estado; const b = r.proyecto;
  return { s, a, b };
}

test('formatDuracion y parseDuracion', () => {
  assert.equal(H.formatDuracion(90 * MIN), '1:30');
  assert.equal(H.formatDuracion(26 * HORA + 5 * MIN), '26:05');
  assert.equal(H.formatDuracion(61 * 1000, true), '0:01:01');
  assert.equal(H.parseDuracion('1:30'), 90 * MIN);
  assert.equal(H.parseDuracion('1,5'), 90 * MIN);
  assert.equal(H.parseDuracion('2h'), 120 * MIN);
  assert.equal(H.parseDuracion('45m'), 45 * MIN);
  assert.equal(H.parseDuracion('1h 15m'), 75 * MIN);
  assert.equal(H.parseDuracion('abc'), null);
  assert.equal(H.horasDecimales(90 * MIN), '1,50');
});

test('periodos: semana de lunes a domingo, mes y salto', () => {
  const vie = t('2026-10-09', '15:00');
  const sem = H.periodo('semana', vie);
  assert.equal(sem.desde, t('2026-10-05'));
  assert.equal(sem.hasta, t('2026-10-12'));
  const dom = H.periodo('semana', t('2026-10-11', '23:00'));
  assert.equal(dom.desde, t('2026-10-05'));
  assert.equal(H.periodo('mes', vie, -1).desde, t('2026-09-01'));
  assert.equal(H.periodo('anio', vie).hasta, t('2027-01-01'));
});

test('crear proyecto: nombre obligatorio y sin duplicados', () => {
  const { s } = base();
  assert.throws(() => H.crearProyecto(s, { nombre: '  ' }));
  assert.throws(() => H.crearProyecto(s, { nombre: 'alfa' }));
});

test('cronómetro: iniciar otro proyecto cierra el anterior', () => {
  let { s, a, b } = base();
  s = H.iniciar(s, a.id, t('2026-10-09', '09:00'));
  s = H.iniciar(s, b.id, t('2026-10-09', '10:30'));
  assert.equal(s.registros.length, 1);
  assert.equal(s.registros[0].fin - s.registros[0].inicio, 90 * MIN);
  assert.equal(s.activo.proyectoId, b.id);
  // El cronómetro en marcha cuenta en los totales.
  const dia = H.periodo('dia', t('2026-10-09', '12:00'));
  const tot = H.totales(s, dia.desde, dia.hasta, t('2026-10-09', '11:00'));
  assert.equal(tot.porProyecto[a.id], 90 * MIN);
  assert.equal(tot.porProyecto[b.id], 30 * MIN);
  assert.equal(tot.total, 2 * HORA);
});

test('parar: descarta menos de un minuto', () => {
  let { s, a } = base();
  s = H.iniciar(s, a.id, 1000);
  s = H.parar(s, 1000 + 30 * 1000);
  assert.equal(s.registros.length, 0);
  assert.equal(s.activo, null);
});

test('un registro que cruza medianoche se reparte entre los dos días', () => {
  let { s, a } = base();
  s = H.agregarRegistro(s, { proyectoId: a.id, inicio: t('2026-10-08', '22:00'), fin: t('2026-10-09', '01:30') });
  const dias = H.totalesPorDia(s, t('2026-10-08'), t('2026-10-10'), 0);
  assert.equal(dias[0].total, 2 * HORA);
  assert.equal(dias[1].total, 90 * MIN);
});

test('registros manuales: validación, edición y borrado', () => {
  let { s, a } = base();
  assert.throws(() => H.agregarRegistro(s, { proyectoId: a.id, inicio: 2000, fin: 1000 }));
  assert.throws(() => H.agregarRegistro(s, { proyectoId: 'x', inicio: 1000, fin: 2000 }));
  s = H.agregarRegistro(s, { proyectoId: a.id, inicio: 0, fin: HORA, nota: ' reunión ' });
  const id = s.registros[0].id;
  assert.equal(s.registros[0].nota, 'reunión');
  s = H.editarRegistro(s, id, { fin: 2 * HORA });
  assert.equal(s.registros[0].fin, 2 * HORA);
  s = H.borrarRegistro(s, id);
  assert.equal(s.registros.length, 0);
});

test('borrar proyecto elimina sus horas y su cronómetro', () => {
  let { s, a, b } = base();
  s = H.agregarRegistro(s, { proyectoId: a.id, inicio: 0, fin: HORA });
  s = H.agregarRegistro(s, { proyectoId: b.id, inicio: 0, fin: HORA });
  s = H.iniciar(s, a.id, 2 * HORA);
  s = H.borrarProyecto(s, a.id);
  assert.equal(s.proyectos.length, 1);
  assert.equal(s.registros.length, 1);
  assert.equal(s.activo, null);
});

test('normalizarEstado limpia datos incoherentes y rechaza basura', () => {
  assert.throws(() => H.normalizarEstado({ foo: 1 }));
  const s = H.normalizarEstado({
    proyectos: [{ id: 'p1', nombre: 'Uno', color: 'rojo' }, { id: 'p2', nombre: '' }],
    registros: [
      { id: 'r1', proyectoId: 'p1', inicio: 0, fin: 1000 },
      { id: 'r2', proyectoId: 'p2', inicio: 0, fin: 1000 },
      { id: 'r3', proyectoId: 'p1', inicio: 5, fin: 1 },
    ],
    activo: { proyectoId: 'p1', inicio: 10 },
  });
  assert.equal(s.proyectos.length, 1);
  assert.match(s.proyectos[0].color, /^#[0-9a-f]{6}$/i);
  assert.deepEqual(s.registros.map((r) => r.id), ['r1']);
  assert.equal(s.activo.proyectoId, 'p1');
});

test('CSV: separador ;, coma decimal y comillas escapadas', () => {
  let { s, a } = base();
  s = H.agregarRegistro(s, { proyectoId: a.id, inicio: t('2026-10-09', '09:00'), fin: t('2026-10-09', '10:30'), nota: 'dijo "ok"' });
  const csv = H.aCSV(s, -Infinity, Infinity, 0);
  const lineas = csv.replace('﻿', '').trim().split('\r\n');
  assert.equal(lineas.length, 2);
  assert.equal(lineas[1], '"2026-10-09";"Alfa";"";"09:00";"10:30";"1,50";"1:30";"dijo ""ok"""');
});
