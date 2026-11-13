// Configuración de la app. Es el único archivo que hay que tocar al instalarla.
// Ver docs/INSTALACION.md.
window.CONFIG = {
  // URL de la aplicación web de Apps Script (termina en /exec).
  // Vacía = "modo local": sin ingreso ni servidor; todo queda en este navegador.
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwFzdMLmnXXbyJ0XCHxmfTHAvwolCWPjIc9bWgPSyVioSSOnpPpkViSjxXJiAJLGfKK/exec",

  // Nombre que se muestra arriba. Útil para tener un gemelo de pruebas ("PRUEBAS").
  ESPACIO: "",

  // Versión visible (súbala junto con CACHE en sw.js en cada publicación).
  VERSION: "2.0.0",

  // Evento que motiva las visitas. Se usa en el asunto y en algunas frases tipo.
  // Déjelo vacío cuando las valoraciones no estén ligadas a un evento.
  EVENTO: "sismo del 10 de agosto de 2026",

  // Fotos: lado mayor en píxeles y calidad JPEG (0 a 1). 1200 px y 0,6 dan unos 240 KB.
  FOTO_MAX_PX: 1200,
  FOTO_CALIDAD: 0.6,

  // Sincronización automática cuando hay señal (minutos).
  SYNC_MIN: 10,

  // Aviso de cercanía: radio en metros para avisar que ya hay una valoración cerca.
  RADIO_CERCANIA_M: 10,
  // Precisión del GPS que se acepta sin advertencia (metros).
  GPS_PRECISION_OK_M: 15,

  // Días que una valoración ya enviada se conserva en el dispositivo antes de borrarse sola.
  BORRAR_ENVIADAS_DIAS: 30,

  // Mapa. Las capas oficiales se piden al servidor de cada entidad cuando se abre el mapa;
  // si una no carga, la app lo avisa y el resto sigue funcionando.
  MAPA: {
    CENTRO: [5.0, -75.85], ZOOM: 9, // Risaralda
    BASES: [
      { nombre: "Calles (OpenStreetMap)", url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png", max: 19,
        atrib: "&copy; colaboradores de OpenStreetMap" },
      { nombre: "Satélite (Esri World Imagery)", url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", max: 19,
        atrib: "Imágenes &copy; Esri, Maxar, Earthstar Geographics y la comunidad de usuarios SIG" },
      { nombre: "Satélite Sentinel-2 sin nubes 2020 (EOX)", url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg", max: 15,
        atrib: "Sentinel-2 cloudless 2020 &copy; EOX IT Services GmbH (datos Copernicus Sentinel modificados, 2020)" }
    ],
    // tipo "arcgis": servicio MapServer de ArcGIS (se pide con /export). capas: ids separados por coma (vacío = las visibles por defecto).
    CAPAS: [
      { id: "sgc_mm100k", nombre: "Amenaza por movimientos en masa 1:100.000 (SGC)", tipo: "arcgis", opacidad: 0.55, capas: "",
        url: "https://geoportal.sgc.gov.co/arcgis/rest/services/Mapa_Nacional_Amenaza_Mov_Masa_100K/Mapa_Nacional_Amenaza_Movimientos_Masa_100K/MapServer",
        atrib: "Servicio Geológico Colombiano", escala: "1:100.000" },
      { id: "sgc_sismica", nombre: "Amenaza sísmica nacional (SGC)", tipo: "arcgis", opacidad: 0.5, capas: "",
        url: "https://srvags.sgc.gov.co/arcgis/rest/services/Amenaza_Sismica/Amenaza_Sismica_Nacional/MapServer",
        atrib: "Servicio Geológico Colombiano", escala: "nacional" },
      { id: "sgc_geologia", nombre: "Atlas geológico 2020 (SGC)", tipo: "arcgis", opacidad: 0.5, capas: "",
        url: "https://srvags.sgc.gov.co/arcprod/rest/services/Geologia/Atlas_Geologico_2020/MapServer",
        atrib: "Servicio Geológico Colombiano", escala: "1:500.000" }
    ]
  },

  // Datos fijos del concepto FO-18-04.
  PARA: "Subdirector para el Conocimiento y Reducción del Riesgo -SCORE-",
  DE: "Profesionales de la Subdirección para el Conocimiento y Reducción del Riesgo -SCORE-",
  CONTACTO: "teléfono 3116511 Ext. 150 o a través de la página www.carder.gov.co mediante su módulo trámites y servicios"
};
