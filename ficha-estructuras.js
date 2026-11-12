// Única fuente de verdad de la ficha de valoración estructural.
// La página dibuja el formulario y el concepto con estas listas.
// Apps Script no necesita copiarlas: guarda las columnas que llegan. Lo único que
// comparte con este archivo es CAMPOS_LISTA y CAMPOS_PERSONALES (ver apps-script/Code.gs).
window.FICHA = (() => {
  const MPIOS = ["Pereira", "Dosquebradas", "La Virginia", "Santa Rosa de Cabal", "Marsella", "Apía", "Balboa",
    "Belén de Umbría", "Guática", "La Celia", "Mistrató", "Pueblo Rico", "Quinchía", "Santuario"];

  const PELIGROS = [
    ["colapso_total", "Colapso total"],
    ["colapso_parcial", "Colapso parcial"],
    ["inclinacion", "Inclinación evidente"],
    ["adyacentes", "Riesgo por edificaciones adyacentes"],
    ["asentamiento", "Licuación, asentamiento o subsidencia del terreno"],
    ["mmasa", "Movimientos en masa cercanos"],
    ["grietas_terreno", "Grietas en el terreno"],
    ["cauce", "Amenaza por cuerpo hídrico (socavación o inundación)"]
  ];

  const EST = [
    ["columnas", "Columnas"], ["muros_port", "Muros portantes"], ["vigas", "Vigas"], ["nodos", "Nodos o conexiones"],
    ["entrepisos", "Entrepisos o losas"], ["cimentacion", "Cimentación"], ["escaleras_e", "Escaleras (estructura)"]
  ];

  const NOEST = [
    ["fachada", "Muros de fachada y antepechos"], ["divisorios", "Muros divisorios"],
    ["ventanales", "Ventanales y vidrios de fachada"], ["cielo", "Cielo raso y luminarias"], ["cubiertas", "Cubiertas"],
    ["escaleras", "Escaleras (acabados y barandas)"], ["ascensores", "Ascensores"], ["balcones", "Balcones"],
    ["tanques", "Tanques elevados"], ["gas", "Instalaciones de gas"], ["electricas", "Instalaciones eléctricas"],
    ["acueducto", "Acueducto y alcantarillado"], ["otros", "Otros"]
  ];

  const NIV = { NL: "Ninguno o leve", M: "Moderado", S: "Severo" };

  const HAB = {
    VERDE: ["Habitable", "Verde", "Puede usarse; daños menores que no comprometen la estabilidad."],
    AMARILLO: ["Uso restringido", "Amarillo", "Uso parcial o con restricciones hasta reparar o estudiar."],
    ROJO: ["No habitable", "Rojo", "Peligro; no debe ocuparse hasta una intervención."]
  };

  const NIVEL = { NINGUNO_MENOR: "ninguno o menor", MODERADO: "moderado", SEVERO: "severo" };

  // {evento} se reemplaza por CONFIG.EVENTO. Si no hay evento, la frase lo omite.
  const FRASES = [
    ["Límite de la inspección", "Con la inspección visual no es posible establecer la causa del daño, su profundidad ni su relación directa con el {evento}; para ello se requiere un estudio de detalle.", "Con la inspección visual no es posible establecer la causa del daño ni su profundidad; para ello se requiere un estudio de detalle."],
    ["Apreciación, no medición", "Las inclinaciones y desplazamientos descritos son apreciaciones visuales y no mediciones instrumentales, por lo que su magnitud real debe verificarse con un levantamiento topográfico."],
    ["Sismo como agravante", "La sacudida del {evento} pudo agravar una condición preexistente de la edificación o del terreno.", "Un evento sísmico pudo agravar una condición preexistente de la edificación o del terreno."],
    ["Lluvias", "Mientras no se conozca la causa, el daño puede avanzar, sobre todo en temporada de lluvias, cuando el suelo se satura y las grietas abiertas dejan entrar el agua."],
    ["Vulnerabilidad del sistema", "El sistema estructural observado, por su configuración y época de construcción, podría no cumplir los requisitos de la NSR-10, lo que aumenta su vulnerabilidad ante un nuevo evento sísmico."],
    ["Elementos que pueden caer", "Los elementos no estructurales con daño (antepechos, fachadas, tanques o cubiertas) pueden desprenderse y representan un peligro para ocupantes y transeúntes, aunque no comprometan la estabilidad global."]
  ];

  // {resp}, {diger}, {mpio} y {evento} se reemplazan con los datos del caso.
  const RECS = [
    ["evalest", "Evaluación estructural detallada", "Se recomienda a {resp} contratar una evaluación estructural detallada y un estudio de vulnerabilidad sísmica de la edificación con un ingeniero civil con experiencia en estructuras, conforme al Título A.10 de la NSR-10, que defina si se requiere reparación o reforzamiento."],
    ["geotec", "Estudio geotécnico", "Se recomienda a {resp} contratar un estudio geotécnico y de suelos que establezca las causas del daño en el terreno y en la cimentación y defina las obras de estabilización necesarias, conforme al Título H de la NSR-10."],
    ["topo", "Medir la inclinación", "Se recomienda realizar un levantamiento topográfico con mediciones instrumentales que determine si existe inclinación o desplazamiento de la edificación y su magnitud, y repetir las mediciones periódicamente para saber si el movimiento continúa."],
    ["restric", "Restringir el uso de zonas", "Se recomienda restringir el uso de las zonas de la edificación con daño moderado o severo y señalizarlas, hasta contar con la evaluación estructural detallada."],
    ["apunt", "Apuntalamiento provisional", "Se recomienda evaluar con un profesional el apuntalamiento provisional de los elementos con daño severo, mientras se define la intervención definitiva."],
    ["noest", "Retirar elementos que pueden caer", "Se recomienda retirar o asegurar los elementos no estructurales con riesgo de caída (antepechos, enchapes, tanques, tejas sueltas), protegiendo las zonas de circulación."],
    ["testigos", "Seguimiento de grietas", "Mientras se adelantan los estudios, se recomienda hacer seguimiento a las grietas y fisuras, marcando sus extremos y midiendo su abertura cada semana. Si se abren, aparecen nuevas fisuras o las puertas y ventanas se traban, se debe evacuar de manera preventiva y avisar de inmediato a la línea de emergencias 123."],
    ["aguas", "Controlar el agua", "Se recomienda sellar las grietas del terreno, revisar que bajantes y desagües no descarguen sobre el terreno afectado y descartar fugas en las redes internas."],
    ["licencia", "Licencia para intervenir", "Cualquier reparación, reforzamiento u obra de estabilización debe diseñarse con base en los estudios recomendados y contar con licencia de construcción y con los permisos ambientales que apliquen."],
    ["evac", "Evacuación preventiva", "Dadas las condiciones observadas, se recomienda la evacuación preventiva de la edificación hasta que un estudio estructural determine las condiciones para su ocupación."],
    ["t_diger", "Traslado a gestión del riesgo municipal", "Se da traslado del presente concepto a la {diger}, para que, en el marco de sus competencias, considere el seguimiento de la condición de la edificación, las medidas para reducir la exposición de sus ocupantes y la orientación sobre los apoyos que puedan aplicar{evento_apoyos}."],
    ["t_plan", "Traslado a planeación o control urbano", "Se da traslado a la Secretaría de Planeación del municipio de {mpio}, para que, en el marco de sus competencias, verifique las condiciones de licenciamiento de la edificación y de las intervenciones que se adelanten."],
    ["t_esp", "Traslado a la empresa de servicios públicos", "Se da traslado a la empresa prestadora de los servicios de acueducto y alcantarillado del municipio de {mpio}, para que verifique el estado de las redes cercanas a la edificación y descarte fugas o filtraciones."]
  ];

  const ANEXOS = ["Acta de visita", "Registro fotográfico", "Formulario regional de evaluación rápida de daños", "Plano o esquema de localización"];

  const TIPOS_SOLICITUD = ["PQRSF", "SAIA", "Reporte SOS", "Solicitud verbal", "Oficio", "Correo institucional"];

  // Campos que pueden verse en listas (en la app y en lo que devuelve el servidor).
  // Nada personal del peticionario va aquí.
  const CAMPOS_LISTA = ["id", "consecutivo", "ct_num", "estado", "mpio", "barrio", "edif", "dir", "v_fecha", "hab", "nivel",
    "lat", "lon", "evaluador_nombre", "doc_tipo", "doc_num", "actualizado"];

  // Datos personales (Ley 1581 de 2012): se guardan en la hoja, nunca salen en listas.
  const CAMPOS_PERSONALES = ["pet_nombre", "pet_id", "pet_dir", "pet_tel", "pet_correo", "v_atendio"];

  // Texto fijo que va siempre en el concepto.
  const ALCANCE = fecha => `El presente concepto corresponde a una valoración técnica visual, realizada en la visita del ${fecha || "[fecha de visita]"}, de las afectaciones y condiciones de riesgo de la edificación desde el componente estructural, sin ensayos, exploración del subsuelo, mediciones instrumentales ni modelación. No constituye certificación de seguridad estructural ni de habitabilidad, no reemplaza la evaluación estructural detallada ni el estudio de vulnerabilidad que exige la NSR-10 (Ley 400 de 1997) y no autoriza obras, que requieren licencia de construcción. Las funciones de las Corporaciones Autónomas Regionales en gestión del riesgo son complementarias, subsidiarias y de apoyo, y no sustituyen la responsabilidad de los alcaldes ni la de los propietarios (Ley 1523 de 2012, artículos 2, 14, 27 y 31).`;

  // Clasificación sugerida (criterio de la guía AIS: el peor indicador manda).
  function calc(st) {
    const p = st.peligros || {}, es = Object.values(st.est || {}), ne = Object.values(st.noest || {});
    let hab = "VERDE", niv = "NINGUNO_MENOR"; const por = [];
    if (es.includes("M")) niv = "MODERADO";
    if (ne.includes("S") && niv === "NINGUNO_MENOR") niv = "MODERADO";
    if (es.includes("S")) niv = "SEVERO";
    if (es.includes("M") || ne.includes("S") || p.adyacentes || p.asentamiento || p.mmasa || p.grietas_terreno || p.cauce) hab = "AMARILLO";
    if (p.colapso_total || p.colapso_parcial || p.inclinacion || es.includes("S")) hab = "ROJO";
    if (p.colapso_total) por.push("colapso total");
    if (p.colapso_parcial) por.push("colapso parcial");
    if (p.inclinacion) por.push("inclinación evidente");
    if (es.includes("S")) por.push("daño estructural severo"); else if (es.includes("M")) por.push("daño estructural moderado");
    if (ne.includes("S")) por.push("daño no estructural severo");
    ["asentamiento", "mmasa", "grietas_terreno", "cauce", "adyacentes"].forEach(k => {
      if (p[k]) por.push(PELIGROS.find(x => x[0] === k)[1].toLowerCase());
    });
    return { hab, niv, por };
  }

  return { MPIOS, PELIGROS, EST, NOEST, NIV, HAB, NIVEL, FRASES, RECS, ANEXOS, TIPOS_SOLICITUD,
    CAMPOS_LISTA, CAMPOS_PERSONALES, ALCANCE, calc };
})();
