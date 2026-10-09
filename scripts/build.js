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

fs.mkdirSync(path.join(raiz, 'dist'), { recursive: true });
for (const app of apps) {
  const html = fs.readFileSync(path.join(raiz, app.html), 'utf8');
  const motor = fs.readFileSync(path.join(raiz, app.motor), 'utf8');
  const etiqueta = `<script src="../${app.motor}"></script>`;
  if (!html.includes(etiqueta)) throw new Error(`No se encuentra la etiqueta del motor en ${app.html}`);
  const cuerpo = html.replace(etiqueta, () => `<script>\n${motor}\n</script>`);
  fs.writeFileSync(path.join(raiz, app.salida), cabecera + cuerpo + '\n</html>\n');
  console.log(`${app.salida} generado`);
}
