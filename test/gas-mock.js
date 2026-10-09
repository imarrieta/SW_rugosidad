// Simulación mínima de los servicios de Google Apps Script que usa gas/Codigo.gs
// (hoja de cálculo en memoria, usuario conmutable). Sirve en Node y en el navegador.
(function (root) {
  'use strict';

  function crearEntornoGAS(opciones) {
    const op = Object.assign({ propietario: 'propietario@empresa.com' }, opciones);
    const sesion = { usuario: op.propietario };
    const hojas = {};

    // Como Sheets: una comilla inicial fuerza texto y no se guarda; "=..." sería fórmula.
    const guardar = (x) => {
      if (typeof x !== 'string') return x;
      if (x.startsWith("'")) return x.slice(1);
      if (x.startsWith('=')) return { formula: x };
      return x;
    };

    function Hoja(nombre) {
      const data = [];
      const ultimaFila = () => {
        for (let i = data.length - 1; i >= 0; i--) if (data[i].some((v) => v !== '' && v != null)) return i + 1;
        return 0;
      };
      const celda = (r, c) => {
        while (data.length < r) data.push([]);
        const fila = data[r - 1];
        while (fila.length < c) fila.push('');
        return fila;
      };
      function Rango(r, c, nr, nc) {
        return {
          getValues() {
            const out = [];
            for (let i = 0; i < nr; i++) {
              const fila = [];
              for (let j = 0; j < nc; j++) {
                const v = (data[r - 1 + i] || [])[c - 1 + j];
                fila.push(v === undefined ? '' : v instanceof Date ? new Date(v.getTime()) : v);
              }
              out.push(fila);
            }
            return out;
          },
          getValue() { return this.getValues()[0][0]; },
          setValues(v) {
            if (v.length !== nr || v.some((f) => f.length !== nc)) throw new Error('Dimensiones incorrectas en setValues');
            v.forEach((f, i) => f.forEach((x, j) => { celda(r + i, c + j)[c - 1 + j] = guardar(x); }));
          },
          setValue(x) { celda(r, c)[c - 1] = guardar(x); },
          clearContent() { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) celda(r + i, c + j)[c - 1 + j] = ''; },
        };
      }
      return {
        nombre, data,
        getRange(r, c, nr = 1, nc = 1) {
          if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error('Rango no válido');
          return Rango(r, c, nr, nc);
        },
        getLastRow: ultimaFila,
        setFrozenRows() {},
        deleteRow(r) { data.splice(r - 1, 1); },
      };
    }

    const libro = {
      getId: () => 'hoja-prueba',
      getUrl: () => 'https://docs.google.com/spreadsheets/d/hoja-prueba',
      getSheetByName: (n) => hojas[n] || null,
      insertSheet: (n) => (hojas[n] = Hoja(n)),
    };
    const props = {};

    return {
      sesion, hojas,
      globals: {
        SpreadsheetApp: { getActiveSpreadsheet: () => libro, openById: () => libro },
        PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
        Session: {
          getActiveUser: () => ({ getEmail: () => sesion.usuario }),
          getEffectiveUser: () => ({ getEmail: () => op.propietario }),
        },
        LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
        HtmlService: {
          createHtmlOutputFromFile: () => {
            const o = { setTitle: () => o, addMetaTag: () => o };
            return o;
          },
        },
      },
    };
  }

  if (typeof module === 'object' && module.exports) module.exports = { crearEntornoGAS };
  else root.crearEntornoGAS = crearEntornoGAS;
})(typeof self !== 'undefined' ? self : this);
