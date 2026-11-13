// App de valoración de estructuras: ingreso, visitas, mapa, tablero, envíos y perfil; ficha por pasos, fotos, GPS,
// trabajo sin señal, envío a Apps Script y flujo proyecta → revisa y suscribe.
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
let cache = { asignadas: [], conceptos: [], revisores: [], sync: "", ...leerLS(KC, {}) };
const esRevisor = () => !!sesion && (sesion.rol === "revisor" || sesion.rol === "admin");
const ROLES = { proyectista: "Proyecta y diligencia", evaluador: "Proyecta y diligencia", revisor: "Revisa y suscribe", coordinador: "Coordinación (consulta)", admin: "Administración, revisión y suscripción" };

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
let recargaPendiente = false; // hay versión nueva de la app esperando a que salga del editor
function mostrar(v) {
  if (recargaPendiente && v !== "editor") { location.reload(); return; }
  vistaActual = v;
  document.querySelectorAll(".vista").forEach(s => s.classList.toggle("on", s.id === "v-" + v));
  $("h-acciones").innerHTML = "";
  const dentro = v !== "ingreso";
  $("tabs").hidden = !dentro;
  $("h-sesion").hidden = !dentro || LOCAL;
  const tab = v === "editor" ? "inicio" : v;
  document.querySelectorAll("#tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  ["b-envios", "b-perfil"].forEach(id => $(id).classList.toggle("activo", "b-" + v === id));
  if (v === "inicio") pintarInicio();
  if (v === "mapa") pintarMapa();
  if (v === "tablero") pintarTablero();
  if (v === "envios") pintarEnvios();
  if (v === "perfil") pintarPerfil();
  contadores();
  window.scrollTo({ top: 0 });
}
$("tabs").onclick = async e => {
  const b = e.target.closest("[data-tab]"); if (!b) return;
  if (cur) { leer(); await guardar(); cur = null; }
  mostrar(b.dataset.tab);
};
$("b-envios").onclick = async () => { if (cur) { leer(); await guardar(); cur = null; } mostrar("envios"); };
$("b-perfil").onclick = async () => { if (cur) { leer(); await guardar(); cur = null; } mostrar("perfil"); };
async function contadores() {
  if (LOCAL || !sesion) return;
  const todas = await DB.todas();
  const pend = todas.filter(r => r.estado === "pendiente" || r.estado === "error").length;
  const dev = (cache.conceptos || []).filter(c => c.evaluador === sesion.correo && c.estado === "Devuelta").length
    + (esRevisor() ? porRevisar().length : 0);
  $("n-pend").hidden = !pend; $("n-pend").textContent = pend;
  $("n-envios").hidden = !dev; $("n-envios").textContent = dev;
  $("b-envios").title = dev ? `${dev} para atender (devueltas o por revisar)` : "Envíos";
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
  sesion = null; cache = { asignadas: [], conceptos: [], revisores: [], sync: "" };
  try { localStorage.removeItem(KS); localStorage.removeItem(KC); } catch (e) {}
  mostrar("ingreso");
}

// ---------- Inicio ----------
const ESTADOS = { borrador: "Borrador", pendiente: "Por enviar", enviada: "Enviada", error: "Con error" };
function porRevisar() {
  if (!esRevisor()) return [];
  return (cache.conceptos || []).filter(c => c.estado === "En revisión" && c.evaluador !== sesion.correo && (!c.suscribe_correo || c.suscribe_correo === sesion.correo));
}
async function pintarInicio() {
  $("c-asignadas").hidden = LOCAL;
  const rev = porRevisar();
  $("c-revisar").hidden = !esRevisor();
  $("l-revisar").innerHTML = rev.length ? rev.map(c => `<div class="item"><div><div class="t">${esc(c.consecutivo)} · ${esc(c.edif || c.dir || "Sin nombre")} · ${esc(c.mpio || "")}</div>
      <div class="s">Proyectó ${esc(c.evaluador_nombre || c.evaluador)}${c.v_fecha ? " · visita del " + esc(K.fechaLarga(c.v_fecha)) : ""}${c.n_fotos ? ` · ${esc(c.n_fotos)} foto(s)` : ""}</div></div>
      <div class="acc">${c.hab ? `<span class="pill p-${esc(c.hab)}">${F.HAB[c.hab] ? F.HAB[c.hab][1] : esc(c.hab)}</span>` : ""}<button class="btn sm" type="button" data-srv="${esc(c.id)}">Revisar</button></div></div>`).join("")
    : `<div class="vacio">No tiene valoraciones pendientes de revisión.</div>`;
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
      <div class="s">${r.es_revision ? "Revisión · proyectó " + esc(r.evaluador_nombre || "otra persona") + " · " : ""}${r.consecutivo ? esc(r.consecutivo) + " · " : ""}${st.v_fecha ? "visita del " + esc(K.fechaLarga(st.v_fecha)) + " · " : ""}${(r.fotos || []).length} foto(s)${r.estado === "pendiente" && fotosPend ? `, ${fotosPend} sin subir` : ""}${r.error ? " · " + esc(r.error) : ""}</div></div>
      <div class="acc">${st.hab ? `<span class="pill p-${st.hab}">${F.HAB[st.hab][1]}</span>` : ""}<span class="pill p-${r.estado}">${ESTADOS[r.estado] || r.estado}</span>${pillRevision(r.revision)}
      <button class="btn sm" type="button" data-abrir="${r.id}">Abrir</button>
      ${r.estado === "borrador" || r.estado === "enviada" ? `<button class="btn sm sec" type="button" data-borrar="${r.id}">${r.estado === "enviada" ? "Quitar del dispositivo" : "Borrar"}</button>` : ""}</div></div>`;
  }).join("") : `<div class="vacio">Aún no hay valoraciones en este dispositivo.</div>`;
  infoSync();
}
const CLASE_REV = { "En revisión": "revision", "Devuelta": "devuelta", "Aprobada": "aprobada" };
const pillRevision = rv => rv && rv.estado ? `<span class="pill p-${CLASE_REV[rv.estado] || "revision"}">${esc(rv.estado)}</span>` : "";
$("l-revisar").onclick = e => { const b = e.target.closest("[data-srv]"); if (b) abrirDelServidor(b.dataset.srv, b); };
function infoSync() {
  if (LOCAL) { $("sync-info").textContent = ""; return; }
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
      anexos: { "Acta de visita": true, "Registro fotográfico": true }, hab: "", firmas: [firmaPerfil()], paso: 0,
      suscribe_correo: (cache.revisores || [])[0] ? cache.revisores[0].correo : "", ...pre
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
  .map(e => e.id).filter(id => id && !["copia_aux", "obs_revision_txt"].includes(id) && !/^(estd|noestd)_/.test(id));

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
function opcionesSuscribe() {
  const l = cache.revisores || [];
  $("suscribe_correo").innerHTML = `<option value="">Lo define quien apruebe</option>` + l.map(r => `<option value="${esc(r.correo)}">${esc(r.nombre || r.correo)}${r.cargo ? " · " + esc(r.cargo) : ""}</option>`).join("");
  $("suscribe_correo").closest(".g").hidden = LOCAL;
  $("suscribe-local").hidden = !LOCAL;
}
// Datos de quien suscribe: el revisor que aprobó; si no, el elegido; en modo local, los escritos a mano.
function suscriptor(st, r) {
  if (LOCAL) return st.sus_n ? { n: st.sus_n, p: st.sus_p || "", c: st.sus_c || "", m: st.sus_m || "" } : null;
  if (r && r.suscribe_aprobado) return r.suscribe_aprobado;
  const v = (cache.revisores || []).find(x => x.correo === st.suscribe_correo);
  return v ? { n: v.nombre, p: v.profesion, c: v.cargo, m: v.matricula } : null;
}
function pintar() {
  const st = ed();
  opcionesSuscribe();
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
  const rv = cur.revision || {};
  const revisando = !!cur.es_revision;
  $("c-revision").hidden = !revisando;
  $("b-enviar").hidden = !enviable || revisando;
  $("b-enviar").textContent = estadoCur === "pendiente" ? "Enviar ahora" : rv.estado === "Devuelta" ? "Reenviar a revisión" : "Enviar a revisión";
  $("b-enviar").disabled = estadoCur === "enviada";
  if (revisando) $("envio-hint").textContent = "Esta valoración la proyectó " + (cur.evaluador_nombre || "otra persona") + ". Use «Aprobar y suscribir» o «Devolver con observaciones».";
  else if (!LOCAL && !st.ejemplo && estadoCur !== "enviada") $("envio-hint").textContent = "Al enviarla, la app la manda a la hoja y las fotos a Drive en cuanto haya señal, y queda «En revisión» para quien suscribe.";
  const o = $("ed-obs");
  o.hidden = !(rv.estado === "Devuelta" || (rv.estado === "Aprobada" && rv.obs));
  o.innerHTML = rv.estado === "Devuelta" ? `<b>Devuelta por ${esc(rv.revisor_nombre || "el revisor")}${rv.revisado ? " el " + esc(K.fechaLarga(rv.revisado)) : ""}:</b> ${esc(rv.obs)}<br>Corrija y use «Reenviar a revisión» en el paso 8.`
    : rv.estado === "Aprobada" ? `<b>Aprobada por ${esc(rv.revisor_nombre || "")}.</b> Observación: ${esc(rv.obs)}` : "";
  const ep = $("ed-estado");
  if (rv.estado) { ep.className = "pill p-" + (CLASE_REV[rv.estado] || "revision"); ep.textContent = estadoCur === "enviada" ? rv.estado : ESTADOS[estadoCur]; }
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
  cur = { id: r.id, st: r.st, fotos: r.fotos || [], consecutivo: r.consecutivo || "", revision: r.revision || null, es_revision: !!r.es_revision,
    evaluador_nombre: r.evaluador_nombre || "", suscribe_aprobado: r.suscribe_aprobado || null };
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
  if (pid === "p-prev") $("hoja").innerHTML = K.hoja(stCompleto(), "img/logo.jpg");
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

// ---------- Concepto: Word, PDF, texto y borrador ----------
let logoData = "img/logo.jpg";
fetch("img/logo.jpg").then(r => r.blob()).then(b => new Promise(ok => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(b); }))
  .then(d => { logoData = d; }).catch(() => {});
function bajar(blob, nombre) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
const paraConcepto = (st, r, fotos, consecutivo) => ({ ...st, fotos, consecutivo, suscribe: suscriptor(st, r),
  revision_estado: r && r.revision ? r.revision.estado : "", sin_revision: LOCAL });
const stCompleto = () => paraConcepto(ed(), cur, cur.fotos, cur.consecutivo);
$("b-word").onclick = () => { leer(); bajar(new Blob(["﻿", K.wordHtml(stCompleto(), logoData)], { type: "application/msword" }), K.nombreArchivo(stCompleto(), "doc")); toast("Word descargado"); };
$("b-imp").onclick = () => { leer(); ir(PASOS.findIndex(p => p.id === "p-prev")); setTimeout(() => window.print(), 200); };
async function copiar(t, ok) {
  try { await navigator.clipboard.writeText(t); toast(ok); }
  catch (e) { const ta = $("copia_aux"); ta.hidden = false; ta.value = t; ta.select(); toast("Seleccionado: use Ctrl+C"); }
}
$("b-copiar").onclick = $("b-copiar2").onclick = () => { leer(); copiar(K.textoPlano(stCompleto()), "Texto del concepto copiado"); };
$("b-imp2").onclick = () => $("b-imp").onclick();
function exportar() { leer(); bajar(new Blob([JSON.stringify({ formato: "valoracion-estructuras/1", st: ed(), fotos: cur.fotos })], { type: "application/json" }), K.nombreArchivo(stCompleto(), "json")); toast("Borrador exportado (con fotos)"); }

// Faltantes antes de enviar
function faltantes() {
  const st = ed(), f = [];
  if (!st.mpio) f.push("municipio");
  if (!st.edif && !st.dir) f.push("nombre o dirección de la edificación");
  if (!st.v_fecha) f.push("fecha de la visita");
  if (!st.hab) f.push("clasificación de habitabilidad");
  if (!st.conclusiones || !st.conclusiones.trim()) f.push("conclusiones");
  if (!(st.firmas || []).some(x => x.n && x.n.trim())) f.push("quién proyecta");
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
async function decidir(decision) {
  leer();
  const obs = $("obs_revision_txt").value.trim();
  if (decision === "devolver" && !obs) { $("obs_revision_txt").focus(); return toast("Escriba las observaciones para devolverla", 3000); }
  if (decision === "aprobar" && faltantes().length) return toast("Complete lo que falta antes de aprobar", 3000);
  await guardar("pendiente");
  await actualizar(cur.id, r => { r.decision = { d: decision, obs }; });
  toast(navigator.onLine ? (decision === "aprobar" ? "Aprobando…" : "Devolviendo…") : "Quedó por enviar; se manda cuando haya señal", 3000);
  sincronizar(true);
}
$("b-aprobar").onclick = () => decidir("aprobar");
$("b-devolver").onclick = () => decidir("devolver");

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
  o.suscribe_correo = st.suscribe_correo || "";
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
    const [a, c, rv] = await Promise.all([api("asignadas"), api("conceptos"), api("revisores")]);
    cache = { asignadas: a.asignadas || [], conceptos: c.conceptos || [], revisores: rv.revisores || [], sync: ahora() };
    ponerLS(KC, cache);
    await revisionesLocales();
    if (manual || enviadas || fallas) toast(fallas ? `${enviadas} enviada(s), ${fallas} con problema. Revise la lista.` : enviadas ? `${enviadas} valoración(es) enviada(s)` : "Todo está al día", 3500);
  } catch (e) {
    if (e.code !== "SESION" && manual) toast("No se pudo sincronizar: " + e.message, 4000);
  } finally {
    sincronizando = false; $("b-sync").disabled = false;
    if (vistaActual === "inicio") pintarInicio(); else infoSync();
    if (vistaActual === "envios") pintarEnvios();
    if (vistaActual === "tablero") pintarTablero();
    if (vistaActual === "mapa" && mapa) marcadores();
    contadores();
    if (cur) { const r = await DB.una(cur.id); if (r) { estadoCur = r.estado; cur.consecutivo = r.consecutivo || ""; cur.revision = r.revision || null; cur.suscribe_aprobado = r.suscribe_aprobado || null; cur.es_revision = !!r.es_revision; cur.fotos.forEach(f => { const g = (r.fotos || []).find(x => x.id === f.id); if (g) f.subida = g.subida; }); cabecera(); if (PASOS[cur.st.paso].id === "p-danos") fotosUI(); } }
  }
}
async function enviarUna(r) {
  const marca = r.actualizado;
  const j = await api("guardar", { ficha: aplanar(r), fotos_ids: (r.fotos || []).map(f => f.id) });
  let revision = j.revision || null, susAprob = null;
  if (revision && revision.estado === "Aprobada" && sesion && revision.suscribe_correo === sesion.correo) susAprob = { n: sesion.nombre, p: sesion.profesion, c: sesion.cargo, m: sesion.matricula };
  await actualizar(r.id, x => { x.consecutivo = j.consecutivo; x.carpeta = j.carpeta || ""; if (revision && !x.es_revision) x.revision = revision; if (susAprob) x.suscribe_aprobado = susAprob; });
  for (const f of (r.fotos || []).filter(f => !f.subida)) {
    const i = r.fotos.indexOf(f) + 1;
    await api("foto", { id: r.id, foto_id: f.id, n: i, b64: f.src.split(",")[1], d: f.d || "", norte: f.n || "", este: f.e || "", lat: f.lat || "", lon: f.lon || "" });
    await actualizar(r.id, x => { const g = (x.fotos || []).find(y => y.id === f.id); if (g) g.subida = true; });
  }
  // Revisión: aprobar o devolver después de guardar las correcciones del revisor.
  if (r.decision) {
    const d = await api("revisar", { id: r.id, decision: r.decision.d, obs: r.decision.obs });
    revision = d.revision;
    await actualizar(r.id, x => { x.revision = d.revision; if (d.suscribe) x.suscribe_aprobado = d.suscribe; delete x.decision; });
    r = await DB.una(r.id);
  } else if (!r.es_revision) r = await DB.una(r.id);
  const st = paraConcepto(r.st, r, r.fotos || [], j.consecutivo);
  await api("documento", { id: r.id, nombre: K.nombreArchivo(st, "doc"), html: K.wordHtml(st, logoData) });
  await actualizar(r.id, x => {
    x.error = "";
    if (x.actualizado === marca && (x.fotos || []).every(f => f.subida)) { x.estado = "enviada"; x.enviada = ahora(); x.srv_actualizado = marca; }
  });
  return true;
}

// ---------- Revisiones: estado desde el servidor y descarga completa ----------
async function revisionesLocales() {
  const porId = new Map((cache.conceptos || []).map(c => [c.id, c]));
  for (const r of await DB.todas()) {
    const c = porId.get(r.id); if (!c) continue;
    // Otra persona cambió la valoración en el servidor (la corrigió quien proyecta o quien revisa) y aquí
    // no hay cambios sin enviar: se quita la copia vieja y se vuelve a descargar al abrirla.
    if (r.estado === "enviada" && r.srv_actualizado && c.actualizado && c.actualizado !== r.srv_actualizado) { await DB.quitar(r.id); continue; }
    const rv = { estado: c.estado || "", obs: c.obs_revision || "", revisor_nombre: c.revisor_nombre || "", revisado: c.revisado || "",
      suscribe_correo: c.suscribe_correo || "", suscribe_nombre: c.suscribe_nombre || "" };
    if (JSON.stringify(rv) === JSON.stringify(r.revision || {})) continue;
    await actualizar(r.id, x => {
      x.revision = rv;
      if (rv.estado === "Aprobada") {
        const v = (cache.revisores || []).find(y => y.correo === rv.suscribe_correo);
        if (v) x.suscribe_aprobado = { n: v.nombre, p: v.profesion, c: v.cargo, m: v.matricula };
      } else x.suscribe_aprobado = null;
      // Si el revisor ya decidió, quien revisaba deja de tenerla «en revisión» en su lista.
      if (x.es_revision && rv.estado !== "En revisión" && x.estado === "enviada") x.es_revision_cerrada = true;
    });
  }
}
// Reconstruye la ficha a partir de la fila de la hoja (inverso de aplanar).
function desaplanar(o) {
  const st = { peligros: {}, est: {}, noest: {}, estd: {}, noestd: {}, recs: {}, anexos: {}, paso: 0 };
  CAMPOS.forEach(k => { if (o[k] !== undefined && o[k] !== "") st[k] = String(o[k]); });
  ["lat", "lon", "gps_prec", "hab"].forEach(k => { if (o[k]) st[k] = String(o[k]); });
  F.PELIGROS.forEach(([k]) => { st.peligros[k] = o["pg_" + k] === "Sí"; });
  F.EST.forEach(([k]) => { st.est[k] = o["est_" + k] || ""; st.estd[k] = o["estd_" + k] || ""; });
  F.NOEST.forEach(([k]) => { st.noest[k] = o["noest_" + k] || ""; st.noestd[k] = o["noestd_" + k] || ""; });
  String(o.recomendaciones || "").split(",").map(x => x.trim()).filter(Boolean).forEach(k => { st.recs[k] = true; });
  F.ANEXOS.forEach(a => { st.anexos[a] = String(o.anexos || "").split(", ").includes(a); });
  try { st.firmas = JSON.parse(o.firmas || "[]"); } catch (e) { st.firmas = []; }
  if (!st.firmas.length) st.firmas = [{ n: (o.evaluador_nombre || "").toUpperCase(), p: "", c: "", m: "", t: "Gestión del Riesgo" }];
  st.suscribe_correo = o.suscribe_correo || "";
  return st;
}
async function abrirDelServidor(id, boton) {
  const local = await DB.una(id);
  if (local) return abrir(id);
  if (!navigator.onLine) return toast("Sin señal: para abrirla por primera vez se necesita conexión");
  const txt = boton ? boton.textContent : "";
  if (boton) { boton.disabled = true; boton.textContent = "Descargando…"; }
  try {
    const j = await api("ficha", { id });
    const o = j.ficha, fotos = [];
    for (const f of j.fotos || []) {
      if (boton) boton.textContent = `Foto ${fotos.length + 1} de ${j.fotos.length}…`;
      const b = await api("fotob64", { id, foto_id: f.foto_id });
      fotos.push({ id: String(f.foto_id), src: "data:image/jpeg;base64," + b.b64, d: f.descripcion || "", n: f.norte || "", e: f.este || "", lat: f.lat || "", lon: f.lon || "", subida: true });
    }
    const propia = o.evaluador === sesion.correo;
    const r = { id: String(o.id), estado: "enviada", creado: o.creado || o.recibido || ahora(), actualizado: o.actualizado || ahora(), enviada: ahora(), srv_actualizado: o.actualizado || "",
      consecutivo: o.consecutivo || "", solicitud_id: o.solicitud_id || "", fotos, st: desaplanar(o), es_revision: !propia,
      evaluador_nombre: o.evaluador_nombre || "", revision: { estado: o.estado || "", obs: o.obs_revision || "", revisor_nombre: o.revisor_nombre || "",
        revisado: o.revisado || "", suscribe_correo: o.suscribe_correo || "", suscribe_nombre: o.suscribe_nombre || "" } };
    if (r.revision.estado === "Aprobada") { const v = (cache.revisores || []).find(y => y.correo === r.revision.suscribe_correo); if (v) r.suscribe_aprobado = { n: v.nombre, p: v.profesion, c: v.cargo, m: v.matricula }; }
    await DB.poner(r);
    abrir(r.id);
  } catch (e) {
    if (e.code !== "SESION") toast("No se pudo descargar: " + e.message, 4000);
  } finally { if (boton && boton.isConnected) { boton.disabled = false; boton.textContent = txt; } }
}

// ---------- Envíos ----------
let filtroEnvios = "";
const FILTROS_ENVIOS = [["", "Todos"], ["pend", "Por enviar"], ["En revisión", "En revisión"], ["Devuelta", "Devueltas"], ["Aprobada", "Aprobadas"]];
async function pintarEnvios() {
  if (LOCAL || !sesion) { $("l-envios").innerHTML = `<div class="vacio">En modo local no hay envíos.</div>`; return; }
  const locales = await DB.todas(), porId = new Map(locales.map(r => [r.id, r]));
  const srv = (cache.conceptos || []).filter(c => c.evaluador === sesion.correo || (esRevisor() && c.revisor_nombre === sesion.nombre));
  const ids = new Set(srv.map(c => c.id));
  const filas = srv.map(c => ({ id: c.id, t: `${c.edif || c.dir || "Sin nombre"} · ${c.mpio || ""}`, cons: c.consecutivo, fecha: c.v_fecha, hab: c.hab,
      estado: c.estado, obs: c.obs_revision, quien: c.evaluador === sesion.correo ? (c.suscribe_nombre ? "Suscribe " + c.suscribe_nombre : "") : "Proyectó " + (c.evaluador_nombre || ""),
      doc: c.doc_url, local: porId.get(c.id), act: c.actualizado }))
    .concat(locales.filter(r => !ids.has(r.id) && r.estado !== "borrador" && !r.es_revision).map(r => ({ id: r.id, t: `${r.st.edif || r.st.dir || "Sin nombre"} · ${r.st.mpio || ""}`,
      cons: r.consecutivo, fecha: r.st.v_fecha, hab: r.st.hab, estado: "", local: r, act: r.actualizado })))
    .sort((a, b) => String(b.act || "").localeCompare(String(a.act || "")));
  const cuenta = k => k === "" ? filas.length : k === "pend" ? filas.filter(f => f.local && (f.local.estado === "pendiente" || f.local.estado === "error")).length : filas.filter(f => f.estado === k).length;
  $("e-filtro").innerHTML = FILTROS_ENVIOS.map(([k, t]) => `<label><input type="radio" name="ef" value="${esc(k)}"${k === filtroEnvios ? " checked" : ""}>${t} (${cuenta(k)})</label>`).join("");
  const vis = filas.filter(f => filtroEnvios === "" || (filtroEnvios === "pend" ? f.local && (f.local.estado === "pendiente" || f.local.estado === "error") : f.estado === filtroEnvios));
  $("l-envios").innerHTML = vis.length ? vis.map(f => {
    const pend = f.local && (f.local.estado === "pendiente" || f.local.estado === "error");
    return `<div class="item"><div><div class="t">${f.cons ? esc(f.cons) + " · " : ""}${esc(f.t)}</div>
      <div class="s">${f.fecha ? "visita del " + esc(K.fechaLarga(f.fecha)) : ""}${f.quien ? " · " + esc(f.quien) : ""}${f.doc ? ` · <a href="${esc(f.doc)}" target="_blank" rel="noopener">Word en Drive</a>` : ""}</div>
      ${f.estado === "Devuelta" && f.obs ? `<div class="obs">Observaciones: ${esc(f.obs)}</div>` : ""}${f.local && f.local.error ? `<div class="obs">${esc(f.local.error)}</div>` : ""}</div>
      <div class="acc">${f.hab && F.HAB[f.hab] ? `<span class="pill p-${f.hab}">${F.HAB[f.hab][1]}</span>` : ""}${pend ? `<span class="pill p-${f.local.estado}">${ESTADOS[f.local.estado]}</span>` : ""}${pillRevision({ estado: f.estado })}
      <button class="btn sm${f.estado === "Devuelta" ? "" : " sec"}" type="button" data-srv="${esc(f.id)}">${f.estado === "Devuelta" ? "Corregir" : "Abrir"}</button></div></div>`;
  }).join("") : `<div class="vacio">${filas.length ? "No hay envíos con ese filtro." : "Aún no ha enviado valoraciones."}</div>`;
}
$("e-filtro").onchange = e => { filtroEnvios = e.target.value; pintarEnvios(); };
$("l-envios").onclick = e => { const b = e.target.closest("[data-srv]"); if (b) abrirDelServidor(b.dataset.srv, b); };

// ---------- Mi perfil ----------
async function pintarPerfil() {
  const p = sesion || {};
  const fila = (k, v) => `<dt>${k}</dt><dd>${v ? esc(v) : '<span class="hint" style="margin:0">sin dato</span>'}</dd>`;
  $("p-datos").innerHTML = LOCAL ? `<p class="hint">Modo local: no hay ingreso ni perfil. Los datos de la firma se escriben en el paso 8 de cada valoración.</p>`
    : `<dl>${fila("Nombre", p.nombre)}${fila("Correo", p.correo)}${fila("Rol", ROLES[p.rol] || p.rol)}${fila("Profesión", p.profesion)}${fila("Cargo", p.cargo)}${fila("Matrícula profesional", p.matricula)}${fila("Sesión vence", p.vence ? new Date(p.vence).toLocaleDateString("es-CO", { dateStyle: "long" }) : "")}</dl>`;
  const todas = await DB.todas(), n = e => todas.filter(r => r.estado === e).length;
  let uso = "";
  try { const est = await navigator.storage.estimate(); uso = `${(est.usage / 1048576).toFixed(1)} MB usados`; } catch (e) {}
  $("p-disp").innerHTML = `<dl class="disp">${fila("Versión de la app", C.VERSION + (C.ESPACIO ? " · " + C.ESPACIO : ""))}${fila("Última sincronización", cache.sync ? new Date(cache.sync).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : "")}
    ${fila("Valoraciones en el dispositivo", `${todas.length}: ${n("borrador")} borrador(es), ${n("pendiente") + n("error")} por enviar, ${n("enviada")} enviada(s)`)}${uso ? fila("Almacenamiento", uso) : ""}</dl>`;
  $("b-salir").hidden = LOCAL;
}

// ---------- Mapa (Leaflet, cargado solo al abrir la pestaña) ----------
let mapa = null, capaPuntos = null, capasOf = {}, marcaYo = null;
const COLOR_HAB = { VERDE: "#2e7d32", AMARILLO: "#e0a800", ROJO: "#c62828", "": "#78909c" };
function cargarLeaflet() {
  if (window.L) return Promise.resolve();
  if (cargarLeaflet.p) return cargarLeaflet.p;
  cargarLeaflet.p = new Promise((ok, ko) => {
    const css = document.createElement("link"); css.rel = "stylesheet"; css.href = "lib/leaflet/leaflet.css"; document.head.append(css);
    const js = document.createElement("script"); js.src = "lib/leaflet/leaflet.js"; js.onload = ok; js.onerror = () => { cargarLeaflet.p = null; ko(new Error("leaflet")); }; document.head.append(js);
  });
  return cargarLeaflet.p;
}
function capaArcGIS(c) {
  const T = L.TileLayer.extend({
    getTileUrl(t) {
      const b = this._tileCoordsToBounds(t), sw = L.CRS.EPSG3857.project(b.getSouthWest()), ne = L.CRS.EPSG3857.project(b.getNorthEast());
      return `${c.url}/export?bbox=${sw.x},${sw.y},${ne.x},${ne.y}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&dpi=96${c.capas ? "&layers=show:" + c.capas : ""}&f=image`;
    }
  });
  const capa = new T("", { opacity: c.opacidad ?? 0.6, attribution: c.atrib || "", maxZoom: 19, crossOrigin: false });
  let avisado = false, errores = 0;
  capa.on("tileerror", () => { if (++errores >= 4 && !avisado) { avisado = true; toast(`No cargó «${c.nombre}»: el servidor de la entidad no respondió.`, 4500); } });
  capa.on("tileload", () => { errores = 0; });
  return capa;
}
// Consulta (identify) de un servicio ArcGIS en un punto. Devuelve texto o lanza error.
async function consultarCapa(c, lat, lon) {
  const d = 0.005, ext = `${lon - d},${lat - d},${lon + d},${lat + d}`;
  const url = `${c.url}/identify?geometry=${lon},${lat}&geometryType=esriGeometryPoint&sr=4326&layers=${c.capas ? "visible:" + c.capas : "visible"}&tolerance=2&mapExtent=${ext}&imageDisplay=400,400,96&returnGeometry=false&f=json`;
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || "error del servicio");
    const res = (j.results || []).map(x => {
      const at = Object.entries(x.attributes || {}).filter(([k, v]) => !/^(objectid|fid|shape|shape_.*|st_area.*|st_length.*|globalid)$/i.test(k) && v !== null && v !== "" && v !== "Null");
      return `${x.layerName}: ${at.slice(0, 3).map(([k, v]) => `${k} = ${v}`).join("; ")}`;
    });
    return res.length ? res.join(" | ") : "sin dato en el punto";
  } finally { clearTimeout(tm); }
}
async function pintarMapa() {
  try { await cargarLeaflet(); } catch (e) { $("m-info").textContent = "No se pudo cargar el mapa en este dispositivo."; return; }
  if (!mapa) {
    const M = C.MAPA || {};
    mapa = L.map("mapa", { zoomControl: true }).setView(M.CENTRO || [5, -75.85], M.ZOOM || 9);
    const bases = {};
    (M.BASES || []).forEach((b, i) => { bases[b.nombre] = L.tileLayer(b.url, { maxZoom: b.max || 19, maxNativeZoom: b.max || 19, attribution: b.atrib }); if (i === 0) bases[b.nombre].addTo(mapa); });
    capaPuntos = L.layerGroup().addTo(mapa);
    const over = { "Valoraciones": capaPuntos };
    (M.CAPAS || []).filter(c => c.tipo === "arcgis").forEach(c => { capasOf[c.id] = { c, capa: capaArcGIS(c) }; over[`${c.nombre}`] = capasOf[c.id].capa; });
    L.control.layers(bases, over, { collapsed: window.innerWidth < 700 }).addTo(mapa);
    L.control.scale({ imperial: false }).addTo(mapa);
    const ley = L.control({ position: "bottomleft" });
    ley.onAdd = () => { const d = L.DomUtil.create("div", "leyenda"); d.innerHTML = Object.entries(F.HAB).map(([k, v]) => `<i style="background:${COLOR_HAB[k]}"></i>${v[1]} · ${v[0]}`).join("<br>") + `<br><i style="background:${COLOR_HAB[""]}"></i>Sin clasificar`; return d; };
    ley.addTo(mapa);
    mapa.on("click", async e => {
      const activas = Object.values(capasOf).filter(x => mapa.hasLayer(x.capa));
      if (!activas.length) return;
      const pop = L.popup().setLatLng(e.latlng).setContent("Consultando…").openOn(mapa);
      const partes = await Promise.all(activas.map(async x => {
        try { return `<b>${esc(x.c.nombre)}</b><br>${esc(await consultarCapa(x.c, e.latlng.lat, e.latlng.lng))}`; }
        catch (err) { return `<b>${esc(x.c.nombre)}</b><br>No se pudo consultar (el servicio no lo permite desde la app o no respondió).`; }
      }));
      pop.setContent(partes.join("<hr>") + `<br><span style="font-size:11px;color:#5b6b78">Cartografía regional: orienta, no define la amenaza del predio.</span>`);
    });
    $("m-mpio").innerHTML = `<option value="">Todos</option>` + F.MPIOS.map(m => `<option>${m}</option>`).join("");
    $("m-hab").innerHTML = Object.entries(F.HAB).map(([k, v]) => `<label><input type="checkbox" value="${k}" checked>${v[1]}</label>`).join("") + `<label><input type="checkbox" value="" checked>Sin clasificar</label>`;
    ["m-mpio", "m-estado"].forEach(id => $(id).onchange = () => marcadores(true));
    $("m-hab").onchange = () => marcadores();
    $("mapa").addEventListener("click", e => { const b = e.target.closest("[data-srv]"); if (b) abrirDelServidor(b.dataset.srv, b); });
  }
  setTimeout(() => { mapa.invalidateSize(); marcadores(true); }, 60);
}
async function puntosMapa() {
  const locales = await DB.todas(), ids = new Set((cache.conceptos || []).map(c => c.id));
  const srv = (cache.conceptos || []).filter(c => c.lat && c.lon).map(c => ({ id: c.id, lat: +c.lat, lon: +c.lon, hab: c.hab || "", estado: c.estado || "", mpio: c.mpio || "",
    t: c.edif || c.dir || "Sin nombre", cons: c.consecutivo, fecha: c.v_fecha, quien: c.evaluador_nombre, uso: c.uso, sis: c.sis,
    abrir: !!sesion && (c.evaluador === sesion.correo || esRevisor() || sesion.rol === "coordinador") }));
  const loc = locales.filter(r => !ids.has(r.id) && r.st.lat).map(r => ({ id: r.id, lat: +r.st.lat, lon: +r.st.lon, hab: r.st.hab || "", estado: "local", mpio: r.st.mpio || "",
    t: r.st.edif || r.st.dir || "Sin nombre", cons: r.consecutivo, fecha: r.st.v_fecha, quien: "este dispositivo", uso: r.st.uso, sis: r.st.sis, abrir: true }));
  return srv.concat(loc).filter(p => isFinite(p.lat) && isFinite(p.lon));
}
async function marcadores(encuadrar) {
  if (!mapa) return;
  const mp = $("m-mpio").value, es = $("m-estado").value;
  const habs = new Set([...document.querySelectorAll("#m-hab input:checked")].map(i => i.value));
  const pts = (await puntosMapa()).filter(p => (!mp || p.mpio === mp) && (!es || p.estado === es) && habs.has(F.HAB[p.hab] ? p.hab : ""));
  capaPuntos.clearLayers();
  pts.forEach(p => {
    L.circleMarker([p.lat, p.lon], { radius: 8, color: "#fff", weight: 2, fillColor: COLOR_HAB[F.HAB[p.hab] ? p.hab : ""], fillOpacity: .95 })
      .bindPopup(`<b>${p.cons ? esc(p.cons) + " · " : ""}${esc(p.t)}</b><br>${esc(p.mpio)}${p.fecha ? " · " + esc(K.fechaLarga(p.fecha)) : ""}<br>${p.hab && F.HAB[p.hab] ? F.HAB[p.hab][1] + " · " + F.HAB[p.hab][0] : "Sin clasificar"}${p.estado && p.estado !== "local" ? " · " + esc(p.estado) : p.estado === "local" ? " · solo en este dispositivo" : ""}
        <br>${p.uso ? esc(p.uso) + " · " : ""}${esc(p.sis || "")}<br>Proyectó: ${esc(p.quien || "")}${p.abrir ? `<br><button class="btn sm" type="button" data-srv="${esc(p.id)}" style="margin-top:6px">Abrir</button>` : ""}`)
      .addTo(capaPuntos);
  });
  $("m-info").textContent = `${pts.length} valoración(es) con coordenadas en el mapa.${cache.sync ? " Datos de la última sincronización." : ""}`;
  if (encuadrar && pts.length) mapa.fitBounds(L.latLngBounds(pts.map(p => [p.lat, p.lon])).pad(0.2), { maxZoom: 15 });
}
$("m-yo").onclick = () => {
  if (!navigator.geolocation || !mapa) return;
  navigator.geolocation.getCurrentPosition(p => {
    const ll = [p.coords.latitude, p.coords.longitude];
    if (marcaYo) marcaYo.remove();
    marcaYo = L.circle(ll, { radius: Math.max(p.coords.accuracy, 8), color: "#0b4f6c", weight: 2, fillOpacity: .15 }).addTo(mapa).bindPopup("Usted está aquí");
    mapa.setView(ll, 16);
  }, () => toast("No se pudo leer la ubicación"), { enableHighAccuracy: true, timeout: 15000 });
};

// Consulta de las capas oficiales en el punto de la ficha (paso 2).
$("b-amenaza").onclick = async () => {
  const st = ed();
  if (!st.lat || !st.lon) return toast("Primero tome el punto GPS");
  if (!navigator.onLine) return toast("Sin señal: la consulta necesita conexión");
  const b = $("b-amenaza"); b.disabled = true; b.textContent = "Consultando…";
  const capas = ((C.MAPA || {}).CAPAS || []).filter(c => c.tipo === "arcgis");
  const lin = [];
  for (const c of capas) {
    try { lin.push(`${c.nombre}${c.escala ? " (escala " + c.escala + ")" : ""}: ${await consultarCapa(c, +st.lat, +st.lon)}.`); }
    catch (e) { lin.push(`${c.nombre}: no se pudo consultar.`); }
  }
  b.disabled = false; b.textContent = "Consultar capas oficiales en el punto";
  const txt = `Consulta del ${K.fechaLarga(hoyISO())}. ${lin.join(" ")} Es cartografía regional: orienta, pero no define la amenaza del predio; prima la zonificación del POT municipal.`;
  $("amenaza_ref").value = ($("amenaza_ref").value.trim() ? $("amenaza_ref").value.trim() + "\n" : "") + txt;
  leer(); guardar(); toast("Consulta agregada; revísela");
};

// ---------- Tablero ----------
async function pintarTablero() {
  if (!$("tb-mpio").options.length || $("tb-mpio").options.length === 1) $("tb-mpio").innerHTML = `<option value="">Todos</option>` + F.MPIOS.map(m => `<option>${m}</option>`).join("");
  const mp = $("tb-mpio").value;
  const locales = await DB.todas(), ids = new Set((cache.conceptos || []).map(c => c.id));
  const datos = (cache.conceptos || []).map(c => ({ hab: c.hab, estado: c.estado || "Sin estado", mpio: c.mpio, quien: c.evaluador_nombre || c.evaluador, sis: c.sis, uso: c.uso }))
    .concat(locales.filter(r => !ids.has(r.id) && !r.st.ejemplo).map(r => ({ hab: r.st.hab, estado: "Sin enviar", mpio: r.st.mpio, quien: sesion ? sesion.nombre : "Este dispositivo", sis: r.st.sis, uso: r.st.uso })))
    .filter(d => !mp || d.mpio === mp);
  const contar = k => { const m = new Map(); datos.forEach(d => { const v = d[k] || "Sin dato"; m.set(v, (m.get(v) || 0) + 1); }); return [...m].sort((a, b) => b[1] - a[1]); };
  const n = (k, v) => datos.filter(d => d[k] === v).length;
  const kpi = (v, t, c = "") => `<div class="kpi ${c}"><b>${v}</b><span>${t}</span></div>`;
  $("tb-kpis").innerHTML = kpi(datos.length, "valoraciones") + kpi(n("hab", "ROJO"), "rojo · no habitable", "bad") + kpi(n("hab", "AMARILLO"), "amarillo · uso restringido", "warn")
    + kpi(n("hab", "VERDE"), "verde · habitable", "ok") + kpi(n("estado", "En revisión"), "en revisión") + kpi(n("estado", "Devuelta"), "devueltas", "bad")
    + kpi(n("estado", "Aprobada"), "aprobadas", "ok") + (LOCAL ? "" : kpi((cache.asignadas || []).length, "solicitudes asignadas a usted sin atender"));
  const barras = (pares, color) => {
    if (!pares.length) return `<div class="vacio">Sin datos.</div>`;
    const max = Math.max(...pares.map(p => p[1]));
    return `<div class="barras">${pares.map(([k, v]) => `<div class="barra"><span class="et" title="${esc(k)}">${esc(k)}</span><span class="tr"><i style="width:${(v / max * 100).toFixed(1)}%;background:${color ? color(k) : "var(--azul)"}"></i></span><span class="n">${v}</span></div>`).join("")}</div>`;
  };
  $("tb-hab").innerHTML = barras(contar("hab").map(([k, v]) => [F.HAB[k] ? `${F.HAB[k][1]} · ${F.HAB[k][0]}` : "Sin clasificar", v]), k => COLOR_HAB[Object.keys(F.HAB).find(h => k.startsWith(F.HAB[h][1])) || ""]);
  $("tb-est").innerHTML = barras(contar("estado"), k => ({ "Aprobada": "#2e7d32", "Devuelta": "#c62828", "En revisión": "#0b4f6c" }[k] || "#78909c"));
  $("tb-mun").innerHTML = barras(contar("mpio"));
  $("tb-proy").innerHTML = barras(contar("quien"));
  $("tb-sis").innerHTML = barras(contar("sis"));
  $("tb-uso").innerHTML = barras(contar("uso"));
  $("tb-info").textContent = cache.sync ? "Datos de la última sincronización: " + new Date(cache.sync).toLocaleString("es-CO", { dateStyle: "short", timeStyle: "short" }) : LOCAL ? "Modo local: solo lo de este dispositivo." : "";
}
$("tb-mpio").onchange = pintarTablero;

// Limpieza: valoraciones enviadas hace más de BORRAR_ENVIADAS_DIAS
async function limpiar() {
  const lim = Date.now() - C.BORRAR_ENVIADAS_DIAS * 86400000;
  for (const r of await DB.todas()) if (r.estado === "enviada" && r.enviada && Date.parse(r.enviada) < lim) await DB.quitar(r.id);
}

// ---------- Arranque ----------
$("b-salir").onclick = salir;
async function arrancar() {
  $("h-sub").textContent = `SCORE · CARDER${C.ESPACIO ? " · " + C.ESPACIO : ""} · v${C.VERSION}`;
  $("aviso-local").hidden = !LOCAL;
  red(); window.addEventListener("online", () => { red(); sincronizar(); }); window.addEventListener("offline", red);
  if (!(await DB.disponible())) toast("Este navegador no permite guardar en el dispositivo (¿ventana privada?). No cierre la página sin descargar el Word.", 6000);
  await limpiar();
  if (!LOCAL && !sesion) mostrar("ingreso"); else mostrar("inicio");
  if (!LOCAL) { sincronizar(); setInterval(sincronizar, C.SYNC_MIN * 60000); }
  if ("serviceWorker" in navigator && location.protocol !== "file:") actualizaciones();
}
// Busca versiones nuevas al abrir y al volver a la app; al llegar una, recarga sola
// (si está diligenciando una valoración, espera a que salga del editor).
function actualizaciones() {
  const habia = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
    const revisar = () => reg.update().catch(() => {});
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") revisar(); });
    setInterval(revisar, 30 * 60000);
  }).catch(() => {});
  let hecho = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!habia || hecho) return; // primera instalación: no hace falta recargar
    hecho = true;
    if (vistaActual === "editor") { recargaPendiente = true; toast("Hay una versión nueva de la app. Se aplicará al salir de esta valoración.", 5000); }
    else location.reload();
  });
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && cur) { leer(); guardar(); } });
arrancar();
})();
