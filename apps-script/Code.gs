/**
 * Servidor de la app de valoración de estructuras (SCORE · CARDER).
 * Va pegado en el Apps Script de la hoja de Google (Extensiones > Apps Script).
 * Guarda las valoraciones en la hoja, las fotos y el concepto en Drive, y valida
 * quién entra con correo + PIN. Ver docs/INSTALACION.md.
 *
 * Seguridad:
 * - La página de GitHub es pública; la protección está aquí. Toda acción salvo
 *   "ingresar" exige un token de sesión válido de un usuario activo.
 * - Los PIN y los tokens se guardan con hash (SHA-256 con sal); nunca en claro.
 * - Las listas devuelven solo CAMPOS_LISTA; los datos personales del peticionario
 *   salen únicamente al abrir una solicitud asignada a quien la pide, o una
 *   valoración propia o que se está revisando.
 *
 * Roles (columna «rol» de Usuarios):
 * - proyectista (o evaluador): visita, diligencia y envía a revisión.
 * - revisor: además revisa, devuelve o aprueba; quien aprueba suscribe el concepto.
 * - coordinador: ve y abre las valoraciones de todos, sin aprobar.
 * - admin: todo lo anterior.
 */

// Debe coincidir con FICHA.CAMPOS_LISTA de ficha-estructuras.js (más evaluador).
var CAMPOS_LISTA = ['id', 'consecutivo', 'ct_num', 'estado', 'mpio', 'barrio', 'zona', 'edif', 'dir', 'v_fecha', 'hab', 'nivel',
  'lat', 'lon', 'evaluador', 'evaluador_nombre', 'doc_tipo', 'doc_num', 'actualizado', 'uso', 'sis', 'pisos', 'n_fotos',
  'suscribe_correo', 'suscribe_nombre', 'revisor_nombre', 'revisado', 'obs_revision', 'doc_url'];
var CAMPOS_SOLICITUD_LISTA = ['id', 'doc_tipo', 'doc_num', 'asig_fecha', 'mpio', 'barrio', 'dir', 'edif', 'estado'];

var HOJAS = {
  Usuarios: ['correo', 'nombre', 'rol', 'activo', 'profesion', 'cargo', 'matricula', 'pin_hash', 'pin_sal', 'creado', 'ultimo_ingreso'],
  Sesiones: ['token_hash', 'correo', 'creada', 'vence'],
  Solicitudes: ['id', 'doc_tipo', 'doc_num', 'doc_fecha', 'asig_por', 'asig_medio', 'asig_fecha', 'asignado_a', 'mpio', 'barrio', 'dir', 'edif',
    'sol_texto', 'pet_tipo', 'pet_nombre', 'pet_id', 'pet_dir', 'pet_tel', 'pet_correo', 'pet_calidad', 'expediente', 'estado', 'concepto'],
  Conceptos: ['id', 'consecutivo', 'estado', 'evaluador', 'evaluador_nombre', 'recibido', 'actualizado', 'solicitud_id', 'carpeta_url', 'doc_url',
    'carpeta_id', 'doc_id', 'suscribe_correo', 'suscribe_nombre', 'revisor', 'revisor_nombre', 'revisado', 'obs_revision'],
  Fotos: ['concepto_id', 'consecutivo', 'foto_id', 'n', 'descripcion', 'norte', 'este', 'lat', 'lon', 'archivo_id', 'url', 'subida', 'estado'],
  Bitacora: ['fecha', 'correo', 'accion', 'detalle']
};
var DIAS_SESION = 30;
var MAX_FALLOS = 5, MINUTOS_BLOQUEO = 15;
var MAX_FOTO_BYTES = 5 * 1024 * 1024;
var MAX_COLUMNAS = 300;
var COLS_REVISION = ['estado', 'suscribe_correo', 'suscribe_nombre', 'revisor', 'revisor_nombre', 'revisado', 'obs_revision'];
var ESTADOS = { REVISION: 'En revisión', DEVUELTA: 'Devuelta', APROBADA: 'Aprobada' };

// ---------------- Menú de la hoja ----------------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('Valoración estructuras')
    .addItem('1. Configurar hojas y carpeta', 'configurar')
    .addItem('2. Asignar PIN al usuario de la fila seleccionada', 'asignarPin')
    .addItem('Cerrar todas las sesiones del usuario seleccionado', 'cerrarSesionesUsuario')
    .addToUi();
}

function configurar() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(HOJAS).forEach(function (nombre) {
    var sh = ss.getSheetByName(nombre) || ss.insertSheet(nombre);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, HOJAS[nombre].length).setValues([HOJAS[nombre]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  ['pin_hash', 'pin_sal'].forEach(function (c) {
    var sh = ss.getSheetByName('Usuarios'), col = encabezados_(sh).indexOf(c) + 1;
    if (col) sh.hideColumns(col);
  });
  ss.getSheetByName('Sesiones').hideSheet();
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('CARPETA_ID')) {
    var carpeta = DriveApp.createFolder('Valoración de estructuras - archivos');
    props.setProperty('CARPETA_ID', carpeta.getId());
  }
  var hoja1 = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (hoja1 && hoja1.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(hoja1);
  SpreadsheetApp.getUi().alert('Listo. Hojas creadas y carpeta de Drive: ' + DriveApp.getFolderById(props.getProperty('CARPETA_ID')).getUrl() +
    '\n\nAhora agregue los usuarios en la hoja «Usuarios» (correo, nombre, rol, activo = SI) y asígneles un PIN desde el menú.');
}

function asignarPin() {
  var ui = SpreadsheetApp.getUi(), sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== 'Usuarios') { ui.alert('Vaya a la hoja «Usuarios» y seleccione la fila del usuario.'); return; }
  var fila = sh.getActiveRange().getRow();
  if (fila < 2) { ui.alert('Seleccione la fila de un usuario.'); return; }
  var enc = encabezados_(sh), datos = sh.getRange(fila, 1, 1, enc.length).getValues()[0];
  var correo = String(datos[enc.indexOf('correo')] || '').trim().toLowerCase();
  if (!correo) { ui.alert('La fila no tiene correo.'); return; }
  var pin = '';
  for (var i = 0; i < 6; i++) pin += Math.floor(Math.random() * 10);
  var sal = Utilities.getUuid();
  sh.getRange(fila, enc.indexOf('pin_hash') + 1).setValue(hash_(sal + pin));
  sh.getRange(fila, enc.indexOf('pin_sal') + 1).setValue(sal);
  if (!datos[enc.indexOf('creado')]) sh.getRange(fila, enc.indexOf('creado') + 1).setValue(new Date());
  cerrarSesiones_(correo);
  bitacora_(Session.getEffectiveUser().getEmail(), 'asignar_pin', correo);
  ui.alert('PIN de ' + correo + ': ' + pin + '\n\nEntrégueselo en persona o por un medio privado. No queda guardado en claro: si se pierde, asigne uno nuevo.');
}

function cerrarSesionesUsuario() {
  var sh = SpreadsheetApp.getActiveSheet();
  if (sh.getName() !== 'Usuarios') { SpreadsheetApp.getUi().alert('Seleccione la fila del usuario en «Usuarios».'); return; }
  var enc = encabezados_(sh), fila = sh.getActiveRange().getRow();
  var correo = String(sh.getRange(fila, enc.indexOf('correo') + 1).getValue()).trim().toLowerCase();
  var n = cerrarSesiones_(correo);
  SpreadsheetApp.getUi().alert('Sesiones cerradas de ' + correo + ': ' + n);
}

// ---------------- Web app ----------------
function doGet() {
  return json_({ ok: true, app: 'valoracion-estructuras', mensaje: 'Servidor activo. La app usa POST.' });
}

function doPost(e) {
  try {
    var p = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var accion = String(p.accion || '');
    if (accion === 'ingresar') return json_(ingresar_(p));
    var u = usuarioDeToken_(p.token);
    if (!u) return json_({ ok: false, code: 'SESION', error: 'Sesión vencida o inválida' });
    switch (accion) {
      case 'salir': return json_(salir_(p));
      case 'asignadas': return json_(asignadas_(u));
      case 'solicitud': return json_(solicitud_(u, p));
      case 'conceptos': return json_(conceptos_());
      case 'guardar': return json_(guardar_(u, p));
      case 'foto': return json_(foto_(u, p));
      case 'documento': return json_(documento_(u, p));
      case 'revisores': return json_(revisores_());
      case 'ficha': return json_(ficha_(u, p));
      case 'fotob64': return json_(fotob64_(u, p));
      case 'revisar': return json_(revisar_(u, p));
      default: return json_({ ok: false, error: 'Acción desconocida' });
    }
  } catch (err) {
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'Error del servidor: ' + (err && err.message || err) });
  }
}

// ---------------- Acciones ----------------
function ingresar_(p) {
  var correo = String(p.correo || '').trim().toLowerCase(), pin = String(p.pin || '').trim();
  if (!correo || !pin) return { ok: false, error: 'Escriba correo y PIN' };
  var cache = CacheService.getScriptCache(), kf = 'fallos_' + correo;
  var fallos = Number(cache.get(kf) || 0);
  if (fallos >= MAX_FALLOS) return { ok: false, error: 'Demasiados intentos. Espere ' + MINUTOS_BLOQUEO + ' minutos.' };
  var t = tabla_('Usuarios'), fila = buscar_(t, 'correo', correo);
  var ok = fila && esSi_(fila.obj.activo) && fila.obj.pin_hash && hash_(String(fila.obj.pin_sal) + pin) === fila.obj.pin_hash;
  if (!ok) {
    cache.put(kf, String(fallos + 1), MINUTOS_BLOQUEO * 60);
    bitacora_(correo, 'ingreso_fallido', '');
    return { ok: false, error: 'Correo o PIN incorrectos' };
  }
  cache.remove(kf);
  cerrarSesiones_(''); // de paso borra las sesiones vencidas
  var token = Utilities.getUuid() + Utilities.getUuid();
  var vence = new Date(Date.now() + DIAS_SESION * 86400000);
  agregar_('Sesiones', { token_hash: hash_(token), correo: correo, creada: new Date(), vence: vence });
  escribirCelda_(t, fila.i, 'ultimo_ingreso', new Date());
  bitacora_(correo, 'ingreso', '');
  return { ok: true, token: token, vence: vence.toISOString(), usuario: perfil_(fila.obj) };
}

function salir_(p) {
  var sh = hoja_('Sesiones'), t = tabla_('Sesiones'), h = hash_(String(p.token || ''));
  for (var i = t.filas.length - 1; i >= 0; i--) if (t.filas[i].token_hash === h) sh.deleteRow(i + 2);
  return { ok: true };
}

function asignadas_(u) {
  var t = tabla_('Solicitudes');
  var lista = t.filas.filter(function (f) {
    return String(f.asignado_a).trim().toLowerCase() === u.correo && !/^atendida/i.test(String(f.estado));
  }).map(function (f) { return elegir_(f, CAMPOS_SOLICITUD_LISTA); });
  return { ok: true, asignadas: lista };
}

function solicitud_(u, p) {
  var t = tabla_('Solicitudes'), fila = buscar_(t, 'id', String(p.id));
  if (!fila) return { ok: false, error: 'No existe la solicitud' };
  var suya = String(fila.obj.asignado_a).trim().toLowerCase() === u.correo;
  if (!suya && !esCoordinador_(u)) return { ok: false, error: 'La solicitud no está asignada a usted' };
  if (!fila.obj.estado || /^asignada/i.test(String(fila.obj.estado))) escribirCelda_(t, fila.i, 'estado', 'En curso');
  bitacora_(u.correo, 'abrir_solicitud', String(p.id));
  return { ok: true, solicitud: normalizar_(fila.obj) };
}

function conceptos_() {
  var t = tabla_('Conceptos');
  return { ok: true, conceptos: t.filas.map(function (f) { return elegir_(f, CAMPOS_LISTA); }) };
}

function guardar_(u, p) {
  var ficha = p.ficha || {};
  var id = String(ficha.id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(id)) return { ok: false, error: 'Identificador inválido' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = hoja_('Conceptos'), t = tabla_('Conceptos'), fila = buscar_(t, 'id', id);
    if (fila && fila.obj.evaluador !== u.correo && !esCoordinador_(u)) return { ok: false, error: 'Esta valoración es de otro evaluador' };
    var limpio = {};
    Object.keys(ficha).forEach(function (k) {
      if (!/^[a-z][a-z0-9_]{0,40}$/.test(k)) return;
      if (['consecutivo', 'evaluador', 'evaluador_nombre', 'recibido', 'carpeta_url', 'doc_url', 'carpeta_id', 'doc_id'].indexOf(k) >= 0) return;
      if (COLS_REVISION.indexOf(k) >= 0) return;
      limpio[k] = seguro_(ficha[k]);
    });
    // Quien suscribe debe ser un revisor activo; si no se eligió, lo define quien apruebe.
    var sus = String(ficha.suscribe_correo || '').trim().toLowerCase();
    var revisor = sus ? revisorPorCorreo_(sus) : null;
    if (sus && !revisor) return { ok: false, error: 'La persona elegida para suscribir no es revisora activa' };
    var propia = !fila || fila.obj.evaluador === u.correo;
    var consecutivo, carpeta;
    if (fila) {
      consecutivo = fila.obj.consecutivo;
      carpeta = carpetaConcepto_(fila.obj.carpeta_id, limpio, consecutivo);
    } else {
      consecutivo = nuevoConsecutivo_();
      carpeta = carpetaConcepto_('', limpio, consecutivo);
      limpio.consecutivo = consecutivo;
      limpio.evaluador = u.correo;
      limpio.evaluador_nombre = u.nombre || u.correo;
      limpio.recibido = new Date();
    }
    if (propia) {
      // Quien proyecta envía (o reenvía) a revisión. Si quien proyecta es el mismo revisor
      // que suscribe, queda aprobada de una vez.
      limpio.suscribe_correo = sus;
      limpio.suscribe_nombre = revisor ? revisor.nombre : '';
      if (revisor && revisor.correo === u.correo && esRevisor_(u)) {
        limpio.estado = ESTADOS.APROBADA; limpio.revisor = u.correo; limpio.revisor_nombre = u.nombre || u.correo;
        limpio.revisado = new Date(); limpio.obs_revision = '';
      } else {
        limpio.estado = ESTADOS.REVISION; limpio.revisor = ''; limpio.revisor_nombre = ''; limpio.revisado = '';
      }
    }
    // Si quien guarda es un revisor que corrige una valoración ajena, el estado no cambia aquí: lo cambia «revisar».
    limpio.carpeta_id = carpeta.getId();
    limpio.carpeta_url = carpeta.getUrl();
    asegurarColumnas_(sh, Object.keys(limpio));
    if (fila) escribirFila_(sh, fila.i, limpio); else agregar_('Conceptos', limpio);

    // Fotos quitadas en el celular: se mandan a la papelera de Drive.
    var vigentes = (p.fotos_ids || []).map(String);
    var tf = tabla_('Fotos');
    tf.filas.forEach(function (f, i) {
      if (f.concepto_id === id && f.estado !== 'retirada' && vigentes.indexOf(String(f.foto_id)) < 0) {
        try { DriveApp.getFileById(f.archivo_id).setTrashed(true); } catch (e) {}
        escribirCelda_(tf, i, 'estado', 'retirada');
      }
    });

    // La solicitud asignada queda atendida.
    if (ficha.solicitud_id) {
      var ts = tabla_('Solicitudes'), s = buscar_(ts, 'id', String(ficha.solicitud_id));
      if (s) { escribirCelda_(ts, s.i, 'estado', 'Atendida'); escribirCelda_(ts, s.i, 'concepto', consecutivo); }
    }
    bitacora_(u.correo, fila ? 'actualizar' : 'crear', consecutivo);
    var final = buscar_(tabla_('Conceptos'), 'id', id).obj;
    return { ok: true, consecutivo: consecutivo, carpeta: carpeta.getUrl(), revision: revisionDe_(final) };
  } finally {
    lock.releaseLock();
  }
}

function foto_(u, p) {
  var c = conceptoPropio_(u, p.id);
  if (c.error) return { ok: false, error: c.error };
  var bytes = Utilities.base64Decode(String(p.b64 || ''));
  if (!bytes.length || bytes.length > MAX_FOTO_BYTES) return { ok: false, error: 'Foto vacía o demasiado grande' };
  if (!(bytes[0] === -1 && bytes[1] === -40)) return { ok: false, error: 'La foto no es JPEG' }; // FF D8
  var carpeta = DriveApp.getFolderById(c.fila.obj.carpeta_id);
  var n = ('0' + Number(p.n || 0)).slice(-2);
  var desc = String(p.d || '').replace(/[\\\/:*?"<>|\n\r]/g, ' ').slice(0, 60).trim();
  var archivo = carpeta.createFile(Utilities.newBlob(bytes, 'image/jpeg', 'Foto ' + n + (desc ? ' - ' + desc : '') + '.jpg'));
  var tf = tabla_('Fotos'), previa = null;
  tf.filas.forEach(function (f, i) { if (f.concepto_id === String(p.id) && String(f.foto_id) === String(p.foto_id)) previa = { i: i, obj: f }; });
  var datos = { concepto_id: String(p.id), consecutivo: c.fila.obj.consecutivo, foto_id: String(p.foto_id), n: Number(p.n || 0),
    descripcion: seguro_(p.d), norte: seguro_(p.norte), este: seguro_(p.este), lat: seguro_(p.lat), lon: seguro_(p.lon),
    archivo_id: archivo.getId(), url: archivo.getUrl(), subida: new Date(), estado: 'vigente' };
  if (previa) {
    try { DriveApp.getFileById(previa.obj.archivo_id).setTrashed(true); } catch (e) {}
    escribirFila_(hoja_('Fotos'), previa.i, datos);
  } else agregar_('Fotos', datos);
  return { ok: true, url: archivo.getUrl() };
}

function documento_(u, p) {
  var c = conceptoPropio_(u, p.id);
  if (c.error) return { ok: false, error: c.error };
  var html = String(p.html || '');
  if (!html || html.length > 40 * 1024 * 1024) return { ok: false, error: 'Documento vacío o demasiado grande' };
  var nombre = String(p.nombre || 'Concepto.doc').replace(/[\\\/:*?"<>|\n\r]/g, ' ').slice(0, 150);
  if (!/\.doc$/i.test(nombre)) nombre += '.doc';
  if (c.fila.obj.doc_id) { try { DriveApp.getFileById(c.fila.obj.doc_id).setTrashed(true); } catch (e) {} }
  var archivo = DriveApp.getFolderById(c.fila.obj.carpeta_id).createFile(Utilities.newBlob('﻿' + html, 'application/msword', nombre));
  var t = tabla_('Conceptos');
  escribirCelda_(t, c.fila.i, 'doc_id', archivo.getId());
  escribirCelda_(t, c.fila.i, 'doc_url', archivo.getUrl());
  return { ok: true, url: archivo.getUrl() };
}

function revisores_() {
  var t = tabla_('Usuarios');
  var l = t.filas.filter(function (f) { return esSi_(f.activo) && esRevisor_({ rol: String(f.rol || '').toLowerCase() }); })
    .map(function (f) { var p = perfil_(f); return { correo: p.correo, nombre: p.nombre, profesion: p.profesion, cargo: p.cargo, matricula: p.matricula }; });
  return { ok: true, revisores: l };
}

// Valoración completa (con datos personales): solo para quien la proyectó o para revisión/coordinación.
function ficha_(u, p) {
  var c = conceptoPropio_(u, p.id);
  if (c.error) return { ok: false, error: c.error };
  var fotos = tabla_('Fotos').filas.filter(function (f) { return f.concepto_id === String(p.id) && f.estado !== 'retirada'; })
    .map(function (f) { return elegir_(f, ['foto_id', 'n', 'descripcion', 'norte', 'este', 'lat', 'lon']); })
    .sort(function (a, b) { return Number(a.n) - Number(b.n); });
  bitacora_(u.correo, 'abrir_valoracion', String(c.fila.obj.consecutivo));
  return { ok: true, ficha: normalizar_(c.fila.obj), fotos: fotos };
}

function fotob64_(u, p) {
  var c = conceptoPropio_(u, p.id);
  if (c.error) return { ok: false, error: c.error };
  var f = null;
  tabla_('Fotos').filas.forEach(function (x) { if (x.concepto_id === String(p.id) && String(x.foto_id) === String(p.foto_id) && x.estado !== 'retirada') f = x; });
  if (!f) return { ok: false, error: 'No existe la foto' };
  return { ok: true, b64: Utilities.base64Encode(DriveApp.getFileById(f.archivo_id).getBlob().getBytes()) };
}

// Revisión: el revisor aprueba (y suscribe) o devuelve con observaciones.
function revisar_(u, p) {
  if (!esRevisor_(u)) return { ok: false, error: 'Solo un revisor puede aprobar o devolver valoraciones' };
  var decision = String(p.decision || ''), obs = String(p.obs || '').trim();
  if (decision !== 'aprobar' && decision !== 'devolver') return { ok: false, error: 'Decisión inválida' };
  if (decision === 'devolver' && !obs) return { ok: false, error: 'Escriba las observaciones para devolverla' };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = hoja_('Conceptos');
    asegurarColumnas_(sh, COLS_REVISION);
    var t = tabla_('Conceptos'), fila = buscar_(t, 'id', String(p.id || ''));
    if (!fila) return { ok: false, error: 'Primero debe guardarse la valoración' };
    var cambios = decision === 'aprobar'
      ? { estado: ESTADOS.APROBADA, revisor: u.correo, revisor_nombre: u.nombre || u.correo, revisado: new Date(), suscribe_correo: u.correo,
          suscribe_nombre: u.nombre || u.correo, obs_revision: obs ? seguro_(obs) : '' }
      : { estado: ESTADOS.DEVUELTA, revisor: u.correo, revisor_nombre: u.nombre || u.correo, revisado: new Date(), obs_revision: seguro_(obs) };
    escribirFila_(sh, fila.i, cambios);
    bitacora_(u.correo, decision === 'aprobar' ? 'aprobar' : 'devolver', String(fila.obj.consecutivo));
    var final = buscar_(tabla_('Conceptos'), 'id', String(p.id)).obj;
    return { ok: true, revision: revisionDe_(final), suscribe: decision === 'aprobar' ? { n: u.nombre, p: u.profesion, c: u.cargo, m: u.matricula, correo: u.correo } : null };
  } finally {
    lock.releaseLock();
  }
}

// ---------------- Apoyo ----------------
function revisionDe_(o) {
  var n = normalizar_(o);
  return { estado: n.estado || '', revisor_nombre: n.revisor_nombre || '', revisado: n.revisado || '', obs: n.obs_revision || '',
    suscribe_correo: n.suscribe_correo || '', suscribe_nombre: n.suscribe_nombre || '' };
}
function revisorPorCorreo_(correo) {
  var t = tabla_('Usuarios'), f = buscar_(t, 'correo', correo);
  if (!f) {
    t.filas.forEach(function (x, i) { if (!f && String(x.correo).trim().toLowerCase() === correo) f = { i: i, obj: x }; });
  }
  if (!f || !esSi_(f.obj.activo)) return null;
  var p = perfil_(f.obj);
  return esRevisor_(p) ? p : null;
}
function usuarioDeToken_(token) {
  if (!token) return null;
  var h = hash_(String(token)), ts = tabla_('Sesiones'), s = buscar_(ts, 'token_hash', h);
  if (!s || new Date(s.obj.vence) < new Date()) return null;
  var tu = tabla_('Usuarios'), u = buscar_(tu, 'correo', String(s.obj.correo).toLowerCase());
  if (!u || !esSi_(u.obj.activo)) return null;
  var perfil = perfil_(u.obj);
  perfil.rol = String(u.obj.rol || 'evaluador').toLowerCase();
  return perfil;
}
function perfil_(o) {
  return { correo: String(o.correo).trim().toLowerCase(), nombre: String(o.nombre || ''), rol: String(o.rol || 'evaluador').toLowerCase(),
    profesion: String(o.profesion || ''), cargo: String(o.cargo || ''), matricula: String(o.matricula || '') };
}
function esCoordinador_(u) { return u.rol === 'coordinador' || u.rol === 'admin' || u.rol === 'revisor'; }
function esRevisor_(u) { return u.rol === 'revisor' || u.rol === 'admin'; }
function esSi_(v) { return v === true || /^(si|sí|true|1|x)$/i.test(String(v).trim()); }
function conceptoPropio_(u, id) {
  var t = tabla_('Conceptos'), fila = buscar_(t, 'id', String(id || ''));
  if (!fila) return { error: 'Primero debe guardarse la valoración' };
  if (fila.obj.evaluador !== u.correo && !esCoordinador_(u)) return { error: 'Esta valoración es de otro evaluador' };
  return { fila: fila };
}
function nuevoConsecutivo_() {
  var anio = Utilities.formatDate(new Date(), 'America/Bogota', 'yyyy');
  var props = PropertiesService.getScriptProperties(), k = 'contador_' + anio;
  var n = Number(props.getProperty(k) || 0) + 1;
  props.setProperty(k, String(n));
  return 'VE-' + anio + '-' + ('000' + n).slice(-4);
}
function carpetaConcepto_(idPrevio, f, consecutivo) {
  if (idPrevio) { try { return DriveApp.getFolderById(idPrevio); } catch (e) {} }
  var raiz = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('CARPETA_ID'));
  var mpio = String(f.mpio || 'Sin municipio').replace(/^'/, '');
  var it = raiz.getFoldersByName(mpio), cm = it.hasNext() ? it.next() : raiz.createFolder(mpio);
  var nombre = consecutivo + ' - ' + String(f.edif || f.dir || 'edificación').replace(/^'/, '').replace(/[\\\/:*?"<>|]/g, ' ').slice(0, 80);
  return cm.createFolder(nombre);
}
function cerrarSesiones_(correo) {
  var sh = hoja_('Sesiones'), t = tabla_('Sesiones'), n = 0;
  for (var i = t.filas.length - 1; i >= 0; i--) {
    if (String(t.filas[i].correo).toLowerCase() === correo || new Date(t.filas[i].vence) < new Date()) { sh.deleteRow(i + 2); n++; }
  }
  return n;
}
// Todo lo que llega de la app se guarda como texto (apóstrofo inicial): así nada se
// ejecuta como fórmula y la hoja no cambia fechas ni decimales según el idioma.
function seguro_(v) {
  if (v === null || v === undefined) return '';
  var s = typeof v === 'string' ? v : String(v);
  if (s === '') return '';
  if (s.length > 49000) s = s.slice(0, 49000);
  return "'" + s;
}
function normalizar_(o) {
  var r = {};
  Object.keys(o).forEach(function (k) {
    var v = o[k];
    r[k] = v instanceof Date ? Utilities.formatDate(v, 'America/Bogota', 'yyyy-MM-dd') : String(v === null || v === undefined ? '' : v);
  });
  return r;
}
function elegir_(o, campos) {
  var r = {}, n = normalizar_(o);
  campos.forEach(function (k) { if (n[k] !== undefined) r[k] = n[k]; });
  return r;
}
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function hoja_(nombre) {
  var sh = SpreadsheetApp.getActive().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la hoja «' + nombre + '». Ejecute «Configurar hojas y carpeta».');
  return sh;
}
function encabezados_(sh) {
  if (sh.getLastColumn() === 0) return [];
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(function (h) { return String(h).trim(); });
}
function tabla_(nombre) {
  var sh = hoja_(nombre), enc = encabezados_(sh), n = sh.getLastRow() - 1;
  var vals = n > 0 ? sh.getRange(2, 1, n, enc.length).getValues() : [];
  return { sh: sh, enc: enc, filas: vals.map(function (row) { var o = {}; enc.forEach(function (h, j) { if (h) o[h] = row[j]; }); return o; }) };
}
function buscar_(t, campo, valor) {
  for (var i = 0; i < t.filas.length; i++) if (String(t.filas[i][campo]) === String(valor)) return { i: i, obj: t.filas[i] };
  return null;
}
function asegurarColumnas_(sh, claves) {
  var enc = encabezados_(sh), faltan = claves.filter(function (k) { return enc.indexOf(k) < 0; });
  if (!faltan.length) return;
  if (enc.length + faltan.length > MAX_COLUMNAS) throw new Error('La hoja llegó al máximo de columnas');
  sh.getRange(1, enc.length + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold');
}
function escribirFila_(sh, i, obj) {
  var enc = encabezados_(sh), rango = sh.getRange(i + 2, 1, 1, enc.length), fila = rango.getValues()[0];
  enc.forEach(function (h, j) { if (Object.prototype.hasOwnProperty.call(obj, h)) fila[j] = obj[h]; });
  rango.setValues([fila]);
}
function escribirCelda_(t, i, campo, valor) {
  var j = t.enc.indexOf(campo);
  if (j < 0) return;
  t.sh.getRange(i + 2, j + 1).setValue(valor);
  t.filas[i][campo] = valor;
}
function agregar_(nombre, obj) {
  var sh = hoja_(nombre), enc = encabezados_(sh);
  sh.appendRow(enc.map(function (h) { return Object.prototype.hasOwnProperty.call(obj, h) ? obj[h] : ''; }));
}
function bitacora_(correo, accion, detalle) {
  try { agregar_('Bitacora', { fecha: new Date(), correo: correo, accion: accion, detalle: detalle }); } catch (e) {}
}
