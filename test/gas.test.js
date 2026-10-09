const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { crearEntornoGAS } = require('./gas-mock.js');

const raiz = path.join(__dirname, '..');
const HORA = 3600e3;

// Carga Horas.gs + Codigo.gs en un contexto aislado con los servicios simulados.
function servidor() {
  const env = crearEntornoGAS({ propietario: 'jefa@empresa.com' });
  const ctx = vm.createContext({ ...env.globals, Date, Math, JSON });
  vm.runInContext(fs.readFileSync(path.join(raiz, 'src/horas.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(raiz, 'gas/Codigo.gs'), 'utf8') + '\n;this.api = api; this.instalar = instalar;', ctx);
  ctx.instalar();
  const como = (email) => { env.sesion.usuario = email; return (op, args) => JSON.parse(JSON.stringify(ctx.api(op, args))); };
  return { env, como, hoja: (n) => env.hojas[n] };
}

test('instalar crea las cuatro pestañas con cabecera y configuración', () => {
  const { hoja } = servidor();
  assert.deepEqual(Object.keys(servidor().env.hojas).sort(), ['Activos', 'Config', 'Proyectos', 'Registros']);
  assert.equal(hoja('Registros').data[0][1], 'persona');
  assert.equal(hoja('Config').data[1][0], 'admins');
});

test('el propietario es administrador; los demás no', () => {
  const { como } = servidor();
  assert.equal(como('jefa@empresa.com')('estado').sesion.admin, true);
  const ana = como('ana@empresa.com')('estado').sesion;
  assert.equal(ana.admin, false);
  assert.equal(ana.verGrupo, false);
  assert.equal(ana.crearProyectos, true);
  assert.equal(ana.hojaUrl, '');
});

test('cronómetro por persona y visibilidad de horas', () => {
  const { como, hoja } = servidor();
  const jefa = como('jefa@empresa.com');
  const pid = jefa('crearProyecto', { datos: { nombre: 'Obra Norte' } }).estado.proyectos[0].id;

  const t0 = Date.now() - 2 * HORA;
  const ana = como('ana@empresa.com');
  // Un reloj desfasado más de 5 min se sustituye por la hora del servidor.
  let r = ana('iniciar', { proyectoId: pid, nota: 'planos', cuando: t0 });
  assert.ok(Math.abs(r.estado.activo.inicio - Date.now()) < 5000);
  r = como('ana@empresa.com')('agregarRegistro', { datos: { proyectoId: pid, inicio: t0, fin: t0 + HORA, nota: 'visita' } });
  assert.equal(r.estado.registros.length, 1);
  assert.equal(r.estado.registros[0].persona, 'ana@empresa.com');

  const luis = como('luis@empresa.com');
  r = luis('agregarRegistro', { datos: { proyectoId: pid, inicio: t0, fin: t0 + 2 * HORA } });
  assert.equal(r.estado.registros.length, 1, 'Luis solo ve lo suyo');
  assert.equal(r.estado.activo, null, 'el cronómetro de Ana no es el de Luis');

  r = como('jefa@empresa.com')('estado');
  assert.equal(r.estado.registros.length, 2, 'la administradora ve a todos');
  assert.equal(hoja('Registros').data[1][5], 1, 'columna horas en decimal');
});

test('parar guarda el tramo y libera el cronómetro', () => {
  const { como, hoja } = servidor();
  const jefa = como('jefa@empresa.com');
  const pid = jefa('crearProyecto', { datos: { nombre: 'P' } }).estado.proyectos[0].id;
  const ahora = Date.now();
  jefa('iniciar', { proyectoId: pid, cuando: ahora - 3 * 60e3 });
  const r = jefa('parar', { cuando: ahora });
  assert.equal(r.estado.activo, null);
  assert.equal(r.estado.registros.length, 1);
  assert.equal(r.estado.registros[0].fin - r.estado.registros[0].inicio, 3 * 60e3);
  assert.equal(hoja('Activos').getLastRow(), 1);
});

test('permisos: registros ajenos y proyectos', () => {
  const { como, hoja } = servidor();
  const ana = como('ana@empresa.com');
  const pid = ana('crearProyecto', { datos: { nombre: 'De Ana' } }).estado.proyectos[0].id;
  const t0 = Date.now() - 5 * HORA;
  const rid = como('ana@empresa.com')('agregarRegistro', { datos: { proyectoId: pid, inicio: t0, fin: t0 + HORA } }).estado.registros[0].id;

  const luis = como('luis@empresa.com');
  assert.throws(() => luis('borrarRegistro', { id: rid }), /propios/);
  assert.throws(() => luis('editarProyecto', { id: pid, cambios: { nombre: 'Mío' } }), /administrador/);
  assert.throws(() => luis('borrarProyecto', { id: pid }), /administradores/);

  // Quien lo creó puede editarlo, pero no borrarlo.
  let r = como('ana@empresa.com')('editarProyecto', { id: pid, cambios: { nombre: 'De Ana v2', tarifa: 30 } });
  assert.equal(r.estado.proyectos[0].nombre, 'De Ana v2');
  assert.ok(hoja('Proyectos').data[1][7] instanceof Date, 'conserva la fecha de creación');
  assert.throws(() => como('ana@empresa.com')('borrarProyecto', { id: pid }));

  // La administradora puede editar el registro de Ana sin cambiar de quién es.
  r = como('jefa@empresa.com')('editarRegistro', { id: rid, cambios: { proyectoId: pid, inicio: t0, fin: t0 + 2 * HORA, nota: 'corregido' } });
  const reg = r.estado.registros.find((x) => x.id === rid);
  assert.equal(reg.persona, 'ana@empresa.com');
  assert.equal(reg.nota, 'corregido');

  r = como('jefa@empresa.com')('borrarProyecto', { id: pid });
  assert.equal(r.estado.proyectos.length, 0);
  assert.equal(hoja('Registros').getLastRow(), 1);
});

test('configuración: admins y solo administradores crean proyectos', () => {
  const { como, hoja } = servidor();
  hoja('Config').data[1][1] = 'Ana@empresa.com, otro@empresa.com';
  hoja('Config').data[3][1] = 'no';
  assert.equal(como('ana@empresa.com')('estado').sesion.admin, true);
  assert.throws(() => como('luis@empresa.com')('crearProyecto', { datos: { nombre: 'X' } }), /administradores/);
});

test('validación del motor llega al usuario', () => {
  const { como } = servidor();
  const jefa = como('jefa@empresa.com');
  const pid = jefa('crearProyecto', { datos: { nombre: 'P' } }).estado.proyectos[0].id;
  assert.throws(() => jefa('crearProyecto', { datos: { nombre: 'p' } }), /Ya existe/);
  assert.throws(() => jefa('agregarRegistro', { datos: { proyectoId: pid, inicio: 2000, fin: 1000 } }), /posterior/);
  assert.throws(() => jefa('nada'), /desconocida/);
});

test('notas y nombres que parecen fórmulas se guardan como texto', () => {
  const { como, hoja } = servidor();
  const jefa = como('jefa@empresa.com');
  const pid = jefa('crearProyecto', { datos: { nombre: '=HYPERLINK("x")' } }).estado.proyectos[0].id;
  const t0 = Date.now() - HORA;
  const r = jefa('agregarRegistro', { datos: { proyectoId: pid, inicio: t0, fin: t0 + HORA, nota: '=IMPORTXML("http://x")' } });
  assert.equal(hoja('Registros').data[1][6], '=IMPORTXML("http://x")');
  assert.equal(typeof hoja('Proyectos').data[1][1], 'string');
  assert.equal(r.estado.registros[0].nota, '=IMPORTXML("http://x")');
});

test('un id repetido o raro enviado por la página se sustituye', () => {
  const { como } = servidor();
  const jefa = como('jefa@empresa.com');
  const a = jefa('crearProyecto', { datos: { id: 'abc123def', nombre: 'A' } }).estado.proyectos[0];
  assert.equal(a.id, 'abc123def');
  const ps = jefa('crearProyecto', { datos: { id: 'abc123def', nombre: 'B' } }).estado.proyectos;
  assert.equal(new Set(ps.map((p) => p.id)).size, 2);
  const c = jefa('crearProyecto', { datos: { id: '<script>', nombre: 'C' } }).estado.proyectos.find((p) => p.nombre === 'C');
  assert.match(c.id, /^[a-z0-9]+$/);
});
