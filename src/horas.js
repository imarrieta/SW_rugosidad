/*
 * Motor del contador de horas por proyecto.
 *
 * Estado (se guarda tal cual en el navegador y en las copias JSON):
 *   proyectos: [{ id, nombre, cliente, color, tarifa, archivado }]
 *   registros: [{ id, proyectoId, inicio, fin, nota }]   (inicio/fin en ms epoch)
 *   activo:    { proyectoId, inicio, nota } | null        (cronómetro en marcha)
 *
 * Los totales de un periodo cuentan solo la parte de cada registro que cae
 * dentro del periodo, así un registro que cruza medianoche se reparte bien.
 * Todas las fechas se interpretan en la hora local del navegador.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Horas = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const VERSION = 1;
  const MIN = 60 * 1000;
  const HORA = 60 * MIN;
  const COLORES = ['#1d5fa8', '#c4580e', '#1d7a4b', '#8a3ab9', '#b3261e', '#0f7c8c', '#9a5c00', '#4b5a6e'];

  function estadoVacio() {
    return { version: VERSION, proyectos: [], registros: [], activo: null };
  }

  function nuevoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---------- Duraciones ----------

  // ms → "h:mm" (las horas pueden pasar de 24).
  function formatDuracion(ms, conSegundos) {
    const neg = ms < 0;
    let s = Math.floor(Math.abs(ms) / 1000);
    if (!conSegundos) s = Math.round(s / 60) * 60;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const seg = s % 60;
    const base = `${h}:${String(m).padStart(2, '0')}`;
    return (neg ? '-' : '') + (conSegundos ? `${base}:${String(seg).padStart(2, '0')}` : base);
  }

  // ms → horas decimales con coma, p. ej. "1,50".
  function horasDecimales(ms, decimales = 2) {
    return (ms / HORA).toFixed(decimales).replace('.', ',');
  }

  // Acepta "1:30", "1,5", "1.5", "2h", "45m", "1h 30m", "1h30". Devuelve ms o null.
  function parseDuracion(texto) {
    const t = String(texto || '').trim().toLowerCase().replace(/\s+/g, '');
    if (!t) return null;
    let m;
    if ((m = t.match(/^(\d+):([0-5]?\d)$/))) return (+m[1] * 60 + +m[2]) * MIN;
    if ((m = t.match(/^(\d+(?:[.,]\d+)?)h?$/))) return Math.round(parseFloat(m[1].replace(',', '.')) * 60) * MIN;
    if ((m = t.match(/^(\d+)m(?:in)?$/))) return +m[1] * MIN;
    if ((m = t.match(/^(\d+)h(\d+)m?(?:in)?$/))) return (+m[1] * 60 + +m[2]) * MIN;
    return null;
  }

  // ---------- Fechas (hora local) ----------

  const pad = (n) => String(n).padStart(2, '0');
  const isoDia = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const isoHora = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

  // "2026-10-09" + "08:30" → ms; hora vacía = 00:00.
  function aMs(dia, hora) {
    const [y, mo, d] = String(dia).split('-').map(Number);
    const [h, mi] = String(hora || '0:0').split(':').map(Number);
    const r = new Date(y, mo - 1, d, h || 0, mi || 0).getTime();
    return Number.isFinite(r) ? r : null;
  }

  function inicioDia(ms) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function sumarDias(ms, n) {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
  }

  // Periodo que contiene `ms`, desplazado `salto` periodos. Semana de lunes a domingo.
  // Devuelve { desde, hasta } con hasta exclusivo.
  function periodo(tipo, ms, salto = 0) {
    const d = new Date(ms);
    const y = d.getFullYear(), mo = d.getMonth();
    switch (tipo) {
      case 'dia': {
        const desde = sumarDias(inicioDia(ms), salto);
        return { desde, hasta: sumarDias(desde, 1) };
      }
      case 'semana': {
        const lunes = sumarDias(inicioDia(ms), -((d.getDay() + 6) % 7) + 7 * salto);
        return { desde: lunes, hasta: sumarDias(lunes, 7) };
      }
      case 'mes':
        return { desde: new Date(y, mo + salto, 1).getTime(), hasta: new Date(y, mo + salto + 1, 1).getTime() };
      case 'anio':
        return { desde: new Date(y + salto, 0, 1).getTime(), hasta: new Date(y + salto + 1, 0, 1).getTime() };
      case 'todo':
        return { desde: -Infinity, hasta: Infinity };
      default:
        throw new Error(`Periodo desconocido: ${tipo}`);
    }
  }

  // ---------- Registros ----------

  // Registros cerrados más el cronómetro en marcha (con fin = ahora).
  function registrosConActivo(estado, ahora) {
    const lista = estado.registros.slice();
    if (estado.activo) {
      lista.push({ id: 'activo', proyectoId: estado.activo.proyectoId, inicio: estado.activo.inicio,
        fin: Math.max(ahora, estado.activo.inicio), nota: estado.activo.nota || '', activo: true });
    }
    return lista;
  }

  function solape(r, desde, hasta) {
    return Math.max(0, Math.min(r.fin, hasta) - Math.max(r.inicio, desde));
  }

  // { [proyectoId]: ms } y total dentro de [desde, hasta).
  function totales(estado, desde, hasta, ahora) {
    const porProyecto = {};
    let total = 0;
    for (const r of registrosConActivo(estado, ahora)) {
      const t = solape(r, desde, hasta);
      if (!t) continue;
      porProyecto[r.proyectoId] = (porProyecto[r.proyectoId] || 0) + t;
      total += t;
    }
    return { porProyecto, total };
  }

  // Totales por día natural: [{ dia: ms inicio del día, total, porProyecto }].
  function totalesPorDia(estado, desde, hasta, ahora) {
    const dias = [];
    for (let d = desde; d < hasta; d = sumarDias(d, 1)) {
      const t = totales(estado, d, sumarDias(d, 1), ahora);
      dias.push({ dia: d, total: t.total, porProyecto: t.porProyecto });
    }
    return dias;
  }

  // Registros que tocan el periodo, más recientes primero.
  function registrosEnPeriodo(estado, desde, hasta, ahora, proyectoId) {
    return registrosConActivo(estado, ahora)
      .filter((r) => r.fin > desde && r.inicio < hasta && (!proyectoId || r.proyectoId === proyectoId))
      .sort((a, b) => b.inicio - a.inicio);
  }

  // ---------- Operaciones (devuelven un estado nuevo, no mutan) ----------

  function crearProyecto(estado, datos) {
    const nombre = String(datos.nombre || '').trim();
    if (!nombre) throw new Error('El proyecto necesita un nombre');
    if (estado.proyectos.some((p) => p.nombre.toLowerCase() === nombre.toLowerCase())) {
      throw new Error(`Ya existe un proyecto llamado «${nombre}»`);
    }
    const p = {
      id: nuevoId(), nombre, cliente: String(datos.cliente || '').trim(),
      color: datos.color || COLORES[estado.proyectos.length % COLORES.length],
      tarifa: Number(datos.tarifa) > 0 ? Number(datos.tarifa) : 0, archivado: false,
    };
    return { estado: { ...estado, proyectos: [...estado.proyectos, p] }, proyecto: p };
  }

  function editarProyecto(estado, id, cambios) {
    const c = { ...cambios };
    if ('nombre' in c) {
      c.nombre = String(c.nombre).trim();
      if (!c.nombre) throw new Error('El proyecto necesita un nombre');
      if (estado.proyectos.some((p) => p.id !== id && p.nombre.toLowerCase() === c.nombre.toLowerCase())) {
        throw new Error(`Ya existe un proyecto llamado «${c.nombre}»`);
      }
    }
    if ('tarifa' in c) c.tarifa = Number(c.tarifa) > 0 ? Number(c.tarifa) : 0;
    return { ...estado, proyectos: estado.proyectos.map((p) => (p.id === id ? { ...p, ...c } : p)) };
  }

  // Borra el proyecto y todas sus horas.
  function borrarProyecto(estado, id) {
    return {
      ...estado,
      proyectos: estado.proyectos.filter((p) => p.id !== id),
      registros: estado.registros.filter((r) => r.proyectoId !== id),
      activo: estado.activo && estado.activo.proyectoId === id ? null : estado.activo,
    };
  }

  // Para el cronómetro (si lo hay) y guarda su registro. Menos de 1 minuto se descarta.
  function parar(estado, ahora) {
    if (!estado.activo) return estado;
    const a = estado.activo;
    const fin = Math.max(ahora, a.inicio);
    const registros = fin - a.inicio >= MIN
      ? [...estado.registros, { id: nuevoId(), proyectoId: a.proyectoId, inicio: a.inicio, fin, nota: a.nota || '' }]
      : estado.registros;
    return { ...estado, registros, activo: null };
  }

  // Arranca el cronómetro en un proyecto; si había otro en marcha lo cierra primero.
  function iniciar(estado, proyectoId, ahora, nota) {
    if (!estado.proyectos.some((p) => p.id === proyectoId)) throw new Error('Proyecto inexistente');
    const s = parar(estado, ahora);
    return { ...s, activo: { proyectoId, inicio: ahora, nota: nota || '' } };
  }

  function validarRegistro(estado, r) {
    if (!estado.proyectos.some((p) => p.id === r.proyectoId)) throw new Error('Elige un proyecto');
    if (!Number.isFinite(r.inicio) || !Number.isFinite(r.fin)) throw new Error('Fecha u hora no válida');
    if (r.fin <= r.inicio) throw new Error('El fin debe ser posterior al inicio');
    if (r.fin - r.inicio > 7 * 24 * HORA) throw new Error('Un registro no puede durar más de una semana');
  }

  function agregarRegistro(estado, datos) {
    const r = { id: nuevoId(), proyectoId: datos.proyectoId, inicio: datos.inicio, fin: datos.fin, nota: String(datos.nota || '').trim() };
    validarRegistro(estado, r);
    return { ...estado, registros: [...estado.registros, r] };
  }

  function editarRegistro(estado, id, cambios) {
    const actual = estado.registros.find((r) => r.id === id);
    if (!actual) throw new Error('Registro inexistente');
    const r = { ...actual, ...cambios, nota: String((cambios.nota ?? actual.nota) || '').trim() };
    validarRegistro(estado, r);
    return { ...estado, registros: estado.registros.map((x) => (x.id === id ? r : x)) };
  }

  function borrarRegistro(estado, id) {
    return { ...estado, registros: estado.registros.filter((r) => r.id !== id) };
  }

  // ---------- Importar / exportar ----------

  // Comprueba y limpia un estado cargado de JSON (copia de seguridad o localStorage).
  function normalizarEstado(obj) {
    if (!obj || typeof obj !== 'object' || !Array.isArray(obj.proyectos) || !Array.isArray(obj.registros)) {
      throw new Error('El archivo no es una copia de seguridad del contador de horas');
    }
    const proyectos = obj.proyectos
      .filter((p) => p && p.id && String(p.nombre || '').trim())
      .map((p, i) => ({
        id: String(p.id), nombre: String(p.nombre).trim(), cliente: String(p.cliente || '').trim(),
        color: /^#[0-9a-f]{6}$/i.test(p.color) ? p.color : COLORES[i % COLORES.length],
        tarifa: Number(p.tarifa) > 0 ? Number(p.tarifa) : 0, archivado: !!p.archivado,
      }));
    const ids = new Set(proyectos.map((p) => p.id));
    const registros = obj.registros
      .filter((r) => r && ids.has(String(r.proyectoId)) && Number.isFinite(+r.inicio) && Number.isFinite(+r.fin) && +r.fin > +r.inicio)
      .map((r) => ({ id: String(r.id || nuevoId()), proyectoId: String(r.proyectoId), inicio: +r.inicio, fin: +r.fin, nota: String(r.nota || '') }));
    const a = obj.activo;
    const activo = a && ids.has(String(a.proyectoId)) && Number.isFinite(+a.inicio)
      ? { proyectoId: String(a.proyectoId), inicio: +a.inicio, nota: String(a.nota || '') }
      : null;
    return { version: VERSION, proyectos, registros, activo };
  }

  // CSV con separador ";" y coma decimal (se abre directamente en Excel en español).
  function aCSV(estado, desde, hasta, ahora) {
    const nombre = Object.fromEntries(estado.proyectos.map((p) => [p.id, p]));
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const filas = [['Fecha', 'Proyecto', 'Cliente', 'Inicio', 'Fin', 'Horas', 'Duración', 'Nota']];
    const lista = registrosEnPeriodo(estado, desde, hasta, ahora).sort((a, b) => a.inicio - b.inicio);
    for (const r of lista) {
      const p = nombre[r.proyectoId] || { nombre: '?', cliente: '' };
      const ini = new Date(r.inicio), fin = new Date(r.fin);
      const dur = r.fin - r.inicio;
      filas.push([isoDia(ini), p.nombre, p.cliente, isoHora(ini), isoHora(fin), horasDecimales(dur), formatDuracion(dur), r.nota]);
    }
    return '﻿' + filas.map((f) => f.map(q).join(';')).join('\r\n') + '\r\n';
  }

  return {
    VERSION, MIN, HORA, COLORES,
    estadoVacio, nuevoId, formatDuracion, horasDecimales, parseDuracion,
    isoDia, isoHora, aMs, inicioDia, sumarDias, periodo,
    registrosConActivo, totales, totalesPorDia, registrosEnPeriodo,
    crearProyecto, editarProyecto, borrarProyecto, iniciar, parar,
    agregarRegistro, editarRegistro, borrarRegistro, normalizarEstado, aCSV,
  };
});
