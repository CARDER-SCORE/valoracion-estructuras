// Arma el concepto técnico en formato FO-18-04 V24 a partir de la ficha.
// Funciones puras: reciben el estado de la ficha y devuelven texto o HTML.
window.CONCEPTO = (() => {
  const F = window.FICHA, C = window.CONFIG;
  const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  function fechaLarga(iso) {
    if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "";
    const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
    return `${d} de ${MESES[m - 1]} de ${y}`;
  }
  const anio = st => (st.ct_fecha || new Date().toISOString()).slice(0, 4);

  function frase(i) {
    const [, con, sin] = F.FRASES[i];
    if (!con.includes("{evento}")) return con;
    return C.EVENTO ? con.replaceAll("{evento}", C.EVENTO) : (sin || con.replaceAll(" {evento}", ""));
  }
  const resp = st => st.tenencia === "Pública" ? "la entidad propietaria" : "los propietarios";
  const diger = st => st.mpio === "Pereira" ? "Dirección de Gestión del Riesgo de Desastres de Pereira (DIGER)"
    : `oficina o consejo municipal de gestión del riesgo de desastres de ${st.mpio || "[municipio]"}`;
  function recTexto(x, st) {
    return x.replace("{resp}", resp(st)).replace("{diger}", diger(st)).replaceAll("{mpio}", st.mpio || "[municipio]")
      .replace("{evento_apoyos}", C.EVENTO ? ` en el marco de la emergencia por el ${C.EVENTO}` : "");
  }
  function recEjemplo(x) {
    return x.replace("{resp}", "los propietarios").replace("{diger}", "oficina de gestión del riesgo del municipio")
      .replaceAll("{mpio}", "…").replace("{evento_apoyos}", "");
  }

  function proponerAsunto(st) {
    return `Visita de valoración técnica, desde el componente estructural, de las afectaciones y condiciones de riesgo de la edificación ${st.edif || "[nombre]"}, ${st.dir ? st.dir + ", " : ""}${st.barrio ? "sector " + st.barrio + ", " : ""}municipio de ${st.mpio || "[municipio]"}${C.EVENTO ? `, con ocasión del ${C.EVENTO}` : ""}.`;
  }

  function listaDanos(obj, det, list) {
    return list.filter(([k]) => obj[k] && obj[k] !== "NL")
      .map(([k, t]) => `${t.toLowerCase()} (${F.NIV[obj[k]].toLowerCase()}${det[k] ? ": " + det[k] : ""})`);
  }
  function proponerConclusiones(st) {
    const s = F.calc(st), hab = st.hab || s.hab, ed = st.edif ? `la edificación ${st.edif}` : "la edificación";
    const de = listaDanos(st.est || {}, st.estd || {}, F.EST), dn = listaDanos(st.noest || {}, st.noestd || {}, F.NOEST);
    const terreno = s.por.filter(x => /terreno|masa|grietas|cuerpo|adyacentes|inclinación|colapso/.test(x));
    const c = [];
    c.push(`Bajo el marco de la Ley 1523 de 2012, se concluye que ${ed}, ubicada en ${st.dir || "[dirección]"}, ${st.barrio ? st.barrio + ", " : ""}municipio de ${st.mpio || "[municipio]"}, presenta ${de.length ? "daño en " + de.join("; ") : "daño estructural ninguno o leve"}${dn.length ? ", y daño no estructural en " + dn.join("; ") : ""}${terreno.length ? ", con " + terreno.join(", ") : ""}.`);
    c.push(`Con base en la inspección visual, la edificación se clasifica como ${F.HAB[hab][0].toLowerCase()} (${F.HAB[hab][1].toLowerCase()}), con nivel de daño ${F.NIVEL[st.nivel || s.niv]}${st.prev_ex === "Sí" && st.prev_clas ? `; la evaluación previa del ${fechaLarga(st.prev_fecha) || "[fecha]"} la había clasificado como ${F.HAB[st.prev_clas][1].toLowerCase()}` : ""}.`);
    c.push("Con la inspección visual no es posible establecer la causa del daño ni la capacidad de la estructura; para ello se requiere una evaluación estructural detallada conforme a la NSR-10.");
    return c.join("\n");
  }

  const V = t => t ? esc(t) : `<span class="vac">[sin dato]</span>`;
  const parr = t => t ? t.split(/\n\s*\n|\n/).filter(x => x.trim()).map(x => `<p>${esc(x)}</p>`).join("") : `<p><span class="vac">[sin dato]</span></p>`;

  // logo: URL o data URI del logo. fotos: [{src, d, n, e}]
  function hoja(st, logo) {
    st = { peligros: {}, est: {}, estd: {}, noest: {}, noestd: {}, recs: {}, anexos: {}, firmas: [], ...st };
    const fotosSt = st.fotos || [];
    const hab = st.hab || "", n = st.ct_num || "____";
    const enc = `<table class="enc"><tr><td rowspan="3" style="width:70px;text-align:center"><img src="${esc(logo)}" alt="CARDER" style="height:64px"></td><td rowspan="2" style="text-align:center;font-weight:bold;vertical-align:middle">PROCESO DE GESTIÓN AMBIENTAL SECTORIAL</td><td style="width:150px">Código: FO-18-04</td></tr><tr><td>Versión: 24</td></tr><tr><td style="text-align:center;font-weight:bold">CONCEPTO TÉCNICO N°${esc(n)}</td><td>Página: 1 de _</td></tr></table>`;
    const filasDanos = (list, obj, det) => list.filter(([k]) => obj[k]).map(([k, t]) => `<tr><td>${t}</td><td>${F.NIV[obj[k]]}</td><td>${esc(det[k] || "")}</td></tr>`).join("")
      || `<tr><td colspan="3"><span class="vac">[sin elementos evaluados]</span></td></tr>`;
    const pel = F.PELIGROS.filter(([k]) => st.peligros[k]).map(([, t]) => t).join("; ") || "Ninguno observado";
    const recs = F.RECS.filter(([k]) => st.recs[k]).map(([, , x]) => recTexto(x, st))
      .concat((st.rec_extra || "").split("\n").map(x => x.trim()).filter(Boolean));
    const concl = (st.conclusiones || "").split("\n").map(x => x.trim()).filter(Boolean);
    const fotos = fotosSt.length ? `<div class="ft">${fotosSt.map(f => `<div><img src="${esc(f.src)}" alt=""><br><b>Descripción:</b> ${esc(f.d)}${f.n || f.e ? `<br>Norte ${esc(f.n)} · Este ${esc(f.e)}` : ""}</div>`).join("")}</div>` : `<p><span class="vac">[sin fotos]</span></p>`;
    const anexos = F.ANEXOS.filter(a => st.anexos[a]);
    const mp = esc(st.mpio || "");
    return `${enc}
 <table><tr><th style="width:32%">Número y fecha del concepto técnico</th><td>N°${esc(n)} · ${V(fechaLarga(st.ct_fecha))}</td></tr>
 <tr><th>PARA</th><td>${V(st.para)}</td></tr><tr><th>DE</th><td>${V(st.de)}</td></tr><tr><th>ASUNTO</th><td>${V(st.asunto)}</td></tr></table>
 <h4>Información general</h4>
 <table><tr><th>Recurso</th><td>Suelo</td><th>Tipo</th><td>Evaluación</td></tr><tr><th>Expediente</th><td colspan="3">${V(st.expediente)}</td></tr>
 <tr><th>Documento origen</th><td>${esc(st.doc_tipo)} ${V(st.doc_num)}</td><th>Fecha del documento</th><td>${V(fechaLarga(st.doc_fecha))}</td></tr></table>
 <h4>Información del peticionario</h4>
 <table><tr><th>Tipo de persona</th><td>${esc(st.pet_tipo)}</td><th>Identificación</th><td>${V(st.pet_id)}</td></tr><tr><th>Nombre o razón social</th><td colspan="3">${V(st.pet_nombre)}</td></tr>
 <tr><th>Dirección de notificación</th><td>${V(st.pet_dir)}</td><th>Municipio</th><td>${mp}, Risaralda</td></tr>
 <tr><th>Teléfono</th><td>${V(st.pet_tel)}</td><th>Correo</th><td>${V(st.pet_correo)}</td></tr><tr><th>Calidad en que actúa</th><td colspan="3">${V(st.pet_calidad)}</td></tr></table>
 <h4>Descripción del punto</h4>
 <table><tr><th colspan="3">Coordenadas (Magna Sirgas Origen Nacional)</th></tr><tr><th>Norte</th><th>Este</th><th>Altitud (msnm)</th></tr><tr><td>${V(st.norte)}</td><td>${V(st.este)}</td><td>${V(st.alt)}</td></tr></table>
 <table><tr><th style="width:38%">GPS o documento de las coordenadas</th><td>${V(st.coord_fuente)}</td></tr><tr><th>Nombre del predio y/o dirección</th><td>${V(st.edif)}${st.dir ? ", " + esc(st.dir) : ""}</td></tr>
 <tr><th>Vereda y/o barrio</th><td>${V(st.barrio)}</td></tr><tr><th>Municipio / Departamento</th><td>${mp} / Risaralda</td></tr><tr><th>Cuenca hidrográfica</th><td>${V(st.cuenca)}</td></tr><tr><th>POMCA</th><td>${V(st.pomca)}</td></tr><tr><th>Acceso al punto</th><td>${V(st.acceso)}</td></tr></table>
 <h3>Descripción</h3><h4>Visita técnica</h4>
 <table><tr><th>Fecha de la visita técnica</th><td>${V(fechaLarga(st.v_fecha))}</td><th>Hora</th><td>${V(st.v_hora)}</td></tr><tr><th>Número de acta</th><td colspan="3">${V(st.v_acta)}</td></tr>
 <tr><th>Persona que atendió la visita</th><td>${V(st.v_atendio)}</td><th>Calidad</th><td>${V(st.v_calidad)}</td></tr></table>
 <h4>Generalidades visita técnica</h4>
 <table><tr><th style="width:38%">Predio</th><td>${esc(st.zona)}</td></tr><tr><th>Uso / tipo</th><td>${esc(st.uso)} · ${esc(st.tenencia)}</td></tr>
 <tr><th>Pisos / sótanos</th><td>${V(st.pisos)} / ${esc(st.sotanos || "0")}</td></tr><tr><th>Dimensiones (frente × fondo)</th><td>${st.frente || st.fondo ? `${esc(st.frente)} m × ${esc(st.fondo)} m` : '<span class="vac">[sin dato]</span>'}</td></tr>
 <tr><th>Época de construcción</th><td>${V(st.anio)}</td></tr><tr><th>Sistema estructural</th><td>${esc(st.sis)}</td></tr><tr><th>Entrepiso / soporte de cubierta / cubierta</th><td>${esc(st.entre)} · ${esc(st.sopcub)} · ${esc(st.cub)}</td></tr>
 <tr><th>Morfología del sitio</th><td>${esc(st.morf)}${st.d_agua ? ` · a ${esc(st.d_agua)} m de un cuerpo de agua` : ""}</td></tr><tr><th>Tipo de inspección / ocupación</th><td>${esc(st.insp_tipo)} · ${esc(st.ocup)}</td></tr></table>
 ${parr(st.desc_edif)}
 <h4>Antecedentes</h4>
 <p>La solicitud ${esc(st.doc_tipo)} ${V(st.doc_num)}${st.doc_fecha ? `, del ${esc(fechaLarga(st.doc_fecha))},` : ""} ${st.pet_nombre ? `presentada por ${esc(st.pet_nombre)}` : ""} manifiesta: ${st.sol_texto ? `“${esc(st.sol_texto.replace(/[.\s]+$/, ""))}”` : '<span class="vac">[texto de la solicitud]</span>'}. En atención a esta solicitud y en cumplimiento de las funciones misionales de gestión del riesgo, la Corporación Autónoma Regional de Risaralda (CARDER), a través de la Subdirección para el Conocimiento y Reducción del Riesgo (SCORE), realizó visita técnica el día ${V(fechaLarga(st.v_fecha))}${st.v_acta ? `, acta de visita No. ${esc(st.v_acta)}` : ""}. Derivado de la revisión de información y de la recolectada durante la visita, se determina lo siguiente:</p>
 ${st.prev_ex === "Sí" ? `<h4>Evaluación de daños previa${C.EVENTO ? ` posterior al ${esc(C.EVENTO)}` : ""}</h4><p>Se conoció el formulario regional de evaluación rápida de daños en edificaciones diligenciado el ${V(fechaLarga(st.prev_fecha))} por ${V(st.prev_quien)}, en el que la edificación quedó clasificada como ${st.prev_clas ? F.HAB[st.prev_clas][0].toLowerCase() + " (" + F.HAB[st.prev_clas][1].toLowerCase() + ")" : '<span class="vac">[clasificación]</span>'}. ${esc(st.prev_obs)}</p>` : ""}
 <h4>Evaluación rápida de daños (visita del ${V(fechaLarga(st.v_fecha))})</h4>
 <table><tr><th style="width:38%">Peligro global y condiciones geotécnicas</th><td colspan="2">${esc(pel)}</td></tr></table>
 <table><tr><th>Elemento estructural</th><th style="width:18%">Nivel de daño</th><th>Descripción</th></tr>${filasDanos(F.EST, st.est, st.estd)}</table>
 <table><tr><th>Elemento no estructural</th><th style="width:18%">Nivel de daño</th><th>Descripción</th></tr>${filasDanos(F.NOEST, st.noest, st.noestd)}</table>
 <table><tr><th style="width:38%">Clasificación de habitabilidad</th><td>${hab ? `${F.HAB[hab][1]} · ${F.HAB[hab][0]}` : '<span class="vac">[sin clasificar]</span>'}</td></tr><tr><th>Nivel de daño</th><td>${esc(F.NIVEL[st.nivel] || "")}</td></tr></table>
 <h3>Aspectos encontrados</h3>${parr(st.aspectos)}
 <h4>Análisis de las condiciones de amenaza, vulnerabilidad y riesgo</h4>${parr(st.analisis)}
 ${st.respuesta ? `<h4>Respuesta a las solicitudes del peticionario</h4>${parr(st.respuesta)}` : ""}
 <h4>Registro fotográfico</h4>${fotos}
 <h3>Conclusiones</h3>${concl.length ? `<ol>${concl.map(c => `<li>${esc(c)}</li>`).join("")}</ol>` : '<p><span class="vac">[sin conclusiones]</span></p>'}
 <h3>Recomendaciones</h3>${recs.length ? `<ol>${recs.map(r => `<li>${esc(r)}</li>`).join("")}</ol>` : '<p><span class="vac">[sin recomendaciones]</span></p>'}
 <h4>Alcance del concepto</h4><p>${esc(F.ALCANCE(fechaLarga(st.v_fecha)))}</p>
 <p>Finalmente, se recuerda que, de acuerdo con el artículo 2 de la Ley 1523 de 2012, los habitantes del territorio son corresponsables de la gestión del riesgo y deben actuar con precaución y autoprotección, tanto en lo personal como en lo de sus bienes.</p>
 <p>${anexos.length ? `Adjunto al presente concepto se envía: ${esc(anexos.join(", ").toLowerCase())}. ` : ""}Cualquier inquietud o información adicional con gusto será suministrada a través del ${esc(C.CONTACTO)}.</p>
 <div class="firmas">${(st.firmas || []).map(f => `<div><b>${V(f.n)}</b><br>${esc(f.p)}${f.m ? ` · M.P. ${esc(f.m)}` : ""}<br>${esc(f.c)}<br>Subdirección para el Conocimiento y Reducción del Riesgo - SCORE<br>Temática evaluada: ${esc(f.t)}</div>`).join("")}</div>`;
  }

  // Estilos de la hoja, compartidos por la vista previa (con prefijo #hoja) y el Word.
  const CSS_HOJA = `
table{border-collapse:collapse;width:100%;margin:6px 0 10px}
td,th{border:1px solid #000;padding:4px 6px;vertical-align:top;font-size:10pt}
th{background:#d9d9d9;text-align:left}
.enc td{font-size:9.5pt}
h3{font-size:11pt;margin:14px 0 4px;text-transform:uppercase}
h4{font-size:11pt;margin:10px 0 4px}
p{margin:4px 0 8px;text-align:justify}
ol{margin:4px 0 8px 18px;padding:0}
ol li{margin-bottom:5px;text-align:justify}
.ft{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ft div{font-size:9pt;text-align:center}
.ft img{width:100%;max-height:230px;object-fit:cover}
.firmas{display:grid;grid-template-columns:1fr 1fr;gap:28px 24px;margin-top:40px}
.firmas div{font-size:10pt;border-top:1px solid #000;padding-top:4px}
.vac{color:#b3261e;background:#fde7e5}`;

  function wordHtml(st, logoDataUri) {
    // Word no entiende grid: fotos y firmas van una debajo de otra con ancho fijo.
    const css = CSS_HOJA + `\nbody{font:11pt/1.4 Arial,Helvetica,sans-serif}.ft img{width:7.5cm;height:auto}.firmas div{margin-top:36px}`;
    return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>Concepto técnico</title><style>@page{size:21.59cm 27.94cm;margin:2cm 2cm 2cm 2.5cm}${css}</style></head><body>${hoja(st, logoDataUri)}</body></html>`;
  }

  function textoPlano(st) {
    const d = document.createElement("div");
    d.innerHTML = hoja(st, "");
    d.querySelectorAll("img").forEach(i => i.remove());
    d.querySelectorAll("tr").forEach(tr => tr.append(document.createTextNode("\n")));
    d.querySelectorAll("td,th").forEach(c => c.append(document.createTextNode("\t")));
    d.querySelectorAll("p,h3,h4,li,div").forEach(e => e.append(document.createTextNode("\n")));
    return d.textContent.replace(/\[sin dato\]/g, "").replace(/\n{3,}/g, "\n\n").trim();
  }

  function nombreArchivo(st, ext) {
    const base = st.ct_num ? `CT-${st.ct_num}-${anio(st)}` : (st.consecutivo || "borrador");
    return `${base} - ${(st.mpio || "").toUpperCase()} - ${(st.edif || "edificacion").replace(/[\\/:*?"<>|]/g, "")}.${ext}`;
  }

  // Fila para la hoja Registro_tareas del soporte del PTI (columnas A a F).
  function filaPTI(st) {
    const hoy = new Date().toISOString().slice(0, 10);
    return [st.asig_fecha || hoy, `${st.asig_por || "Subdirector SCORE"} (${st.asig_medio || "Correo"})`,
      `Concepto técnico estructural ${st.edif || ""}`.trim(), st.mpio || "",
      `${st.doc_tipo || ""} ${st.doc_num || ""}${st.ct_num ? " / CT-" + st.ct_num : ""}`.trim(), "Concepto técnico estructural"].join("\t");
  }

  return { esc, fechaLarga, frase, recTexto, recEjemplo, proponerAsunto, proponerConclusiones, hoja, CSS_HOJA, wordHtml,
    textoPlano, nombreArchivo, filaPTI };
})();
