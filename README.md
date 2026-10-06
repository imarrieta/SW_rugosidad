# Rugosímetro Virtual

Software para **predecir la rugosidad superficial (Ra, Rz, Rt) en fresado** a partir de las cotas de la herramienta y las condiciones de corte.

## Uso rápido

Abre `dist/rugosimetro.html` con doble clic en cualquier navegador (Chrome, Edge, Firefox). Es un único archivo: no hace falta instalar nada ni tener conexión.

## Entradas

**Herramienta** (mismas cotas que la ficha de catálogo):

| Nº Filos | D1 | D2 | D3 | L1 | L2 | L3 | Ch/R |
|---|---|---|---|---|---|---|---|
| filos z | Ø corte | Ø mango | Ø cuello | longitud total | longitud de corte | longitud útil / cuello | chaflán o radio |

- Tipo de punta: **AV** (arista viva), **Ch** (chaflán 45°), **R** (radio de punta / tórica), **esférica** (R = D1/2).
- Avanzado: ángulo de hélice, ángulo de dish del filo frontal, excentricidad radial y axial (runout), radio de filo rβ, material (metal duro / HSS).
- Biblioteca de herramientas guardada en el navegador, con exportación/importación JSON.

**Corte**: material de la pieza, Vc, fz, ap, ae (profundidad radial y paso lateral entre pasadas), voladizo, concordancia/oposición y Ra objetivo.

## Salidas

- Ra, Rz, Rt y clase ISO 1302 (N1–N12) de la **pared** (fresado periférico) y del **suelo** (en avance y transversal).
- n, Vf, diámetro efectivo, caudal de viruta, fuerza, par, potencia, rigidez y flexión de la herramienta (error de forma en pared).
- Perfil de rugosidad simulado, curva Ra–fz y **fz máximo para cumplir el Ra objetivo**.
- Avisos: ap > L2, cuello que roza, voladizo excesivo, filo recrecido, espesor de viruta menor que el mínimo, etc.
- **Calibración**: con 3–5 mediciones reales se ajusta un factor por mínimos cuadrados.

## Modelo

1. **Perfil cinemático** simulado como envolvente de las huellas de cada filo, incluyendo runout:
   - Pared: arcos de radio efectivo de Martellotti `R ± f·z/π` (+ oposición, − concordancia).
   - Suelo en avance: geometría real de la punta (AV con dish → `fz·tan κ'`; chaflán → `fz/(cot κ + cot κ')`; radio → `≈ fz²/8R`).
   - Suelo transversal: cresta entre pasadas, `R − √(R² − (ae/2)²)` en esférica.
2. **Espesor mínimo de viruta** (Brammertz) con `h_min = λ·rβ` según material.
3. **Factor dinámico** empírico (filo recrecido, voladizo/D1 > 3) y factor de calibración del usuario.
4. **Fuerzas** de Kienzle con simulación angular y hélice; **flexión** como viga escalonada (zona de corte 0,8·D1 hasta L2, cuello D3 hasta L3, mango D2 hasta el voladizo).

Es una estimación de ingeniería: sin calibrar, espera ±30–50 % frente a la medida real.

## Estructura

```
src/rugosidad.js       motor de cálculo (navegador y Node)
app/index.html         interfaz (carga el motor desde src/)
dist/rugosimetro.html  versión de un solo archivo (generada)
test/                  tests del motor contra fórmulas analíticas
scripts/build.js       genera dist/
```

## Desarrollo

Requiere Node 18+ (sin dependencias).

```bash
npm test        # tests del motor
npm run build   # regenera dist/rugosimetro.html
```
