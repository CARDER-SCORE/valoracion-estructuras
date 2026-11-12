# Instalación de la app de valoración de estructuras

Toma unos 30 minutos. Se hace una sola vez, con la **cuenta de Google institucional** que será dueña de los datos (no con una cuenta personal).

Al terminar se tiene:
- una hoja de Google con las pestañas Usuarios, Solicitudes, Conceptos, Fotos y Bitacora;
- una carpeta de Drive con las fotos y los conceptos, por municipio;
- la app publicada en `https://carder-score.github.io/valoracion-estructuras/`.

---

## 1. Crear la hoja y pegar el servidor

1. Con la cuenta institucional, cree una hoja de cálculo nueva en Google Drive. Nómbrela **Valoración de estructuras - base**.
2. En la hoja, abra **Extensiones → Apps Script**.
3. Borre lo que trae el editor y pegue todo el contenido de [`apps-script/Code.gs`](../apps-script/Code.gs).
4. En el editor, abra **Configuración del proyecto** (ícono de engranaje) y marque **Mostrar el archivo de manifiesto "appsscript.json"**. Vuelva al editor, abra `appsscript.json` y reemplácelo con el contenido de [`apps-script/appsscript.json`](../apps-script/appsscript.json).
5. Guarde (Ctrl + S).

## 2. Configurar las pestañas y la carpeta

1. Vuelva a la hoja y recárguela. Aparece el menú **Valoración estructuras**.
2. Abra **Valoración estructuras → 1. Configurar hojas y carpeta**.
3. Google pide autorización. Elija la cuenta institucional. Si sale «Google no verificó esta app», pulse **Configuración avanzada → Ir a … (no seguro)**: es su propio script.
4. Al final, un mensaje muestra el enlace de la carpeta de Drive creada (*Valoración de estructuras - archivos*).

## 3. Agregar usuarios y entregar los PIN

1. En la pestaña **Usuarios**, agregue una fila por persona:

| correo | nombre | rol | activo | profesion | cargo | matricula |
|---|---|---|---|---|---|---|
| correo institucional | Nombre completo | `evaluador`, `coordinador` o `admin` | `SI` | Ingeniero Civil | Profesional Especializado | número |

   - `evaluador`: ve sus solicitudes y edita solo sus valoraciones.
   - `coordinador` o `admin`: además puede abrir solicitudes y valoraciones de otros.
   - El nombre, la profesión, el cargo y la matrícula llenan la firma del concepto.
2. Seleccione la fila del usuario y abra **Valoración estructuras → 2. Asignar PIN al usuario de la fila seleccionada**.
3. Anote el PIN de 6 dígitos que aparece y entrégueselo a la persona **en privado**. El PIN no queda guardado en claro; si se pierde, se asigna uno nuevo.

Para quitarle el acceso a alguien: ponga `NO` en *activo*, o use **Cerrar todas las sesiones del usuario seleccionado**.

## 4. Publicar el servidor

1. En el editor de Apps Script: **Implementar → Nueva implementación**.
2. En *Tipo*, elija **Aplicación web**.
3. **Ejecutar como:** *Yo* (la cuenta institucional). **Quién tiene acceso:** *Cualquier usuario*.
4. Pulse **Implementar** y copie la **URL de la aplicación web** (termina en `/exec`).

> **Si no aparece «Cualquier usuario»**, la administración de Google de la entidad lo tiene restringido. Pídale a TIC que lo permita para esta implementación. Sin esa opción la app no puede conectarse desde GitHub Pages. La URL no es secreta: la protección está en el ingreso con PIN, que el servidor valida en cada llamada.

Cuando cambie `Code.gs` más adelante: **Implementar → Gestionar implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar**. Así se conserva la misma URL.

## 5. Conectar la app con el servidor

1. En GitHub, abra [`config.js`](../config.js) y pulse el lápiz para editar.
2. Pegue la URL entre las comillas de `APPS_SCRIPT_URL: ""`.
3. Pulse **Commit changes**.

(También puede enviarle la URL a quien mantiene la app para que haga el cambio.)

## 6. Publicar la página en GitHub Pages

1. En el repositorio, abra **Settings → Pages**.
2. En *Build and deployment*, elija **Source: Deploy from a branch**, rama **main**, carpeta **/ (root)**, y pulse **Save**.
3. En uno o dos minutos la app queda en `https://carder-score.github.io/valoracion-estructuras/`.

## 7. Instalarla en el celular

1. Abra la dirección en Chrome (Android) o Safari (iPhone).
2. Ingrese con el correo y el PIN.
3. Chrome: menú ⋮ → **Agregar a la pantalla principal**. Safari: compartir → **Agregar a inicio**.
4. Ábrala una vez con señal; desde ese momento abre también sin señal.

---

## Uso diario de la coordinación

**Asignar una solicitud:** agregue una fila en la pestaña **Solicitudes**:
- `id` único (por ejemplo `S-2026-001`);
- `asignado_a` con el correo del evaluador;
- `estado` = `Asignada`;
- lo demás que tenga: tipo y número de radicado, fechas, municipio, dirección, edificación, texto de la solicitud y datos del peticionario.

La app se la muestra al evaluador en su próxima sincronización. Cuando él envía la valoración, la fila pasa a `Atendida` y queda el consecutivo de la valoración (`VE-2026-0001`…). El conteo de atendidas sobre asignadas es el indicador del PTI.

**Dónde queda cada cosa:**
- **Conceptos**: una fila por valoración, con todos los campos.
- **Fotos**: una fila por foto, con su enlace de Drive.
- **Drive**: `Municipio / VE-2026-0001 - Edificación / fotos y concepto .doc`.
- **Bitacora**: ingresos, intentos fallidos, valoraciones creadas y actualizadas.

**Datos personales:** no comparta la hoja ni la carpeta con más personas de las necesarias. La app nunca muestra datos del peticionario en listas; solo al abrir una solicitud asignada a quien la pide.

## Gemelo de pruebas (opcional)

Para probar sin tocar los datos reales:
1. Repita los pasos 1 a 4 con otra hoja (*Valoración de estructuras - PRUEBAS*).
2. Publique una copia del repositorio con `ESPACIO: "PRUEBAS"` y la URL de esa hoja en `config.js`.

`ESPACIO` aparece en el encabezado y separa lo guardado en el navegador.

## Publicar cambios en la app

En cada cambio que se publique:
- suba `VERSION` en `config.js`;
- suba `CACHE` en `sw.js` (por ejemplo `valoracion-estructuras-v2`).

Así los celulares toman la versión nueva al abrir con señal.
