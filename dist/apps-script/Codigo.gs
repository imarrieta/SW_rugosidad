/*
 * Servidor del contador de horas compartido (Google Apps Script + Google Sheets).
 *
 * Va vinculado a una hoja de cálculo con cuatro pestañas, que se crean solas:
 *   Proyectos  id | nombre | cliente | color | tarifa | archivado | creadoPor | creado
 *   Registros  id | persona | proyectoId | inicio | fin | horas | nota | modificado
 *   Activos    persona | proyectoId | inicio | nota      (cronómetros en marcha)
 *   Config     clave | valor | explicación
 *
 * Se publica como aplicación web «ejecutar como: yo» y «acceso: cualquier usuario
 * del dominio»: cada persona entra con su cuenta de Google de la empresa y la hoja
 * solo la toca este script. La validación reutiliza el motor de Horas.gs.
 */

const HOJAS = {
  Proyectos: ['id', 'nombre', 'cliente', 'color', 'tarifa', 'archivado', 'creadoPor', 'creado'],
  Registros: ['id', 'persona', 'proyectoId', 'inicio', 'fin', 'horas', 'nota', 'modificado'],
  Activos: ['persona', 'proyectoId', 'inicio', 'nota'],
  Config: ['clave', 'valor', 'explicación'],
};

const CONFIG_INICIAL = [
  ['admins', '', 'Correos separados por comas. Pueden editar y borrar cualquier proyecto y ven las horas de todos. El propietario del script siempre es administrador.'],
  ['todosVenGrupo', 'no', 'sí = cualquier persona ve las horas de todo el grupo; no = cada uno solo las suyas.'],
  ['todosCreanProyectos', 'sí', 'sí = cualquiera puede crear proyectos (y editar los que creó); no = solo los administradores.'],
];

// Margen admitido entre el reloj del ordenador y el del servidor.
const MARGEN_RELOJ = 5 * 60 * 1000;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Horas por proyecto')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Ejecutar una vez desde el editor: crea las pestañas y fija la hoja de datos.
function instalar() {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  if (!libro) throw new Error('Abre el editor desde la hoja de cálculo: Extensiones > Apps Script.');
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', libro.getId());
  Object.keys(HOJAS).forEach(hoja_);
}

// ---------- acceso a la hoja ----------

function libro_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
}

function hoja_(nombre) {
  const libro = libro_();
  let h = libro.getSheetByName(nombre);
  if (!h) {
    h = libro.insertSheet(nombre);
    h.getRange(1, 1, 1, HOJAS[nombre].length).setValues([HOJAS[nombre]]);
    h.setFrozenRows(1);
    if (nombre === 'Config') h.getRange(2, 1, CONFIG_INICIAL.length, 3).setValues(CONFIG_INICIAL);
  }
  return h;
}

function filas_(nombre) {
  const h = hoja_(nombre);
  const n = h.getLastRow() - 1;
  return n > 0 ? h.getRange(2, 1, n, HOJAS[nombre].length).getValues() : [];
}

// Nº de fila (en la hoja) cuya columna `col` (0 = A) vale `valor`, o 0.
function buscar_(nombre, col, valor) {
  const datos = filas_(nombre);
  for (let i = 0; i < datos.length; i++) {
    if (String(datos[i][col]).toLowerCase() === String(valor).toLowerCase()) return i + 2;
  }
  return 0;
}

function escribirFila_(nombre, fila, valores) {
  hoja_(nombre).getRange(fila, 1, 1, valores.length).setValues([valores]);
}

function anadirFila_(nombre, valores) {
  const h = hoja_(nombre);
  h.getRange(h.getLastRow() + 1, 1, 1, valores.length).setValues([valores]);
}

// Sustituye todas las filas de datos (para borrados en bloque).
function reescribir_(nombre, filas) {
  const h = hoja_(nombre);
  const ancho = HOJAS[nombre].length;
  const antes = h.getLastRow() - 1;
  if (antes > 0) h.getRange(2, 1, antes, ancho).clearContent();
  if (filas.length) h.getRange(2, 1, filas.length, ancho).setValues(filas);
}

const ms_ = (v) => (v instanceof Date ? v.getTime() : Number(v));
const minus_ = (v) => String(v || '').trim().toLowerCase();
const si_ = (v) => /^(s[ií]|yes|true|1|verdadero)$/i.test(String(v).trim());
// Texto que Sheets interpretaría como fórmula (=, +, -, @) se guarda como texto literal.
const texto_ = (v) => { const t = String(v || ''); return /^[=+\-@]/.test(t) ? "'" + t : t; };
// Acepta el id generado en la página si tiene buen formato y no está usado.
const idNuevo_ = (id, usados) => (/^[a-z0-9]{6,32}$/.test(String(id)) && !usados.some((x) => x.id === id) ? id : Horas.nuevoId());

// ---------- usuario y permisos ----------

function contexto_() {
  const email = minus_(Session.getActiveUser().getEmail());
  if (!email) throw new Error('No se puede identificar tu cuenta. Entra en Chrome con tu cuenta de Google de la empresa.');
  const cfg = {};
  filas_('Config').forEach((f) => { cfg[String(f[0]).trim()] = String(f[1]).trim(); });
  const admins = String(cfg.admins || '').split(/[,;\s]+/).map(minus_).filter(Boolean);
  const admin = email === minus_(Session.getEffectiveUser().getEmail()) || admins.indexOf(email) >= 0;
  return {
    email,
    admin,
    verGrupo: admin || si_(cfg.todosVenGrupo || 'no'),
    crearProyectos: admin || si_(cfg.todosCreanProyectos || 'sí'),
  };
}

function leerEstado_(ctx) {
  const proyectos = filas_('Proyectos').filter((f) => f[0]).map((f) => ({
    id: String(f[0]), nombre: String(f[1]), cliente: String(f[2]), color: String(f[3]),
    tarifa: Number(f[4]) || 0, archivado: f[5] === true || si_(f[5]), creadoPor: minus_(f[6]),
  }));
  const registros = filas_('Registros')
    .filter((f) => f[0] && (ctx.verGrupo || minus_(f[1]) === ctx.email))
    .map((f) => ({ id: String(f[0]), persona: minus_(f[1]), proyectoId: String(f[2]), inicio: ms_(f[3]), fin: ms_(f[4]), nota: String(f[6]) }));
  const a = filas_('Activos').filter((f) => minus_(f[0]) === ctx.email)[0];
  const activo = a ? { proyectoId: String(a[1]), inicio: ms_(a[2]), nota: String(a[3]) } : null;
  return Horas.normalizarEstado({ proyectos, registros, activo });
}

function filaProyecto_(p) {
  return [p.id, texto_(p.nombre), texto_(p.cliente), p.color, p.tarifa || '', !!p.archivado, p.creadoPor || '', new Date()];
}

function filaRegistro_(r) {
  return [r.id, r.persona, r.proyectoId, new Date(r.inicio), new Date(r.fin),
    Math.round((r.fin - r.inicio) / 36e3) / 100, texto_(r.nota), new Date()];
}

// Cierra el cronómetro de la persona (si lo tiene) y guarda el tramo.
function cerrarActivo_(ctx, estado, cuando) {
  const s = Horas.parar(estado, cuando);
  if (s.registros.length > estado.registros.length) {
    const r = s.registros[s.registros.length - 1];
    anadirFila_('Registros', filaRegistro_({ ...r, persona: ctx.email }));
  }
  const fila = buscar_('Activos', 0, ctx.email);
  if (fila) hoja_('Activos').deleteRow(fila);
}

// ---------- API llamada desde la página (google.script.run.api) ----------

function api(op, args) {
  args = args || {};
  const ctx = contexto_();
  if (op === 'estado') return respuesta_(ctx);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ahora = Date.now();
    const cuando = Math.abs(Number(args.cuando) - ahora) < MARGEN_RELOJ ? Number(args.cuando) : ahora;
    const estado = leerEstado_(ctx);
    const puedeEditarProyecto = (p) => ctx.admin || (p.creadoPor && p.creadoPor === ctx.email);
    const registroPropio = (id) => {
      const fila = buscar_('Registros', 0, id);
      if (!fila) throw new Error('El registro ya no existe');
      const persona = minus_(hoja_('Registros').getRange(fila, 2).getValue());
      if (persona !== ctx.email && !ctx.admin) throw new Error('Solo puedes modificar tus propios registros');
      return { fila, persona };
    };

    switch (op) {
      case 'crearProyecto': {
        if (!ctx.crearProyectos) throw new Error('Solo los administradores pueden crear proyectos');
        const r = Horas.crearProyecto(estado, { ...args.datos, id: idNuevo_(args.datos.id, estado.proyectos), creadoPor: ctx.email });
        anadirFila_('Proyectos', filaProyecto_(r.proyecto));
        break;
      }
      case 'editarProyecto': {
        const p = estado.proyectos.find((x) => x.id === args.id);
        if (!p) throw new Error('El proyecto ya no existe');
        if (!puedeEditarProyecto(p)) throw new Error('Solo un administrador o quien creó el proyecto puede editarlo');
        const cambios = {};
        ['nombre', 'cliente', 'color', 'tarifa', 'archivado'].forEach((k) => { if (k in args.cambios) cambios[k] = args.cambios[k]; });
        const s = Horas.editarProyecto(estado, p.id, cambios);
        const nuevo = s.proyectos.find((x) => x.id === p.id);
        const fila = buscar_('Proyectos', 0, p.id);
        const creado = hoja_('Proyectos').getRange(fila, 8).getValue();
        escribirFila_('Proyectos', fila, [...filaProyecto_(nuevo).slice(0, 7), creado]);
        break;
      }
      case 'borrarProyecto': {
        if (!ctx.admin) throw new Error('Solo los administradores pueden borrar proyectos');
        const id = String(args.id);
        reescribir_('Proyectos', filas_('Proyectos').filter((f) => String(f[0]) !== id));
        reescribir_('Registros', filas_('Registros').filter((f) => String(f[2]) !== id));
        reescribir_('Activos', filas_('Activos').filter((f) => String(f[1]) !== id));
        break;
      }
      case 'iniciar': {
        const p = estado.proyectos.find((x) => x.id === args.proyectoId);
        if (!p || p.archivado) throw new Error('Ese proyecto no existe o está archivado');
        cerrarActivo_(ctx, estado, cuando);
        anadirFila_('Activos', [ctx.email, p.id, new Date(cuando), texto_(String(args.nota || '').trim())]);
        break;
      }
      case 'parar':
        cerrarActivo_(ctx, estado, cuando);
        break;
      case 'notaActivo': {
        const fila = buscar_('Activos', 0, ctx.email);
        if (fila) hoja_('Activos').getRange(fila, 4).setValue(texto_(String(args.nota || '').trim()));
        break;
      }
      case 'agregarRegistro': {
        const s = Horas.agregarRegistro(estado, { ...args.datos, id: idNuevo_(args.datos.id, estado.registros), persona: ctx.email });
        anadirFila_('Registros', filaRegistro_(s.registros[s.registros.length - 1]));
        break;
      }
      case 'editarRegistro': {
        const { fila, persona } = registroPropio(args.id);
        const c = args.cambios;
        const s = Horas.editarRegistro(estado, args.id, { proyectoId: c.proyectoId, inicio: c.inicio, fin: c.fin, nota: c.nota });
        escribirFila_('Registros', fila, filaRegistro_({ ...s.registros.find((x) => x.id === args.id), persona }));
        break;
      }
      case 'borrarRegistro': {
        const { fila } = registroPropio(args.id);
        hoja_('Registros').deleteRow(fila);
        break;
      }
      default:
        throw new Error('Operación desconocida: ' + op);
    }
    return respuesta_(ctx);
  } finally {
    lock.releaseLock();
  }
}

function respuesta_(ctx) {
  return {
    estado: leerEstado_(ctx),
    sesion: {
      yo: ctx.email, admin: ctx.admin, verGrupo: ctx.verGrupo, crearProyectos: ctx.crearProyectos,
      hojaUrl: ctx.admin ? libro_().getUrl() : '',
    },
  };
}
