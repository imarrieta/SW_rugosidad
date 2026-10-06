// Genera dist/rugosimetro.html: un único archivo autocontenido (motor + interfaz)
// que se abre con doble clic en cualquier navegador, sin instalar nada.
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(raiz, 'app/index.html'), 'utf8');
const motor = fs.readFileSync(path.join(raiz, 'src/rugosidad.js'), 'utf8');
const etiqueta = '<script src="../src/rugosidad.js"></script>';
if (!html.includes(etiqueta)) throw new Error('No se encuentra la etiqueta del motor en app/index.html');

const cuerpo = html.replace(etiqueta, () => `<script>\n${motor}\n</script>`);
const cabecera = '<!doctype html>\n<html lang="es">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n';

fs.mkdirSync(path.join(raiz, 'dist'), { recursive: true });
fs.writeFileSync(path.join(raiz, 'dist/rugosimetro.html'), cabecera + cuerpo + '\n</html>\n');
console.log('dist/rugosimetro.html generado');
