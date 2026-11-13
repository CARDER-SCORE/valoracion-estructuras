# Valoración de estructuras · SCORE CARDER

App web para hacer en campo la **valoración técnica visual de edificaciones** y preparar el **concepto técnico FO-18-04 V24** de la Subdirección para el Conocimiento y Reducción del Riesgo (SCORE) de la CARDER.

Funciona en el celular como app instalable, trabaja **sin señal** y envía las valoraciones a una hoja de Google, con las fotos y el concepto en Drive.

> **Alcance.** La app prepara una valoración visual; no certifica la seguridad estructural ni la habitabilidad. La clasificación final es criterio del profesional que firma, y el concepto se firma y se radica por los canales oficiales (SAIA). El texto de alcance va siempre en el concepto.

## Qué hace (versión 2, piloto SCORE)

- **Ingreso** con correo y PIN de usuarios autorizados en la hoja.
- **Pestañas Visitas, Mapa y Tablero**, y botones **Sincronizar**, **Envíos** y **Mi perfil** en la barra superior. Tema claro.
- **Proyecta → revisa y suscribe**: quien visita diligencia y envía a revisión; el revisor la abre completa (con fotos), puede corregirla, y la **aprueba y suscribe** o la **devuelve con observaciones**. Mientras no esté aprobada, el Word sale marcado como borrador.
- **Solicitudes asignadas**: la coordinación las asigna en la hoja; al abrirlas se llenan los datos. Al enviar la valoración, la solicitud queda «Atendida».
- **Mapa** (Leaflet, incluido en `lib/`): valoraciones por color de habitabilidad, filtros, calles o satélite (Esri, Sentinel-2 de EOX) y capas oficiales del SGC (amenaza por movimientos en masa 1:100.000, amenaza sísmica, geología), con consulta del valor en un punto. Las capas se configuran en `config.js`.
- **Tablero**: totales por habitabilidad, estado de revisión, municipio, quien proyectó, sistema estructural y uso.
- **Ficha por pasos** con los campos del formulario regional de evaluación rápida de daños (CDGRD): solicitud, sitio y visita, edificación, daños (N/L, M, S), clasificación sugerida (el peor indicador manda), análisis, recomendaciones y firmas.
- **GPS** con conversión a Magna Sirgas Origen Nacional (EPSG:9377) y **aviso de cercanía** si ya hay una valoración a menos de 10 m.
- **Fotos** desde la cámara, reducidas a 1200 px, con las coordenadas del último punto.
- **Concepto FO-18-04**: vista previa, Word (.doc), PDF (impresión) y texto. Firma quien suscribe; debajo, «Proyectó».
- **Sin señal**: todo se guarda en el dispositivo y se envía solo cuando vuelve la conexión.
- **Datos personales** (Ley 1581 de 2012): los del peticionario solo se guardan en la hoja institucional y no salen en ninguna lista.

## Cómo está hecha

| Pieza | Archivo |
|---|---|
| Configuración (lo único que se edita al instalar) | `config.js` |
| Ficha: listas, textos tipo, campos de lista y personales | `ficha-estructuras.js` |
| Concepto FO-18-04 (HTML, Word, texto) | `concepto.js` |
| Lógica de la app | `app.js`, `index.html`, `styles.css` |
| Mapa (Leaflet 1.9.4, licencia BSD-2) | `lib/leaflet/` |
| Sin señal (PWA) | `sw.js`, `manifest.json` |
| Servidor (Apps Script de la hoja) | `apps-script/Code.gs`, `apps-script/appsscript.json` |
| Pruebas | `pruebas/` |

Sin dependencias externas en tiempo de ejecución salvo los mosaicos de mapas. La página es pública (GitHub Pages); la seguridad está en el servidor, que valida el token de sesión en cada llamada.

## Instalación

Ver **[docs/INSTALACION.md](docs/INSTALACION.md)**. Sin `APPS_SCRIPT_URL` en `config.js`, la app funciona en **modo local** (sin ingreso; todo queda en el navegador).

## Pruebas

```bash
node pruebas/servidor.test.js   # servidor con un Apps Script simulado
node pruebas/app.test.js        # flujo completo en Chromium (requiere Playwright)
node pruebas/app2.test.js       # modo local, servidor caído, edición y recarga sin señal
```
