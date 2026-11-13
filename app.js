// App de valoración de estructuras: ingreso, lista, ficha por pasos, fotos, GPS, trabajo sin señal y envío a Apps Script.
(() => {
"use strict";
const C = window.CONFIG, F = window.FICHA, K = window.CONCEPTO;
const $ = id => document.getElementById(id);
const esc = K.esc;
const LOCAL = !C.APPS_SCRIPT_URL;
const hoyISO = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
const ahora = () => new Date().toISOString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10));

function toast(t, ms = 2600) {
  const e = $("toast"); e.textContent = t; e.classList.add("on");
  clearTimeout(toast.h); toast.h = setTimeout(() => e.classList.remove("on"), ms);
}

// ---------- Coordenadas: WGS84 -> Magna Sirgas Origen Nacional (EPSG:9377, CTM12) ----------
function aOrigenNacional(lat, lon) {
  const a = 6378137, f = 1 / 298.257222101, e2 = f * (2 - f), ep2 = e2 / (1 - e2), k0 = 0.9992;
  const r = Math.PI / 180, phi = lat * r, phi0 = 4 * r, dl = (lon + 73) * r;
  const M = p => a * ((1 - e2 / 4 - 3 * e2 ** 2 / 64 - 5 * e2 ** 3 / 256) * p - (3 * e2 / 8 + 3 * e2 ** 2 / 32 + 45 * e2 ** 3 / 1024) * Math.sin(2 * p)
    + (15 * e2 ** 2 / 256 + 45 * e2 ** 3 / 1024) * Math.sin(4 * p) - (35 * e2 ** 3 / 3072) * Math.sin(6 * p));
  const s = Math.sin(phi), c = Math.cos(phi), N = a / Math.sqrt(1 - e2 * s * s), T = Math.tan(phi) ** 2, Cc = ep2 * c * c, A = dl * c;
  const x = k0 * N * (A + (1 - T + Cc) * A ** 3 / 6 + (5 - 18 * T + T * T + 72 * Cc - 58 * ep2) * A ** 5 / 120);
  const y = k0 * (M(phi) - M(phi0) + N * Math.tan(phi) * (A * A / 2 + (5 - T + 9 * Cc + 4 * Cc * Cc) * A ** 4 / 24 + (61 - 58 * T + T * T + 600 * Cc - 330 * ep2) * A ** 6 / 720));
  return { este: 5000000 + x, norte: 2000000 + y };
}
function distM(a, b) {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}
window.__geo = { aOrigenNacional, distM }; // para pruebas

// ---------- Almacenamiento local (IndexedDB, con respaldo en memoria) ----------
const DB = (() => {
  let dbp = null; const mem = new Map();
  function abrir() {
    if (dbp) return dbp;
    dbp = new Promise(ok => {
      try {
        const r = indexedDB.open("valoracion-estructuras" + (C.ESPACIO ? "-" + C.ESPACIO : ""), 1);
        r.onupgradeneeded = () => r.result.createObjectStore("fichas", { keyPath: "id" });
        r.onsuccess = () => ok(r.result);
        r.onerror = () => ok(null);
      } catch (e) { ok(null); }
    });
    return dbp;
  }
  async function tx(modo, fn) {
    const db = await abrir();
    if (!db) return fn(null);
    return new Promise((ok, ko) => {
      const t = db.transaction("fichas", modo), s = t.objectStore("fichas"); let res;
      Promise.resolve(fn(s)).then(v => { res = v; });
      t.oncomplete = () => ok(res); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error);
    });
  }
  const req = r => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  return {
    async todas() { const db = await abrir(); if (!db) return [...mem.values()]; return tx("readonly", s => req(s.getAll())); },
    async una(id) { const db = await abrir(); if (!db) return mem.get(id) || null; return tx("readonly", s => req(s.get(id))); },
    async poner(r) { const db = await abrir(); if (!db) { mem.set(r.id, structuredClone(r)); return; } return tx("readwrite", s => req(s.put(r))); },
    async quitar(id) { const db = await abrir(); if (!db) { mem.delete(id); return; } return tx("readwrite", s => req(s.delete(id))); },
    async disponible() { return !!(await abrir()); }
  };
})();
// Lee la versión guardada, aplica fn y la vuelve a guardar (evita pisar cambios de la sincronización).
let cola = Promise.resolve();
function actualizar(id, fn) {
  const p = cola.then(async () => { const r = await DB.una(id); if (!r) return null; const n = fn(r) || r; await DB.poner(n); return n; });
  cola = p.catch(() => {});
  return p;
}

// ---------- Sesión y servidor ----------
const KS = "ve_sesion" + (C.ESPACIO ? "_" + C.ESPACIO : "");
const KC = "ve_cache" + (C.ESPACIO ? "_" + C.ESPACIO : "");
const leerLS = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch (e) { return d; } };
const ponerLS = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };
let sesion = leerLS(KS, null);
let cache = leerLS(KC, { asignadas: [], conceptos: [], sync: "" });

class ErrorServidor extends Error { constructor(m, code) { super(m); this.code = code; } }
async function api(accion, datos = {}) {
  if (LOCAL) throw new ErrorServidor("Modo local", "LOCAL");
  let res;
  try {
    res = await fetch(C.APPS_SCRIPT_URL, {
      method: "POST", redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // evita la consulta previa CORS
      body: JSON.stringify({ accion, token: sesion && sesion.token, espacio: C.ESPACIO, ...datos })
    });
  } catch (e) { throw new ErrorServidor("Sin conexión con el servidor", "RED"); }
  let j;
  try { j = await res.json(); } catch (e) { throw new ErrorServidor("Respuesta inválida del servidor (" + res.status + ")", "RED"); }
  if (!j.ok) {
    if (j.code === "SESION") { sesionVencida(); }
    throw new ErrorServidor(j.error || "Error del servidor", j.code || "SERVIDOR");
  }
  return j;
}
function sesionVencida() {
  if (!sesion) return;
  sesion = null; try { localStorage.removeItem(KS); } catch (e) {}
  toast("Su sesión venció. Ingrese de nuevo; lo que tenga en el dispositivo se conserva.", 4500);
  if (vistaActual !== "editor") mostrar("ingreso");
}

// ---------- Vistas ----------
let vistaActual = "";
function mostrar(v) {
  vistaActual = v;
  document.querySelectorAll(".vista").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  $("h-acciones").innerHTML = "";
  if (v === "inicio" && sesion) {
    $("h-acciones").innerHTML = `<span class="hbtn" style="cursor:default">${esc(sesion.nombre || sesion.correo)}</span><button class="hbtn" type="button" id="b-salir">Salir</button>`;
    $("b-salir").onclick = salir;
  }
  if (v === "inicio") pintarInicio();
  window.scrollTo({ top: 0 });
}
function red() {
  const on = navigator.onLine, e = $("red");
  e.textContent = LOCAL ? "Modo local" : on ? "En línea" : "Sin señal";
  e.classList.toggle("off", !LOCAL && !on);
}

// ---------- Ingreso ----------
$("f-ingreso").onsubmit = async ev => {
  ev.preventDefault();
  const correo = $("in-correo").value.trim().toLowerCase(), pin = $("in-pin").value.trim();
  $("in-error").textContent = ""; $("b-entrar").disabled = true;
  try {
    const j = await api("ingresar", { correo, pin });
    sesion = { token: j.token, vence: j.vence, ...j.usuario };
    ponerLS(KS, sesion);
    $("in-pin").value = "";
    mostrar("inicio");
    sincronizar();
  } catch (e) {
    $("in-error").textContent = e.code === "RED" ? "No hay conexión. Para el primer ingreso se necesita señal." : e.message;
  } finally { $("b-entrar").disabled = false; }
};
async function salir() {
  const todas = await DB.todas();
  const pend = todas.filter(r => r.estado === "pendiente" || r.estado === "error").length;
  const borr = todas.filter(r => r.estado === "borrador" && !r.st.ejemplo).length;
  if (pend) { toast(`Tiene ${pend} valoración(es) sin enviar. Sincronice antes de salir.`, 4500); return; }
  if (borr && Date.now() - (salir.t || 0) > 5000) { salir.t = Date.now(); toast(`Al salir se borran ${borr} borrador(es) de este dispositivo. Pulse «Salir» otra vez para confirmar.`, 5000); return; }
  try { if (sesion) await api("salir"); } catch (e) {}
  for (const r of todas) await DB.quitar(r.id);
  sesion = null; cache = { asignadas: [], conceptos: [], sync: "" };
  try { localStorage.removeItem(KS); localStorage.removeItem(KC); } catch (e) {}
  mostrar("ingreso");
}

// ---------- Inicio ----------
const ESTADOS = { borrador: "Borrador", pendiente: "Por enviar", enviada: "Enviada", error: "Con error" };
async function pintarInicio() {
  $("c-asignadas").hidden = LOCAL;
  const todas = (await DB.todas()).sort((a, b) => (b.actualizado || "").localeCompare(a.actualizado || ""));
  const porSol = new Map(todas.filter(r => r.solicitud_id).map(r => [String(r.solicitud_id), r]));
  const asig = (cache.asignadas || []);
  $("l-asignadas").innerHTML = asig.length ? asig.map(s => {
    const local = porSol.get(String(s.id));
    return `<div class="item"><div><div class="t">${esc(s.edif || s.dir || "Sin nombre")} · ${esc(s.mpio || "")}</div>
      <div class="s">${esc(s.doc_tipo || "")} ${esc(s.doc_num || "")}${s.asig_fecha ? " · asignada el " + esc(K.fechaLarga(s.asig_fecha)) : ""}${s.estado ? " · " + esc(s.estado) : ""}</div></div>
      <div class="acc"><button class="btn sm${local ? " sec" : ""}" type="button" data-sol="${esc(s.id)}">${local ? "Abrir valoración" : "Empezar valoración"}</button></div></div>`;
  }).join("") : `<div class="vacio">${navigator.onLine ? "No tiene solicitudes asignadas." : "Sin señal: se muestran las últimas descargadas."}</div>`;
  $("l-mias").innerHTML = todas.length ? todas.map(r => {
    const st = r.st || {};
    const fotosPend = (r.fotos || []).filter(f => !f.subida).length;
    return `<div class="item"><div><div class="t">${esc(st.edif || st.dir || "Sin nombre")} · ${esc(st.mpio || "")}${st.ejemplo ? " (ejemplo)" : ""}</div>
      <div class="s">${r.consecutivo ? esc(r.consecutivo) + " · " : ""}${st.v_fecha ? "visita del " + esc(K.fechaLarga(st.v_fecha)) + " · " : ""}${(r.fotos || []).length} foto(s)${r.estado === "pendiente" && fotosPend ? `, ${fotosPend} sin subir` : ""}${r.error ? " · " + esc(r.error) : ""}</div></div>
      <div class="acc">${st.hab ? `<span class="pill p-${st.hab}">${F.HAB[st.hab][1]}</span>` : ""}<span class="pill p-${r.estado}">${ESTADOS[r.estado] || r.estado}</span>
      <button class="btn sm" type="button" data-abrir="${r.id}">Abrir</button>
      ${r.estado === "borrador" || r.estado === "enviada" ? `<button class="btn sm sec" type="button" data-borrar="${r.id}">${r.estado === "enviada" ? "Quitar del dispositivo" : "Borrar"}</button>` : ""}</div></div>`;
  }).join("") : `<div class="vacio">Aún no hay valoraciones en este dispositivo.</div>`;
  infoSync();
}
function infoSync() {
  if (LOCAL) { $("sync-info").textContent = ""; $("b-sync").hidden = true; return; }
  $("sync-info").textContent = cache.sync ? "Última sincronización: " + new Date(cache.sync).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "Aún no ha sincronizado.";
}
$("l-mias").onclick = async e => {
  const a = e.target.closest("[data-abrir]"); if (a) return abrir(a.dataset.abrir);
  const b = e.target.closest("[data-borrar]");
  if (b) {
    const id = b.dataset.borrar;
    if (b.dataset.conf !== "1") { b.dataset.conf = "1"; b.textContent = "¿Seguro? Pulse otra vez"; setTimeout(() => { if (b.isConnected) pintarInicio(); }, 4000); return; }
    await DB.quitar(id); toast("Quitada del dispositivo"); pintarInicio();
  }
};
$("l-asignadas").onclick = async e => {
  const b = e.target.closest("[data-sol]"); if (!b) return;
  const id = b.dataset.sol;
  const existente = (await DB.todas()).find(r => String(r.solicitud_id) === String(id));
  if (existente) return abrir(existente.id);
  let s = (cache.asignadas || []).find(x => String(x.id) === String(id)) || {};
  b.disabled = true;
  try { const j = await api("solicitud", { id }); s = j.solicitud; }
  catch (err) { if (err.code === "SESION") return; toast("Sin señal: se abre con los datos básicos. Complete los del peticionario después.", 4000); }
  finally { b.disabled = false; }
  const campos = ["doc_tipo", "doc_num", "doc_fecha", "asig_por", "asig_medio", "asig_fecha", "mpio", "barrio", "dir", "edif", "sol_texto",
    "pet_tipo", "pet_nombre", "pet_id", "pet_dir", "pet_tel", "pet_correo", "pet_calidad", "expediente"];
  const pre = {}; campos.forEach(k => { if (s[k] !== undefined && s[k] !== "") pre[k] = /fecha/.test(k) ? String(s[k]).slice(0, 10) : String(s[k]); });
  const r = nuevaFicha(pre); r.solicitud_id = String(id);
  await DB.poner(r); abrir(r.id);
};
$("b-nueva").onclick = async () => { const r = nuevaFicha({}); await DB.poner(r); abrir(r.id); };
$("b-sync").onclick = () => sincronizar(true);
$("f-imp").onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const o = JSON.parse(rd.result);
      const r = nuevaFicha({});
      const fotoOk = x => x && typeof x.src === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x.src);
      const limpiarFoto = x => ({ id: uuid(), src: x.src, d: String(x.d || ""), n: String(x.n || ""), e: String(x.e || ""), lat: String(x.lat || ""), lon: String(x.lon || ""), subida: false });
      const datos = o.st ? o.st : o; // o.st: exportado por esta app; si no, borrador de la v1 local
      const { fotos: _f, paso: _p, ...resto } = datos;
      r.st = { ...r.st, ...resto };
      r.fotos = (o.st ? o.fotos : datos.fotos || []).filter(fotoOk).map(limpiarFoto);
      await DB.poner(r); toast("Borrador importado"); abrir(r.id);
    } catch (err) { toast("El archivo no es un borrador válido"); }
  };
  rd.readAsText(f); e.target.value = "";
};

function firmaPerfil() {
  return sesion ? { n: (sesion.nombre || "").toUpperCase(), p: sesion.profesion || "", c: sesion.cargo || "", m: sesion.matricula || "", t: "Gestión del Riesgo" }
    : { n: "", p: "Ingeniero Civil", c: "", m: "", t: "Gestión del Riesgo" };
}
function nuevaFicha(pre) {
  return {
    id: uuid(), estado: "borrador", creado: ahora(), actualizado: ahora(), consecutivo: "", fotos: [],
    st: {
      ct_fecha: hoyISO(), para: C.PARA, de: C.DE, expediente: "NA", doc_tipo: "SAIA", asig_medio: "Correo", mpio: F.MPIOS[0],
      v_fecha: hoyISO(), sotanos: "0", peligros: {}, est: {}, noest: {}, estd: {}, noestd: {}, recs: {},
      anexos: { "Acta de visita": true, "Registro fotográfico": true }, hab: "", firmas: [firmaPerfil()], paso: 0, ...pre
    }
  };
}

// ---------- Editor ----------
const PASOS = [...document.querySelectorAll("section.paso")];
let cur = null; // {id, st, fotos}
let estadoCur = "";
const ed = () => cur.st;

$("mpio").innerHTML = F.MPIOS.map(m => `<option>${m}</option>`).join("");
$("doc_tipo").innerHTML = F.TIPOS_SOLICITUD.map(m => `<option>${m}</option>`).join("");
$("peligros").innerHTML = F.PELIGROS.map(([k, t]) => `<label><input type="checkbox" id="pg_${k}">${t}</label>`).join("");
function tablaDanos(el, list, grupo) {
  el.innerHTML = `<tr><th>Elemento</th><th>Nivel</th><th>Descripción del daño (opcional)</th></tr>` + list.map(([k, t]) => `<tr><td class="n">${t}</td><td><span class="niv" role="radiogroup" aria-label="${t}">${["NL", "M", "S"].map(n => `<input type="radio" name="${grupo}_${k}" id="${grupo}_${k}_${n}" value="${n}"><label for="${grupo}_${k}_${n}" class="${n.toLowerCase()}">${n === "NL" ? "N/L" : n}</label>`).join("")}</span></td><td><input id="${grupo}d_${k}" placeholder="Fisuras diagonales en muro del primer piso…" aria-label="Descripción del daño en ${t}"></td></tr>`).join("");
}
tablaDanos($("t-est"), F.EST, "est"); tablaDanos($("t-noest"), F.NOEST, "noest");
$("sem").innerHTML = Object.entries(F.HAB).map(([k, [n, c, d]]) => `<label class="${k}"><input type="radio" name="hab" id="hab_${k}" value="${k}"><span><b>${c} · ${n}</b>${d}</span></label>`).join("");
$("frases").innerHTML = F.FRASES.map(([t], i) => `<button type="button" class="btn sm sec" data-f="${i}">${t}</button>`).join("");
$("recs").innerHTML = F.RECS.map(([k, t, x]) => `<label class="rec"><input type="checkbox" id="rc_${k}"><span><b>${t}</b><em>${esc(K.recEjemplo(x))}</em></span></label>`).join("");
$("anexos").innerHTML = F.ANEXOS.map((a, i) => `<label><input type="checkbox" id="ax_${i}">${a}</label>`).join("");
$("nav").innerHTML = PASOS.map((p, i) => `<button type="button" data-i="${i}" class="${p.id === "p-prev" ? "prev" : ""}">${p.dataset.t}</button>`).join("");
$("radio-m").textContent = C.RADIO_CERCANIA_M; $("foto-px").textContent = C.FOTO_MAX_PX;
const CAMPOS = [...document.querySelectorAll("#v-editor input:not([type=file]):not([type=checkbox]):not([type=radio]),#v-editor select,#v-editor textarea")]
  .map(e => e.id).filter(id => id && id !== "pti_fila" && !/^(estd|noestd)_/.test(id));

function firmasUI() {
  $("firmas").innerHTML = ed().firmas.map((f, i) => `<div class="g" style="padding:10px 0;border-bottom:1px solid var(--borde)">
  <label class="w2">Nombre<input data-fi="${i}" data-fk="n" value="${esc(f.n)}"></label>
  <label>Profesión<input data-fi="${i}" data-fk="p" value="${esc(f.p)}"></label>
  <label>Cargo<input data-fi="${i}" data-fk="c" value="${esc(f.c)}"></label>
  <label>Matrícula profesional<input data-fi="${i}" data-fk="m" value="${esc(f.m)}"></label>
  <label>Temática evaluada<input data-fi="${i}" data-fk="t" value="${esc(f.t)}"></label>
  ${i > 0 ? `<div style="align-self:end"><button type="button" class="btn sm sec" data-quita="${i}">Quitar</button></div>` : ""}</div>`).join("");
}
function fotosUI() {
  $("fotos").innerHTML = cur.fotos.map((f, i) => `<div class="foto"><img src="${esc(f.src)}" alt="Foto ${i + 1}">
  <label>Descripción<input data-fo="${i}" data-fk="d" value="${esc(f.d)}"></label>
  <div class="g" style="grid-template-columns:1fr 1fr"><label>Norte<input data-fo="${i}" data-fk="n" value="${esc(f.n)}" inputmode="decimal"></label><label>Este<input data-fo="${i}" data-fk="e" value="${esc(f.e)}" inputmode="decimal"></label></div>
  <div class="sub">${f.subida ? "Subida a Drive" : "Sin subir"}</div>
  <button type="button" class="btn sm sec" data-qf="${i}">Quitar foto</button></div>`).join("") || `<div class="vacio">Sin fotos.</div>`;
}
function leer() {
  const st = ed();
  CAMPOS.forEach(id => st[id] = $(id).value);
  F.PELIGROS.forEach(([k]) => st.peligros[k] = $("pg_" + k).checked);
  F.EST.forEach(([k]) => { const r = document.querySelector(`input[name=est_${k}]:checked`); st.est[k] = r ? r.value : ""; st.estd[k] = $("estd_" + k).value; });
  F.NOEST.forEach(([k]) => { const r = document.querySelector(`input[name=noest_${k}]:checked`); st.noest[k] = r ? r.value : ""; st.noestd[k] = $("noestd_" + k).value; });
  const h = document.querySelector("input[name=hab]:checked"); st.hab = h ? h.value : "";
  F.RECS.forEach(([k]) => st.recs[k] = $("rc_" + k).checked);
  F.ANEXOS.forEach((a, i) => st.anexos[a] = $("ax_" + i).checked);
}
function pintar() {
  const st = ed();
  CAMPOS.forEach(id => { $(id).value = st[id] !== undefined ? st[id] : ($(id).tagName === "SELECT" ? $(id).options[0]?.value ?? "" : ""); });
  F.PELIGROS.forEach(([k]) => $("pg_" + k).checked = !!st.peligros[k]);
  F.EST.forEach(([k]) => { document.querySelectorAll(`input[name=est_${k}]`).forEach(r => r.checked = r.value === st.est[k]); $("estd_" + k).value = st.estd[k] || ""; });
  F.NOEST.forEach(([k]) => { document.querySelectorAll(`input[name=noest_${k}]`).forEach(r => r.checked = r.value === st.noest[k]); $("noestd_" + k).value = st.noestd[k] || ""; });
  document.querySelectorAll("input[name=hab]").forEach(r => r.checked = r.value === st.hab);
  F.RECS.forEach(([k]) => $("rc_" + k).checked = !!st.recs[k]);
  F.ANEXOS.forEach((a, i) => $("ax_" + i).checked = !!st.anexos[a]);
  firmasUI(); fotosUI(); sugerencia(); gpsInfo();
  $("alcance-fijo").textContent = F.ALCANCE(K.fechaLarga(st.v_fecha));
}
function cabecera() {
  const st = ed();
  $("ed-titulo").textContent = `${cur.consecutivo ? cur.consecutivo + " · " : ""}${st.edif || st.dir || "Nueva valoración"}${st.mpio ? " · " + st.mpio : ""}`;
  const p = $("ed-estado"); p.className = "pill p-" + estadoCur; p.textContent = ESTADOS[estadoCur] || "";
  const enviable = !LOCAL && !st.ejemplo;
  $("b-enviar").hidden = !enviable;
  $("envio-hint").textContent = LOCAL ? "Modo local: no hay servidor configurado. Use «Descargar Word» o «Exportar borrador» para conservar la valoración."
    : st.ejemplo ? "Esta valoración tiene datos de ejemplo y no se puede enviar."
    : estadoCur === "enviada" ? "Ya está en la hoja institucional. Si la corrige, vuelve a quedar «por enviar» y se actualiza."
    : "Al marcarla «por enviar», la app la manda a la hoja y las fotos a Drive en cuanto haya señal. Podrá seguir descargando el Word.";
  $("b-enviar").textContent = estadoCur === "pendiente" ? "Enviar ahora" : "Marcar por enviar";
  $("b-enviar").disabled = estadoCur === "enviada";
}

// Huella del contenido (sin el paso abierto) para saber si algo cambió de verdad.
const huella = (st, fotos) => JSON.stringify({ ...st, paso: 0 }) + JSON.stringify((fotos || []).map(f => [f.id, f.d, f.n, f.e]));
let tGuardar = null;
function guardarPronto() { clearTimeout(tGuardar); tGuardar = setTimeout(guardar, 400); }
async function guardar(nuevoEstado) {
  clearTimeout(tGuardar);
  if (!cur) return;
  const snap = { st: structuredClone(cur.st), fotos: cur.fotos.map(f => ({ ...f })) };
  const r = await actualizar(cur.id, r => {
    const cambio = huella(r.st, r.fotos) !== huella(snap.st, snap.fotos);
    if (!cambio && !nuevoEstado) { r.st.paso = snap.st.paso; return r; }
    const subidas = new Map((r.fotos || []).map(f => [f.id, f.subida]));
    r.st = snap.st;
    r.fotos = snap.fotos.map(f => ({ ...f, subida: subidas.get(f.id) || false }));
    if (cambio) r.actualizado = ahora();
    if (nuevoEstado) r.estado = nuevoEstado;
    else if (r.estado === "enviada" || r.estado === "error") r.estado = "pendiente";
    if (nuevoEstado === "pendiente") r.error = "";
    return r;
  });
  if (r) { estadoCur = r.estado; cabecera(); }
}

async function abrir(id) {
  const r = await DB.una(id); if (!r) return toast("No se encontró la valoración");
  cur = { id: r.id, st: r.st, fotos: r.fotos || [], consecutivo: r.consecutivo || "" };
  ["peligros", "est", "noest", "estd", "noestd", "recs", "anexos"].forEach(k => cur.st[k] = cur.st[k] || {});
  if (!cur.st.firmas || !cur.st.firmas.length) cur.st.firmas = [firmaPerfil()];
  estadoCur = r.estado;
  mostrar("editor"); pintar(); cabecera(); ir(cur.st.paso || 0, true);
  $("cerca").hidden = true;
}
$("b-volver").onclick = async () => { if (cur) { leer(); await guardar(); } cur = null; mostrar("inicio"); };

// Clasificación sugerida
function sugerencia() {
  const s = F.calc(ed());
  $("sug").innerHTML = `Sugerencia según los daños marcados: <span class="pill p-${s.hab}">${F.HAB[s.hab][1]} · ${F.HAB[s.hab][0]}</span> nivel de daño <b>${F.NIVEL[s.niv]}</b>${s.por.length ? ` por ${s.por.join(", ")}` : ""}. <button type="button" class="btn sm" id="b-usar">Usar sugerencia</button><span style="flex-basis:100%;font-size:12px;color:var(--suave)">El peor indicador manda. La clasificación final es criterio del profesional que firma.</span>`;
  $("b-usar").onclick = () => { ed().hab = s.hab; ed().nivel = s.niv; pintar(); guardar(); toast("Clasificación aplicada"); };
}

// Navegación por pasos
function ir(i, sinGuardar) {
  cur.st.paso = Math.max(0, Math.min(PASOS.length - 1, i));
  PASOS.forEach((p, j) => p.classList.toggle("on", j === cur.st.paso));
  document.querySelectorAll("#nav button").forEach((b, j) => b.classList.toggle("on", j === cur.st.paso));
  const pid = PASOS[cur.st.paso].id;
  if (pid === "p-prev") $("hoja").innerHTML = K.hoja({ ...ed(), fotos: cur.fotos }, "img/logo.jpg");
  if (pid === "p-rec") $("alcance-fijo").textContent = F.ALCANCE(K.fechaLarga(ed().v_fecha));
  if (pid === "p-clas") sugerencia();
  if (pid === "p-firmas") faltantes();
  $("b-ant").disabled = cur.st.paso === 0; $("b-sig").disabled = cur.st.paso === PASOS.length - 1;
  window.scrollTo({ top: 0 });
  if (!sinGuardar) guardar();
}
$("nav").onclick = e => { const b = e.target.closest("button"); if (b) { leer(); ir(+b.dataset.i); } };
$("b-ant").onclick = () => { leer(); ir(cur.st.paso - 1); };
$("b-sig").onclick = () => { leer(); ir(cur.st.paso + 1); };

const ved = $("v-editor");
ved.addEventListener("input", e => {
  if (!cur) return;
  const t = e.target;
  if (t.type === "file") return;
  if (t.dataset.fi !== undefined) ed().firmas[+t.dataset.fi][t.dataset.fk] = t.value;
  else if (t.dataset.fo !== undefined) cur.fotos[+t.dataset.fo][t.dataset.fk] = t.value;
  else leer();
  if (t.id === "edif" || t.id === "dir" || t.id === "mpio") cabecera();
  guardarPronto();
});
ved.addEventListener("change", e => {
  if (!cur || e.target.type === "file") return;
  if (e.target.dataset.fi === undefined && e.target.dataset.fo === undefined) leer();
  guardarPronto();
  if (PASOS[cur.st.paso].id === "p-clas") sugerencia();
});
ved.addEventListener("click", e => {
  if (!cur) return;
  const q = e.target.closest("[data-quita]"); if (q) { ed().firmas.splice(+q.dataset.quita, 1); firmasUI(); guardar(); }
  const qf = e.target.closest("[data-qf]");
  if (qf) {
    if (qf.dataset.conf !== "1") { qf.dataset.conf = "1"; qf.textContent = "¿Quitar? Pulse otra vez"; return; }
    cur.fotos.splice(+qf.dataset.qf, 1); fotosUI(); guardar();
  }
  const f = e.target.closest("[data-f]");
  if (f) { const ta = $("analisis"); ta.value = (ta.value.trim() ? ta.value.trim() + " " : "") + K.frase(+f.dataset.f); leer(); guardar(); }
});
$("b-firma").onclick = () => { ed().firmas.push({ n: "", p: "", c: "", m: "", t: "Gestión del Riesgo" }); firmasUI(); guardar(); };
$("b-asunto").onclick = () => { leer(); $("asunto").value = K.proponerAsunto(ed()); leer(); guardar(); };
$("b-concl").onclick = () => {
  leer();
  if ($("conclusiones").value.trim() && $("b-concl").dataset.conf !== "1") { $("b-concl").dataset.conf = "1"; $("b-concl").textContent = "Reemplaza el texto actual: pulse otra vez"; return; }
  $("b-concl").dataset.conf = ""; $("b-concl").textContent = "Proponer conclusiones";
  $("conclusiones").value = K.proponerConclusiones(ed()); leer(); guardar(); toast("Conclusiones propuestas; revíselas");
};

// ---------- GPS y aviso de cercanía ----------
let ultimoFix = null;
function gpsInfo() {
  const st = ed();
  $("gps-info").textContent = st.lat ? `Lat ${(+st.lat).toFixed(6)}, Lon ${(+st.lon).toFixed(6)} · precisión ±${Math.round(st.gps_prec || 0)} m` : "Sin punto GPS.";
}
$("b-gps").onclick = () => {
  if (!navigator.geolocation) return toast("Este dispositivo no tiene GPS disponible");
  const b = $("b-gps"); b.disabled = true; b.textContent = "Buscando…";
  let mejor = null, id = null;
  const fin = () => {
    if (id !== null) navigator.geolocation.clearWatch(id); clearTimeout(tm); b.disabled = false; b.textContent = "Tomar GPS";
    if (!mejor) return toast("No se obtuvo el punto. Revise que la ubicación esté activada.", 4000);
    const { latitude: lat, longitude: lon, accuracy, altitude } = mejor.coords;
    const o = aOrigenNacional(lat, lon), st = ed();
    Object.assign(st, { lat: lat.toFixed(7), lon: lon.toFixed(7), gps_prec: Math.round(accuracy), norte: o.norte.toFixed(2), este: o.este.toFixed(2),
      coord_fuente: `GPS del celular (precisión ±${Math.round(accuracy)} m)` });
    if (altitude != null) st.alt = Math.round(altitude);
    ultimoFix = { lat, lon, norte: st.norte, este: st.este, t: Date.now() };
    pintar(); guardar();
    toast(accuracy > C.GPS_PRECISION_OK_M ? `Punto tomado con precisión baja (±${Math.round(accuracy)} m). Si puede, repítalo a cielo abierto.` : "Punto GPS tomado", 3500);
    cercania(lat, lon);
  };
  const tm = setTimeout(fin, 20000);
  id = navigator.geolocation.watchPosition(p => {
    if (!mejor || p.coords.accuracy < mejor.coords.accuracy) mejor = p;
    $("gps-info").textContent = `Afinando… ±${Math.round(p.coords.accuracy)} m`;
    if (p.coords.accuracy <= C.GPS_PRECISION_OK_M / 2) fin();
  }, err => { if (!mejor) { clearTimeout(tm); navigator.geolocation.clearWatch(id); id = null; b.disabled = false; b.textContent = "Tomar GPS"; toast(err.code === 1 ? "Permiso de ubicación negado" : "No se pudo leer el GPS", 3500); } },
  { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
};
async function cercania(lat, lon) {
  const aqui = { lat, lon }, cerca = [];
  for (const c of cache.conceptos || []) {
    if (!c.lat || !c.lon || c.id === cur.id) continue;
    const d = distM(aqui, { lat: +c.lat, lon: +c.lon });
    if (d <= C.RADIO_CERCANIA_M) cerca.push(`${c.consecutivo || "sin consecutivo"} · ${c.edif || c.dir || ""} (${c.evaluador_nombre || "otro evaluador"}, ${Math.round(d)} m)`);
  }
  for (const r of await DB.todas()) {
    if (r.id === cur.id || !r.st.lat) continue;
    const d = distM(aqui, { lat: +r.st.lat, lon: +r.st.lon });
    if (d <= C.RADIO_CERCANIA_M && !(cache.conceptos || []).some(c => c.id === r.id)) cerca.push(`${r.st.edif || r.st.dir || "valoración local"} en este dispositivo (${Math.round(d)} m)`);
  }
  const el = $("cerca");
  el.hidden = !cerca.length;
  el.innerHTML = cerca.length ? `<b>Ya hay ${cerca.length === 1 ? "una valoración" : cerca.length + " valoraciones"} a menos de ${C.RADIO_CERCANIA_M} m:</b><br>${cerca.map(esc).join("<br>")}<br>Revise que no sea la misma edificación antes de seguir.` : "";
}

// ---------- Fotos ----------
function reducir(file) {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(file), im = new Image();
    im.onerror = () => { URL.revokeObjectURL(url); ko(new Error("imagen")); };
    im.onload = () => {
      const k = Math.min(1, C.FOTO_MAX_PX / Math.max(im.naturalWidth, im.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      ok(c.toDataURL("image/jpeg", C.FOTO_CALIDAD));
    };
    im.src = url;
  });
}
async function agregarFotos(files) {
  const fix = ultimoFix && Date.now() - ultimoFix.t < 5 * 60000 ? ultimoFix : null;
  let n = 0;
  for (const file of files) {
    try { cur.fotos.push({ id: uuid(), src: await reducir(file), d: "", n: fix ? fix.norte : "", e: fix ? fix.este : "", lat: fix ? fix.lat : "", lon: fix ? fix.lon : "", subida: false }); n++; }
    catch (err) { toast("No se pudo leer " + file.name); }
  }
  fotosUI(); await guardar();
  if (n) toast(n === 1 ? "Foto agregada" : `${n} fotos agregadas`);
}
$("f-fotos").onchange = e => { agregarFotos([...e.target.files]); e.target.value = ""; };
$("f-camara").onchange = e => { agregarFotos([...e.target.files]); e.target.value = ""; };

// ---------- Concepto: Word, PDF, texto, PTI, borrador ----------
let logoData = "img/logo.jpg";
fetch("img/logo.jpg").then(r => r.blob()).then(b => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); }))
  .then(d => { logoData = d; }).catch(() => {});
function bajar(blob, nombre) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const stCompleto = () => ({ ...ed(), fotos: cur.fotos, consecutivo: cur.consecutivo });
$("b-word").onclick = () => { leer(); bajar(new Blob(["﻿", K.wordHtml(stCompleto(), logoData)], { type: "application/msword" }), K.nombreArchivo(stCompleto(), "doc")); toast("Word descargado"); };
$("b-imp").onclick = () => { leer(); ir(PASOS.findIndex(p => p.id === "p-prev")); setTimeout(() => window.print(), 200); };
async function copiar(t, ok) {
  try { await navigator.clipboard.writeText(t); toast(ok); }
  catch (e) { const ta = $("pti_fila"); ta.hidden = false; ta.value = t; ta.select(); toast("Seleccionado: use Ctrl+C"); }
}
$("b-copiar").onclick = $("b-copiar2").onclick = () => { leer(); copiar(K.textoPlano(stCompleto()), "Texto del concepto copiado"); };
$("b-imp2").onclick = () => $("b-imp").onclick();
$("b-pti").onclick = () => { leer(); copiar(K.filaPTI(ed()), "Fila copiada para el registro del PTI"); };
function exportar() { leer(); bajar(new Blob([JSON.stringify({ formato: "valoracion-estructuras/1", st: ed(), fotos: cur.fotos })], { type: "application/json" }), K.nombreArchivo(stCompleto(), "json")); toast("Borrador exportado (con fotos)"); }

// Faltantes antes de enviar
function faltantes() {
  const st = ed(), f = [];
  if (!st.mpio) f.push("municipio");
  if (!st.edif && !st.dir) f.push("nombre o dirección de la edificación");
  if (!st.v_fecha) f.push("fecha de la visita");
  if (!st.hab) f.push("clasificación de habitabilidad");
  if (!st.conclusiones || !st.conclusiones.trim()) f.push("conclusiones");
  if (!(st.firmas || []).some(x => x.n && x.n.trim())) f.push("profesional que firma");
  $("faltan").textContent = f.length ? "Falta: " + f.join(", ") + "." : "";
  return f;
}
$("b-enviar").onclick = async () => {
  leer();
  if (faltantes().length) return toast("Complete lo que falta antes de enviar", 3000);
  await guardar("pendiente");
  toast(navigator.onLine ? "Enviando…" : "Quedó por enviar; se manda cuando haya señal", 3000);
  sincronizar(true);
};

// Acciones del editor en la barra superior
function accionesEditor() {
  $("h-acciones").innerHTML = `<button class="hbtn" type="button" id="b-exp">Exportar borrador</button><button class="hbtn" type="button" id="b-ejemplo">Llenar con ejemplo</button>`;
  $("b-exp").onclick = exportar;
  $("b-ejemplo").onclick = () => {
    if ($("b-ejemplo").dataset.conf !== "1") { $("b-ejemplo").dataset.conf = "1"; $("b-ejemplo").textContent = "Reemplaza lo escrito: pulse otra vez"; return; }
    cur.st = { ...cur.st, ...EJEMPLO(), ejemplo: true }; pintar(); guardar(); cabecera(); toast("Ejemplo cargado (datos ficticios; no se puede enviar)", 3500);
    accionesEditor();
  };
}
const mostrarBase = mostrar;
mostrar = v => { mostrarBase(v); if (v === "editor") accionesEditor(); };

const EJEMPLO = () => ({
  ct_num: "", ct_fecha: hoyISO(), asunto: "", doc_tipo: "SAIA", doc_num: "EJEMPLO-0001", doc_fecha: "2026-11-04", asig_por: "Subdirector SCORE", asig_medio: "Correo", asig_fecha: "2026-11-06",
  sol_texto: "Solicitamos visita técnica porque después del sismo aparecieron grietas en los muros del primer piso y en el andén.",
  pet_tipo: "Comunidad", pet_nombre: "Junta de Acción Comunal (ejemplo)", pet_calidad: "Representante de la comunidad",
  mpio: "Santa Rosa de Cabal", barrio: "Barrio de ejemplo", zona: "Urbano", edif: "Escuela de ejemplo", dir: "Calle 0 # 0-00", coord_fuente: "GPS",
  v_fecha: "2026-11-10", v_hora: "09:30", insp_tipo: "Completa", ocup: "Ocupada", uso: "Educativo", tenencia: "Pública", pisos: "2", sotanos: "0",
  anio: "década de 1970", sis: "Mampostería no reforzada", entre: "Losa maciza", sopcub: "Estructura de madera", cub: "Teja de barro", morf: "Ladera",
  desc_edif: "Datos de ejemplo para ver cómo queda el concepto.",
  aspectos: "Se observaron fisuras diagonales en los muros de mampostería del primer piso, en las esquinas de puertas y ventanas, y desprendimiento parcial de pañete. El antepecho del segundo piso presenta grietas y separación del muro.",
  peligros: { grietas_terreno: true }, est: { muros_port: "M", columnas: "NL", cimentacion: "NL" }, estd: { muros_port: "fisuras diagonales en esquinas de vanos del primer piso" },
  noest: { fachada: "S", cubiertas: "M" }, noestd: { fachada: "antepecho del segundo piso agrietado y separado" },
  recs: { evalest: true, noest: true, testigos: true, licencia: true, t_diger: true }, nivel: "MODERADO", hab: "AMARILLO"
});

// ---------- Sincronización ----------
function aplanar(r) {
  const st = r.st, o = { id: r.id, solicitud_id: r.solicitud_id || "", creado: r.creado, actualizado: r.actualizado };
  CAMPOS.forEach(k => { o[k] = st[k] ?? ""; });
  ["lat", "lon", "gps_prec", "hab"].forEach(k => { o[k] = st[k] ?? ""; });
  F.PELIGROS.forEach(([k]) => { o["pg_" + k] = st.peligros && st.peligros[k] ? "Sí" : ""; });
  F.EST.forEach(([k]) => { o["est_" + k] = (st.est || {})[k] || ""; o["estd_" + k] = (st.estd || {})[k] || ""; });
  F.NOEST.forEach(([k]) => { o["noest_" + k] = (st.noest || {})[k] || ""; o["noestd_" + k] = (st.noestd || {})[k] || ""; });
  o.recomendaciones = F.RECS.filter(([k]) => st.recs && st.recs[k]).map(([k]) => k).join(", ");
  o.anexos = F.ANEXOS.filter(a => st.anexos && st.anexos[a]).join(", ");
  o.firmas = JSON.stringify(st.firmas || []);
  o.n_fotos = (r.fotos || []).length;
  return o;
}
let sincronizando = false;
async function sincronizar(manual) {
  if (LOCAL || !sesion || sincronizando) return;
  if (!navigator.onLine) { if (manual) toast("Sin señal: se sincroniza cuando vuelva"); return; }
  sincronizando = true; $("b-sync").disabled = true; $("sync-info").textContent = "Sincronizando…";
  let enviadas = 0, fallas = 0;
  try {
    if (cur) { leer(); await guardar(); }
    const pend = (await DB.todas()).filter(r => r.estado === "pendiente");
    for (const r0 of pend) {
      try { if (await enviarUna(r0)) enviadas++; }
      catch (e) {
        if (e.code === "SESION") break;
        fallas++;
        await actualizar(r0.id, r => { r.error = e.message; if (e.code !== "RED") r.estado = "error"; });
        if (e.code === "RED") break;
      }
    }
    const [a, c] = await Promise.all([api("asignadas"), api("conceptos")]);
    cache = { asignadas: a.asignadas || [], conceptos: c.conceptos || [], sync: ahora() };
    ponerLS(KC, cache);
    if (manual || enviadas || fallas) toast(fallas ? `${enviadas} enviada(s), ${fallas} con problema. Revise la lista.` : enviadas ? `${enviadas} valoración(es) enviada(s)` : "Todo está al día", 3500);
  } catch (e) {
    if (e.code !== "SESION" && manual) toast("No se pudo sincronizar: " + e.message, 4000);
  } finally {
    sincronizando = false; $("b-sync").disabled = false;
    if (vistaActual === "inicio") pintarInicio(); else infoSync();
    if (cur) { const r = await DB.una(cur.id); if (r) { estadoCur = r.estado; cur.consecutivo = r.consecutivo || ""; cur.fotos.forEach(f => { const g = (r.fotos || []).find(x => x.id === f.id); if (g) f.subida = g.subida; }); cabecera(); if (PASOS[cur.st.paso].id === "p-danos") fotosUI(); } }
  }
}
async function enviarUna(r) {
  const marca = r.actualizado;
  const j = await api("guardar", { ficha: aplanar(r), fotos_ids: (r.fotos || []).map(f => f.id) });
  await actualizar(r.id, x => { x.consecutivo = j.consecutivo; x.carpeta = j.carpeta || ""; });
  for (const f of (r.fotos || []).filter(f => !f.subida)) {
    const i = r.fotos.indexOf(f) + 1;
    await api("foto", { id: r.id, foto_id: f.id, n: i, b64: f.src.split(",")[1], d: f.d || "", norte: f.n || "", este: f.e || "", lat: f.lat || "", lon: f.lon || "" });
    await actualizar(r.id, x => { const g = (x.fotos || []).find(y => y.id === f.id); if (g) g.subida = true; });
  }
  const st = { ...r.st, fotos: r.fotos || [] };
  await api("documento", { id: r.id, nombre: K.nombreArchivo({ ...r.st, consecutivo: j.consecutivo }, "doc"), html: K.wordHtml(st, logoData) });
  await actualizar(r.id, x => {
    x.error = "";
    if (x.actualizado === marca && (x.fotos || []).every(f => f.subida)) { x.estado = "enviada"; x.enviada = ahora(); }
  });
  return true;
}

// Limpieza: valoraciones enviadas hace más de BORRAR_ENVIADAS_DIAS
async function limpiar() {
  const lim = Date.now() - C.BORRAR_ENVIADAS_DIAS * 86400000;
  for (const r of await DB.todas()) if (r.estado === "enviada" && r.enviada && Date.parse(r.enviada) < lim) await DB.quitar(r.id);
}

// ---------- Arranque ----------
async function arrancar() {
  $("h-sub").textContent = `SCORE · CARDER${C.ESPACIO ? " · " + C.ESPACIO : ""} · v${C.VERSION}`;
  $("aviso-local").hidden = !LOCAL;
  red(); window.addEventListener("online", () => { red(); sincronizar(); }); window.addEventListener("offline", red);
  if (!(await DB.disponible())) toast("Este navegador no permite guardar en el dispositivo (¿ventana privada?). No cierre la página sin descargar el Word.", 6000);
  await limpiar();
  if (!LOCAL && !sesion) mostrar("ingreso"); else mostrar("inicio");
  if (!LOCAL) { sincronizar(); setInterval(sincronizar, C.SYNC_MIN * 60000); }
  if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("sw.js").catch(() => {});
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && cur) { leer(); guardar(); } });
arrancar();
})();
