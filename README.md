# Parallax Scene Editor

Editor de escenas de *pixel art* con parallax que cierran en bucle. Se abre en
el navegador, lee una carpeta **de tu disco** con tus propios sprites y exporta
GIF, WebM o una secuencia de PNG. No hay servidor, no hay compilación y no se
sube nada a ninguna parte.

**→ [Abrir el editor](https://christt105.github.io/parallax-scene-editor/)**

> *A browser editor for looping parallax pixel-art scenes. Open a local folder,
> arrange layers and animated sprites over a timeline, export GIF / WebM / PNG.
> Everything runs client-side; nothing is uploaded. The interface is in Spanish.*

![demo](demo/assets/layers/ground.png)

## Qué resuelve

Un fondo con parallax es fácil de dibujar y molesto de montar: cada capa va a
su velocidad, los sprites tienen su propio ciclo de fotogramas, y para que el
bucle no dé un salto todo tiene que encajar en el mismo número de fotogramas.
Los editores de sprites no interpolan posiciones y los de vídeo no entienden de
píxeles enteros.

Aquí la escena es **un archivo JSON**: cámara, capas, actores, posiciones clave.
Lo editas viéndolo reproducirse en bucle y el editor te avisa en rojo cuando
algo no va a cerrar.

## Empezar

Al abrir la página se carga una escena de ejemplo. Para trabajar con lo tuyo:

1. **Abrir carpeta…** y eliges la carpeta de tu proyecto. El editor lee todas
   las imágenes que hay dentro, a cualquier profundidad.
2. Si en la carpeta hay archivos `.json`, te ofrece abrirlos como escena.
3. **Guardar** escribe el JSON dentro de esa misma carpeta, en el disco.

Abrir carpetas necesita la File System Access API: **Chrome, Edge, Opera o
Brave**. En Firefox y Safari el botón carga los archivos en solo lectura y
*Guardar* pasa a descargar el JSON.

Pases lo que pases, la escena se autoguarda en el navegador (IndexedDB) en cada
cambio. Si cierras la pestaña sin querer, al volver está donde la dejaste; solo
tendrás que volver a dar permiso sobre la carpeta, que es algo que el navegador
no deja automatizar.

También puedes **arrastrar** una carpeta o unos archivos sueltos sobre la
página. Eso funciona en todos los navegadores, pero es solo lectura.

## La escena

```jsonc
{
  "canvas": [640, 360],      // tamaño de salida en píxeles
  "zoom": 2,                 // aumento entero, nearest-neighbour
  "world_height": 160,       // alto del mundo; el resto es aire por arriba
  "align": "bottom",         // dónde se ancla el mundo dentro de la vista
  "loop_frames": 128,
  "fps": 60,
  "backdrop": "#568cc4",
  "sprite_root": "assets",   // prefijo de todas las rutas
  "layers": [ … ],
  "actors": [ … ]
}
```

La vista mide `canvas / zoom` píxeles. El mundo se ancla abajo por defecto, así
que **alejar la cámara añade cielo por arriba** y todo lo que pisa el suelo se
queda donde estaba.

### Capas

```jsonc
{
  "name": "suelo",
  "sprite": "layers/ground.png",
  "y": 122,
  "depth": -110,
  "speed": 4,                // px por fotograma; positivo desplaza a la izquierda
  "speed_y": 0,
  "tile_period": 256,        // 0 = el ancho de la imagen
  "repeat": "x",             // "x" | "none"
  "extend_up": false,        // repetir la fila superior hacia arriba
  "extend_down": true,       // …y la inferior hacia abajo
  "opacity": 1
}
```

`extend_up` y `extend_down` existen porque casi ninguna capa está dibujada para
el hueco que queda al alejar la cámara: repetir la fila del borde es más barato
que dibujar cielo o tierra que nadie va a mirar.

Una capa con `depth` alto se dibuja **delante** de los actores: es como se hace
la hierba en primer plano.

Para que el bucle cierre sin costura, `speed × loop_frames` tiene que ser
múltiplo de `tile_period`. El panel te dice si se cumple.

### Actores

```jsonc
{
  "name": "corredor",
  "sprite": "sprites/walker.png",
  "frames": 4,               // cels de la tira horizontal
  "grid": null,              // [columnas, filas] si la hoja es una rejilla
  "order": [0, 1, 2, 1],     // reordena los cels
  "delay": 4,                // fotogramas por cel
  "offset": 0,               // desplaza el ciclo dentro del bucle
  "anchor": "bottom-center", // los 9 anclajes habituales
  "depth": 20,
  "scale": 1,
  "flip_x": false,
  "x": 96, "y": 150,         // o "keys", nunca las dos cosas
  "keys": [
    { "f": 0,  "x": 330, "y": 44, "ease": "in-out" },
    { "f": 64, "x": 60,  "y": 30, "ease": "in-out" }
  ],
  "motion": [
    { "type": "sine", "axis": "y", "amp": 3, "period": 32 }
  ]
}
```

- **`keys`** son posiciones clave. Se interpola entre ellas con `ease` `linear`,
  `in`, `out` o `in-out`, y **el último tramo vuelve solo a la primera clave**,
  así que el bucle no tiene costura.
- **`motion`** se suma encima de la posición: `sine`, `cosine` o `wobble` (un
  temblor de N píxeles, el sustituto periódico del ruido aleatorio de un juego).
  Puedes apilar varios.
- **`order`** arregla los ciclos que no dividen el bucle: un ida y vuelta
  `[0,1,2,1]` convierte un ciclo de 3 en uno de 4.

Si el ciclo de un actor (`fotogramas × delay`) no divide `loop_frames`, el
sprite pega un salto al reiniciar. El editor lo dice, con el número exacto.

## Cómo se usa

- **Arrastrar en el lienzo** coloca el actor. Si tiene posiciones clave, mueves
  la clave seleccionada (o la más cercana al fotograma en el que estés). Con
  <kbd>Mayús</kbd> se ajusta a 8 px.
- **La línea de tiempo** tiene una fila por actor con sus claves como rombos.
  Doble clic crea una clave ahí, arrastrar un rombo la mueve de fotograma. Las
  rayitas grises marcan dónde reinicia el ciclo de cels.
- **El camino de las claves** se dibuja sobre el lienzo, para ver la
  trayectoria completa sin darle al play.
- **Papel cebolla** superpone los actores de los fotogramas vecinos.

| Atajo | |
|---|---|
| <kbd>Espacio</kbd> | reproducir / pausa |
| <kbd>←</kbd> <kbd>→</kbd> | fotograma anterior / siguiente (<kbd>Mayús</kbd>: de 10 en 10) |
| <kbd>Alt</kbd> + flechas | mover el actor 1 px (<kbd>Mayús</kbd>: 8 px) |
| <kbd>K</kbd> | clave en el fotograma actual |
| <kbd>Supr</kbd> | borrar la clave |
| <kbd>D</kbd> | duplicar |
| <kbd>G</kbd> / <kbd>O</kbd> | rejilla / papel cebolla |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> | deshacer (con <kbd>Mayús</kbd>, rehacer) |
| <kbd>Ctrl</kbd>+<kbd>S</kbd> | guardar |

## Exportar

- **GIF** — se construye aquí, sin librerías. Primero recorre la animación
  contando colores: si toda la escena cabe en 256 (lo normal en pixel art) la
  paleta es **exacta**, sin *dithering* ni desvíos de color. Si no cabe, cae a
  *median cut*. Cada fotograma se comprime nada más dibujarse, así que exportar
  un bucle largo cuesta megabytes, no cientos.
- **WebM** — vídeo sin límite de colores, vía `MediaRecorder`. Se graba en
  tiempo real: tarda lo que dura el bucle.
- **PNG (zip)** — un archivo por fotograma, para montarlo con ffmpeg o abrirlo
  en Aseprite.
- **Fotograma actual** — un PNG suelto.

*Quedarse con 1 de cada N* baja el número de fotogramas y sube la duración de
cada uno, sin tocar la escena.

## Estructura

Sin dependencias, sin *bundler*: son módulos ES que el navegador carga tal cual,
que es también lo que hace que GitHub Pages pueda servirlo sin más.

```
index.html · app.css
src/
  scene.js       el documento: valores por defecto, normalización, avisos
  anim.js        muestreo: easing, claves, vaivén, anclajes
  render.js      dibujado en un canvas, a resolución de mundo
  store.js       escena + historial de deshacer
  assets.js      carpeta local, arrastrar-y-soltar, manifiesto remoto
  storage.js     autoguardado en IndexedDB
  main.js        el pegamento
  ui/            dom, stage, timeline, inspector
  export/        gif (codificador propio), zip, orquestador
demo/            escena y arte de ejemplo, generados por tools/
```

`anim.js` y `render.js` no tocan el DOM salvo por el canvas: son las mismas
fórmulas que puede reimplementar un renderizador offline para sacar el mismo
fotograma píxel a píxel.

El arte de la demo lo dibuja `tools/make_demo_assets.py` (Pillow, determinista).
No hay nada de terceros en el repositorio.

## Local

```bash
python3 -m http.server 8000
```

y abre `http://127.0.0.1:8000/`. Cualquier servidor estático vale; hace falta
uno porque los módulos ES no se cargan desde `file://`.

## Licencia

MIT.
