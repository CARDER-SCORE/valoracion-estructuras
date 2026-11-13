// Configuración de la app. Es el único archivo que hay que tocar al instalarla.
// Ver docs/INSTALACION.md.
window.CONFIG = {
  // URL de la aplicación web de Apps Script (termina en /exec).
  // Vacía = "modo local": sin ingreso ni servidor; todo queda en este navegador.
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbwFzdMLmnXXbyJ0XCHxmfTHAvwolCWPjIc9bWgPSyVioSSOnpPpkViSjxXJiAJLGfKK/exec",

  // Nombre que se muestra arriba. Útil para tener un gemelo de pruebas ("PRUEBAS").
  ESPACIO: "",

  // Versión visible (súbala junto con CACHE en sw.js en cada publicación).
  VERSION: "1.0.0",

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

  // Datos fijos del concepto FO-18-04.
  PARA: "Subdirector para el Conocimiento y Reducción del Riesgo -SCORE-",
  DE: "Profesionales de la Subdirección para el Conocimiento y Reducción del Riesgo -SCORE-",
  CONTACTO: "teléfono 3116511 Ext. 150 o a través de la página www.carder.gov.co mediante su módulo trámites y servicios"
};
