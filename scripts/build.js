// Genera en dist/ las versiones de un único archivo autocontenido (motor + interfaz)
// que se abren con doble clic en cualquier navegador, sin instalar nada.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const cabecera = '<!doctype html>\n<html lang="es">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';

const apps = [
  { html: 'app/index.html', motor: 'src/rugosidad.js', salida: 'dist/rugosimetro.html' },
  { html: 'app/horas.html', motor: 'src/horas.js', salida: 'dist/horas.html' },
];

function empaquetar(app) {
  const html = fs.readFileSync(path.join(raiz, app.html), 'utf8');
  const motor = fs.readFileSync(path.join(raiz, app.motor), 'utf8');
  const etiqueta = `<script src="../${app.motor}"></script>`;
  if (!html.includes(etiqueta)) throw new Error(`No se encuentra la etiqueta del motor en ${app.html}`);
  return cabecera + html.replace(etiqueta, () => `<script>\n${motor}\n</script>`) + '\n</html>\n';
}

fs.mkdirSync(path.join(raiz, 'dist'), { recursive: true });
for (const app of apps) {
  fs.writeFileSync(path.join(raiz, app.salida), empaquetar(app));
  console.log(`${app.salida} generado`);
}

// Versión compartida del contador de horas: los cuatro archivos del proyecto de
// Google Apps Script, listos para copiar al editor (ver docs/horas-compartido.md).
const gas = path.join(raiz, 'dist/apps-script');
fs.mkdirSync(gas, { recursive: true });
fs.copyFileSync(path.join(raiz, 'gas/Codigo.gs'), path.join(gas, 'Codigo.gs'));
fs.copyFileSync(path.join(raiz, 'gas/appsscript.json'), path.join(gas, 'appsscript.json'));
fs.copyFileSync(path.join(raiz, 'src/horas.js'), path.join(gas, 'Horas.gs'));
fs.writeFileSync(path.join(gas, 'Index.html'), empaquetar(apps[1]));
console.log('dist/apps-script/ generado');
