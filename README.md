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
3. A partir de ahí **el archivo sigue al editor**: cada cambio se escribe en el
   disco solo, unos cientos de milisegundos después de que pares de tocarlo.

Abrir carpetas necesita la File System Access API: **Chrome, Edge, Opera o
Brave**. En Firefox y Safari el botón carga los archivos en solo lectura y
*Guardar* pasa a descargar el JSON.

### Trabajar sobre el disco

La pastilla que hay junto a *Guardar* dice en todo momento a dónde va lo que
haces:

| | |
|---|---|
| `↳ escenas/nivel.json` | cada cambio acaba ahí |
| `guardando …` | hay una escritura en camino |
| `sin archivo · pulsa Guardar` | hay carpeta pero la escena todavía no tiene archivo |
| `solo en el navegador` | no hay carpeta con permiso de escritura |

El editor **no inventa archivos**: solo escribe sobre uno que hayas abierto de
la carpeta o creado con *Guardar*. Elegir una carpeta para mirarla no es
permiso para llenarla de JSON, así que la primera vez hay que decirle el nombre;
de ahí en adelante no vuelves a pulsar nada.

Y en la otra dirección: **las imágenes que cambian en el disco se recargan
solas**. Repintas un sprite en Aseprite, guardas, y a los pocos segundos está en
el lienzo sin tocar nada. El editor vigila solo las imágenes que tiene cargadas,
y por tandas, así que una carpeta con dos mil sprites cuesta lo mismo que una
con veinte. Para archivos *nuevos* en la carpeta sigue estando *recargar*.

La casilla **auto** lo desactiva si prefieres guardar tú, con <kbd>Ctrl</kbd>+<kbd>S</kbd>.
Si una escritura falla —permiso caducado, carpeta desmontada— el autoguardado
se detiene y lo dice, en vez de reintentar en bucle contra un disco que ya no
está; vuelves a marcar la casilla y sigue.

Con todo esto, la escena se autoguarda **además** en el navegador (IndexedDB) en
cada cambio. Si cierras la pestaña sin querer, al volver está donde la dejaste;
solo tendrás que volver a dar permiso sobre la carpeta, que es algo que el
navegador no deja automatizar.

También puedes **arrastrar** una carpeta o unos archivos sueltos sobre la
página. Eso funciona en todos los navegadores, pero es solo lectura. Soltar
archivos **añade** a lo que ya hay cargado, no lo reemplaza.

### Dónde busca las imágenes

Hay dos niveles y conviene tenerlos claros:

```
carpeta que abres/          ← la raíz de todo
  sprites/x1/               ← "raíz de assets" (sprite_root), en las propiedades de la escena
    pokemon/torchic.png     ← "sprite", lo que lleva cada capa y cada actor
```

La ruta final es `sprite_root + sprite`, siempre relativa a la carpeta que
abriste. Así una escena se puede mover entera cambiando un solo campo.

Cuando no cuadran —porque abriste la carpeta un nivel más arriba, o el JSON
viene de otro sitio— el editor **no** te hace repicar veinte imágenes: te dice
cuántas no encuentra y con *Reparar rutas* las busca por nombre entre lo
cargado. Si a todas les falta la misma carpeta, que es lo normal, ajusta
`sprite_root` y ya está; si están desperdigadas, arregla cada una. Lo intenta
solo al abrir una escena o una carpeta.

Y cuando quieras llevarte la escena a otro sitio, *Exportar → Empaquetar*
te da un zip con el JSON y **solo las imágenes que usa**, bajo `assets/`.

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
múltiplo de `tile_period`. El panel de la capa lo dice, y la barra de estado
avisa **sin tener que seleccionarla**, con el tamaño exacto del salto: una capa
que se queda a media baldosa es invisible en un fotograma suelto y evidentísima
en cuanto reproduces.

Esto acota bastante las velocidades posibles. Si el mosaico mide 256 px y el
bucle 256 fotogramas, la velocidad tiene que ser entera, y la capa más lenta
recorre una baldosa entera por bucle. Para que el fondo vaya *despacio*, o el
bucle dura más segundos, o esa capa se dibuja más estrecha.

### No hace falta que hagas la cuenta

Saber que algo no cierra no sirve de nada si no sabes qué poner, y la regla
tiene solución exacta, así que el editor la resuelve por ti. Cuando una capa no
cierra, su panel dice de cuánto en cuánto va la velocidad —`periodo ÷
fotogramas`, es decir, una baldosa por bucle— y te da **las dos que sí valen**,
la de debajo y la de encima, con un botón cada una:

```
recorre 384 px en el bucle sobre un periodo de 256 px · no cierra: saltará 128 px
en 256 fotogramas la capa tiene que recorrer un número entero de baldosas de
256 px, así que la velocidad va de 1 en 1:
     [ velocidad 1 · 1 baldosa ]  [ velocidad 2 · 2 baldosas ]
o, dejando todas las velocidades como están, alargar el bucle:
     [ bucle de 512 fotogramas · 21.33 s ]
```

Son dos decisiones distintas y por eso están las dos: cambiar la velocidad mueve
esa capa y deja el resto en paz; alargar el bucle **no cambia ni un px por
fotograma** —nada se mueve más deprisa— pero dura más. Desde las propiedades de
la escena, ese segundo botón arregla todo lo que no cierre de una vez.

Con los actores igual: te ofrece los retardos cuyo ciclo divide el bucle. Y
cuando el número de cels no divide el bucle *pase lo que pase* —tres cels en un
bucle de 256 no hay retardo que lo arregle— propone el orden de ida y vuelta
`0,1,2,1`, que convierte tres cels en cuatro, con el retardo que le toca.

Un bucle más largo solo se propone mientras siga siendo un bucle: el número que
encaja con todo es un mínimo común múltiplo y un valor raro lo dispara a cinco
cifras. Cuando pasa de cuatro veces el actual, el editor dice cuánto haría falta
y no te ofrece el botón.

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
- **Pasar el ratón** por una imagen del panel de assets la enseña en grande, con
  sus dimensiones: los sprites pequeños se amplían por un número entero para que
  el píxel siga siendo cuadrado.

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
- **Empaquetar** — zip con `scene.json` y las imágenes que usa la escena, bajo
  `assets/`, para llevártela a otra máquina o dársela a alguien.

*Quedarse con 1 de cada N* baja el número de fotogramas y sube la duración de
cada uno, sin tocar la escena.

## Estructura

Sin dependencias ni *bundler* en lo que se sirve: son módulos ES que el
navegador carga tal cual, que es también lo que hace que GitHub Pages pueda
publicarlo sin compilar nada. Lo único que hay en `package.json` es Playwright,
para los tests.

```
index.html · app.css
src/
  scene.js       el documento: valores por defecto, normalización, avisos
  anim.js        muestreo: easing, claves, vaivén, anclajes
  render.js      dibujado en un canvas, a resolución de mundo
  store.js       escena + historial de deshacer
  assets.js      carpeta local, arrastrar-y-soltar, manifiesto remoto
  relink.js      cuadrar las rutas de la escena con los archivos cargados
  autosave.js    escribir la escena en su archivo del disco, sola
  watch.js       enterarse de que un archivo ha cambiado por debajo
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

## Tests

```bash
node --test        # la lógica
npx playwright test   # la interfaz, en un navegador de verdad
```

Sin dependencias ni configuración: el ejecutor de Node, sobre los módulos que no
tocan el DOM, que son los que guardan la lógica en la que uno se equivoca de
verdad. El de exportación es el que más gana: el GIF se **decodifica otra vez**
con un descompresor LZW escrito aparte, así que codificador y descompresor
tienen que ponerse de acuerdo en algo externo a los dos —incluido el caso en el
que el diccionario se llena a mitad de fotograma—, y del zip se comprueban las
firmas, los desplazamientos del directorio central y un CRC-32 de valor
publicado.

Los de Playwright cubren lo otro, que es donde han salido todos los fallos de
verdad: que nada invisible tape el lienzo, que escribir en el inspector no te
robe el cursor, que arrastrar una miniatura no se confunda con soltar archivos,
que la vista previa aparezca y se vaya, que el GIF exportado empiece por
`GIF89a`, que la escena sobreviva a recargar. Cada uno nació de un fallo que
llegó a estar publicado.

El autoguardado en disco se prueba en los dos sitios: la cola en `node --test`
—un chaparrón de ediciones es *una* escritura, dos nunca se solapan, una que
llega a mitad de otra no se pierde, un fallo la detiene en vez de reintentar— y
el cableado en Playwright, con la escritura sustituida por un espía, porque el
navegador no deja abrir el selector de carpetas desde un test. El vigilante va
igual: el anillo y las tandas en Node —incluido que un sprite pillado a medio
escribir siga contando como cambiado hasta que alguien consiga leerlo— y en
Playwright un `handle` de mentira al que se le cambian los bytes por debajo.

Y la escena de ejemplo tiene los suyos, porque estuvo publicada con tres capas
que saltaban y un pájaro que volaba de espaldas: que todas las capas y todos los
ciclos cierren, que ningún actor dé un salto estando a la vista, que las capas
vayan más rápido cuanto más cerca, y que el fotograma 0 y el fotograma
`loop_frames` sean **la misma imagen píxel a píxel**, dibujada por el
renderizador de verdad.

El truco que los hace fiables es `window.editor`: la aplicación expone su propio
estado, así que un test comprueba `store.scene.actors[0].delay` en vez de
adivinar por el DOM. Y los campos del inspector llevan `data-field`, para que un
test nombre el que quiere en lugar de contar `input`s y acertar por poco.

## Licencia

MIT.
