const { crear } = require("./gas-falso");
const assert = require("assert");
const g = crear(require("path").resolve(__dirname, "../apps-script/Code.gs"));
g.ctx.configurar();
console.log("hojas:", g.sheets.map(s => s.name).join(","), "carpeta:", g.props.CARPETA_ID);
const U = g.ss.getSheetByName("Usuarios");
U.appendRow(["eva@carder.gov.co", "Eva Prueba", "evaluador", "SI", "Ingeniera Civil", "Profesional", "12345", g.hash("sal1" + "123456"), "sal1", "", ""]);
U.appendRow(["otro@carder.gov.co", "Otro", "evaluador", "SI", "", "", "", g.hash("sal2" + "654321"), "sal2", "", ""]);
U.appendRow(["rev@carder.gov.co", "Revisor Prueba", "revisor", "SI", "Ingeniero Civil", "Profesional Especializado", "999", g.hash("sal3" + "111111"), "sal3", "", ""]);
const S = g.ss.getSheetByName("Solicitudes");
S.appendRow(["S1", "SAIA", "2026-111-E", new Date("2026-11-04T12:00:00Z"), "Subdirector", "Correo", new Date("2026-11-06T12:00:00Z"), "eva@carder.gov.co", "Pereira", "Centro", "Cra 7 # 19-20", "Edificio Prueba", "Grietas", "Persona natural", "Juan Pérez", "1088", "Calle 1", "300", "j@x.co", "Propietario", "NA", "Asignada", ""]);
assert.equal(g.post({ accion: "asignadas" }).code, "SESION");
assert.equal(g.post({ accion: "ingresar", correo: "eva@carder.gov.co", pin: "000000" }).ok, false);
const li = g.post({ accion: "ingresar", correo: "EVA@carder.gov.co ", pin: "123456" });
assert(li.ok, JSON.stringify(li)); const tk = li.token;
assert.equal(li.usuario.nombre, "Eva Prueba");
assert(!JSON.stringify(g.tabla("Sesiones")).includes(tk), "token en claro");
const a = g.post({ accion: "asignadas", token: tk });
assert.equal(a.asignadas.length, 1); assert(!("pet_nombre" in a.asignadas[0]), "personal en lista");
const so = g.post({ accion: "solicitud", token: tk, id: "S1" });
assert.equal(so.solicitud.pet_nombre, "Juan Pérez"); assert.equal(so.solicitud.doc_fecha, "2026-11-04");
const li2 = g.post({ accion: "ingresar", correo: "otro@carder.gov.co", pin: "654321" });
assert.equal(g.post({ accion: "solicitud", token: li2.token, id: "S1" }).ok, false);
const ficha = { id: "11111111-aaaa", solicitud_id: "S1", mpio: "Pereira", edif: "=HYPERLINK(\"x\")", dir: "Cra 7", lat: "4.81", lon: "-75.69", hab: "AMARILLO", pet_nombre: "Juan Pérez", "mal clave": "x", consecutivo: "HACK" };
const gu = g.post({ accion: "guardar", token: tk, ficha, fotos_ids: ["f1"] });
assert(gu.ok, JSON.stringify(gu)); assert.equal(gu.consecutivo, "VE-2026-0001");
const c = g.tabla("Conceptos")[0];
assert.equal(c.edif, "=HYPERLINK(\"x\")"); // texto, no fórmula (el apóstrofo lo hace texto)
assert.equal(c.lon, "-75.69"); assert.equal(c.evaluador, "eva@carder.gov.co"); assert(!("mal clave" in c));
assert.equal(g.tabla("Solicitudes")[0].estado, "Atendida"); assert.equal(g.tabla("Solicitudes")[0].concepto, "VE-2026-0001");
// otro evaluador no puede sobrescribir
assert.equal(g.post({ accion: "guardar", token: li2.token, ficha }).ok, false);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString("base64");
assert(g.post({ accion: "foto", token: tk, id: ficha.id, foto_id: "f1", n: 1, b64: jpeg, d: "Fachada" }).ok);
assert.equal(g.post({ accion: "foto", token: tk, id: ficha.id, foto_id: "f2", n: 2, b64: Buffer.from("hola").toString("base64") }).ok, false);
assert(g.post({ accion: "foto", token: tk, id: ficha.id, foto_id: "f1", n: 1, b64: jpeg, d: "Fachada 2" }).ok); // reemplazo
assert.equal(g.tabla("Fotos").length, 1);
assert(g.post({ accion: "documento", token: tk, id: ficha.id, nombre: "CT - X.doc", html: "<html>x</html>" }).ok);
assert(g.post({ accion: "documento", token: tk, id: ficha.id, nombre: "CT - X.doc", html: "<html>y</html>" }).ok);
const vivos = [...g.files.values()].filter(f => f.kind === "file" && !f.trashed).map(f => f.name);
console.log("archivos vigentes:", vivos);
assert.equal(vivos.length, 2);
// actualizar quitando la foto
const gu2 = g.post({ accion: "guardar", token: tk, ficha: { ...ficha, edif: "Edificio Prueba" }, fotos_ids: [] });
assert.equal(gu2.consecutivo, "VE-2026-0001"); assert.equal(g.tabla("Fotos")[0].estado, "retirada");
assert.equal(g.tabla("Conceptos").length, 1);
const lc = g.post({ accion: "conceptos", token: li2.token });
assert.equal(lc.conceptos.length, 1); assert(!("pet_nombre" in lc.conceptos[0])); assert.equal(lc.conceptos[0].evaluador_nombre, "Eva Prueba");
// ----- Flujo de revisión -----
assert.equal(g.tabla("Conceptos")[0].estado, "En revisión", "la proyectada queda en revisión");
const rv = g.post({ accion: "ingresar", correo: "rev@carder.gov.co", pin: "111111" }); assert(rv.ok);
const lr = g.post({ accion: "revisores", token: tk });
assert.deepEqual(lr.revisores.map(r => r.correo), ["rev@carder.gov.co"]); assert(!("pin_hash" in lr.revisores[0]));
// suscribe alguien que no es revisor
assert.equal(g.post({ accion: "guardar", token: tk, ficha: { ...ficha, suscribe_correo: "otro@carder.gov.co" }, fotos_ids: [] }).ok, false);
assert(g.post({ accion: "guardar", token: tk, ficha: { ...ficha, edif: "Edificio Prueba", suscribe_correo: "rev@carder.gov.co" }, fotos_ids: [] }).ok);
assert.equal(g.tabla("Conceptos")[0].suscribe_nombre, "Revisor Prueba");
// un proyectista no puede revisar
assert.equal(g.post({ accion: "revisar", token: li2.token, id: ficha.id, decision: "aprobar" }).ok, false);
assert.equal(g.post({ accion: "ficha", token: li2.token, id: ficha.id }).ok, false, "otro proyectista no abre la ficha completa");
// el revisor abre la ficha completa y las fotos
const fr = g.post({ accion: "ficha", token: rv.token, id: ficha.id });
assert(fr.ok, JSON.stringify(fr)); assert.equal(fr.ficha.pet_nombre, "Juan Pérez"); assert.equal(fr.fotos.length, 0);
// devolver exige observaciones
assert.equal(g.post({ accion: "revisar", token: rv.token, id: ficha.id, decision: "devolver" }).ok, false);
const dv = g.post({ accion: "revisar", token: rv.token, id: ficha.id, decision: "devolver", obs: "Falta el registro fotográfico" });
assert(dv.ok); assert.equal(dv.revision.estado, "Devuelta"); assert.equal(dv.revision.obs, "Falta el registro fotográfico");
const lc2 = g.post({ accion: "conceptos", token: tk }).conceptos[0];
assert.equal(lc2.estado, "Devuelta"); assert.equal(lc2.obs_revision, "Falta el registro fotográfico"); assert.equal(lc2.evaluador, "eva@carder.gov.co");
// el proyectista corrige: vuelve a revisión, con una foto
assert(g.post({ accion: "guardar", token: tk, ficha: { ...ficha, edif: "Edificio Prueba", suscribe_correo: "rev@carder.gov.co" }, fotos_ids: ["f9"] }).ok);
assert(g.post({ accion: "foto", token: tk, id: ficha.id, foto_id: "f9", n: 1, b64: jpeg, d: "Fachada" }).ok);
assert.equal(g.tabla("Conceptos")[0].estado, "En revisión");
const fr2 = g.post({ accion: "ficha", token: rv.token, id: ficha.id }); assert.equal(fr2.fotos.length, 1);
const fb = g.post({ accion: "fotob64", token: rv.token, id: ficha.id, foto_id: "f9" });
assert(fb.ok); assert.equal(fb.b64, jpeg, "la foto baja igual");
// el revisor corrige un texto (sin cambiar el estado) y aprueba
assert(g.post({ accion: "guardar", token: rv.token, ficha: { ...ficha, edif: "Edificio Prueba", analisis: "Corregido por revisión", suscribe_correo: "rev@carder.gov.co" }, fotos_ids: ["f9"] }).ok);
assert.equal(g.tabla("Conceptos")[0].estado, "En revisión"); assert.equal(g.tabla("Conceptos")[0].evaluador, "eva@carder.gov.co");
const ap = g.post({ accion: "revisar", token: rv.token, id: ficha.id, decision: "aprobar" });
assert(ap.ok); assert.equal(ap.revision.estado, "Aprobada"); assert.equal(ap.suscribe.n, "Revisor Prueba"); assert.equal(ap.suscribe.m, "999");
assert(g.post({ accion: "documento", token: rv.token, id: ficha.id, nombre: "CT - final.doc", html: "<html>final</html>" }).ok, "el revisor sube el documento final");
// el revisor proyecta y suscribe la suya: queda aprobada de una vez
const propia = g.post({ accion: "guardar", token: rv.token, ficha: { id: "22222222-bbbb", mpio: "Marsella", edif: "Casa", suscribe_correo: "rev@carder.gov.co" }, fotos_ids: [] });
assert(propia.ok); assert.equal(propia.revision.estado, "Aprobada"); assert.equal(propia.consecutivo, "VE-2026-0002");
// bloqueo por intentos
for (let i = 0; i < 5; i++) g.post({ accion: "ingresar", correo: "otro@carder.gov.co", pin: "1" });
assert(/intentos/.test(g.post({ accion: "ingresar", correo: "otro@carder.gov.co", pin: "654321" }).error));
// salir invalida el token
g.post({ accion: "salir", token: tk }); assert.equal(g.post({ accion: "conceptos", token: tk }).code, "SESION");
assert.equal(g.post({ accion: "conceptos", token: rv.token }).conceptos.length, 2);
// usuario inactivo
console.log("Bitácora:", g.tabla("Bitacora").map(b => b.accion).join(","));
console.log("TODAS LAS PRUEBAS DEL SERVIDOR PASARON");
