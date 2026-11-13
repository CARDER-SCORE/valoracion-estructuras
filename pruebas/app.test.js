const { chromium } = require("playwright");
const assert = require("assert");
const { iniciar } = require("./servidor-local");
const DIR = require("os").tmpdir();
const FOTO = require("path").join(__dirname, "foto-prueba.jpg");
(async () => {
  const { srv, g } = await iniciar(8765);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ["geolocation"], geolocation: { latitude: 4.8133, longitude: -75.6961, accuracy: 5 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errores = [];
  page.on("pageerror", e => errores.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error") errores.push("console: " + m.text()); });
  await page.goto("http://localhost:8765/");
  // coordenadas
  const geo = await page.evaluate(() => [window.__geo.aOrigenNacional(4.8133, -75.6961), window.__geo.aOrigenNacional(5.2, -75.9)]);
  console.log("CTM12:", geo);
  assert(Math.abs(geo[0].este - 4701052.641) < 0.05 && Math.abs(geo[0].norte - 2090453.971) < 0.05, "conversión Pereira");
  assert(Math.abs(geo[1].este - 4678614.562) < 0.05 && Math.abs(geo[1].norte - 2133329.219) < 0.05, "conversión 2");
  // ingreso
  await page.waitForSelector("#v-ingreso.on");
  await page.fill("#in-correo", "eva@carder.gov.co"); await page.fill("#in-pin", "999999"); await page.click("#b-entrar");
  await page.waitForFunction(() => document.getElementById("in-error").textContent.length > 0);
  console.log("error PIN:", await page.textContent("#in-error"));
  await page.fill("#in-pin", "123456"); await page.click("#b-entrar");
  await page.waitForSelector("#v-inicio.on");
  await page.waitForSelector("[data-sol=S1]");
  await page.screenshot({ path: DIR + "/s-inicio.png" });
  await page.click("[data-sol=S1]");
  await page.waitForSelector("#v-editor.on");
  assert.equal(await page.inputValue("#pet_nombre"), "Juan Pérez");
  assert.equal(await page.inputValue("#doc_fecha"), "2026-11-04");
  assert.equal(await page.inputValue("#mpio"), "Pereira");
  // paso 2: GPS
  await page.click("#nav button[data-i='1']");
  await page.click("#b-gps");
  await page.waitForFunction(() => document.getElementById("norte").value !== "");
  console.log("GPS:", await page.inputValue("#norte"), await page.inputValue("#este"), await page.textContent("#gps-info"));
  await page.fill("#v_hora", "09:30");
  // paso 4: daños + foto
  await page.click("#nav button[data-i='3']");
  await page.check("#pg_grietas_terreno");
  await page.click("label[for=est_muros_port_M]");
  await page.click("label[for=noest_fachada_S]");
  await page.fill("#aspectos", "Fisuras diagonales en muros del primer piso.");
  await page.setInputFiles("#f-fotos", FOTO);
  await page.waitForSelector("#fotos img");
  const fotoInfo = await page.evaluate(() => { const s = document.querySelector("#fotos img").src; const im = document.querySelector("#fotos img"); return { kb: Math.round(s.length * 0.75 / 1024), w: im.naturalWidth, h: im.naturalHeight }; });
  console.log("foto:", fotoInfo); assert.equal(fotoInfo.w, 1200);
  assert.notEqual(await page.inputValue("[data-fo='0'][data-fk='n']"), "", "foto con GPS");
  await page.fill("[data-fo='0'][data-fk='d']", "Fachada con grieta");
  // paso 5: clasificación
  await page.click("#nav button[data-i='4']");
  await page.click("#b-usar");
  assert(await page.isChecked("#hab_AMARILLO"));
  // paso 6
  await page.click("#nav button[data-i='5']");
  await page.click("#b-concl");
  assert((await page.inputValue("#conclusiones")).includes("Edificio Prueba"));
  // paso 8: enviar sin firma -> falta? firma viene del perfil
  await page.click("#nav button[data-i='7']");
  const firma = await page.inputValue("[data-fi='0'][data-fk='n']");
  console.log("firma perfil:", firma); assert.equal(firma, "EVA PRUEBA");
  // Word
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#b-word")]);
  const wpath = DIR + "/" + dl.suggestedFilename(); await dl.saveAs(wpath);
  const wtxt = require("fs").readFileSync(wpath, "utf8");
  console.log("word:", dl.suggestedFilename(), Math.round(wtxt.length / 1024), "KB, imgs:", (wtxt.match(/<img/g) || []).length);
  assert(wtxt.includes("data:image/jpeg;base64"), "logo/foto embebidos");
  // enviar
  await page.click("#b-enviar");
  await page.waitForFunction(() => document.getElementById("ed-estado").textContent === "En revisión", null, { timeout: 15000 });
  const conc = g.tabla("Conceptos"); console.log("hoja Conceptos:", conc.length, conc[0].consecutivo, conc[0].estado, conc[0].hab, conc[0].pet_nombre, "cols:", Object.keys(conc[0]).length);
  assert.equal(conc[0].consecutivo, "VE-2026-0001"); assert.equal(conc[0].estado, "En revisión");
  assert.equal(conc[0].suscribe_correo, "rev@carder.gov.co", "por defecto suscribe el revisor");
  assert.equal(g.tabla("Fotos").length, 1); assert.equal(g.tabla("Solicitudes")[0].estado, "Atendida");
  const archivos = [...g.files.values()].filter(f => f.kind === "file" && !f.trashed);
  console.log("Drive:", archivos.map(f => `${f.parent.name}/${f.name} (${Math.round(f.size / 1024)} KB)`));
  // vista previa
  await page.click("#nav button[data-i='8']");
  await page.waitForSelector("#hoja table");
  assert((await page.textContent("#hoja")).includes("BORRADOR"), "sin aprobar sale como borrador");
  assert((await page.textContent("#hoja")).includes("REVISOR PRUEBA"), "suscribe el revisor");
  assert((await page.textContent("#hoja")).includes("Proyectó: EVA PRUEBA"), "proyectó");
  assert(!(await page.textContent("body")).includes("PTI"), "sin menciones al PTI");
  await page.screenshot({ path: DIR + "/s-preview.png", fullPage: false });
  await page.click("#b-volver");
  await page.waitForSelector("#v-inicio.on");
  await page.waitForSelector("#l-mias .item");
  await page.screenshot({ path: DIR + "/s-inicio2.png" });
  assert.equal(await page.locator("#l-mias .pill.p-enviada").count(), 1, "sigue enviada al volver sin cambios");
  assert.equal(g.tabla("Bitacora").filter(b => b.accion === "actualizar").length, 0, "no reenvía sin cambios");
  // sin señal: nueva valoración en el mismo punto
  await ctx.setOffline(true);
  await page.click("#b-nueva");
  await page.waitForSelector("#v-editor.on");
  await page.click("#nav button[data-i='1']");
  await page.fill("#edif", "Casa vecina");
  await page.click("#b-gps");
  await page.waitForSelector("#cerca:not([hidden])");
  console.log("cercanía:", (await page.textContent("#cerca")).slice(0, 120));
  await page.click("#nav button[data-i='4']"); await page.click("#hab_VERDE");
  await page.click("#nav button[data-i='5']"); await page.click("#b-concl");
  await page.click("#nav button[data-i='7']"); await page.click("#b-enviar");
  await page.waitForFunction(() => document.getElementById("ed-estado").textContent === "Por enviar");
  await page.click("#b-volver");
  await page.waitForSelector("#v-inicio.on");
  console.log("red:", await page.textContent("#red"));
  await ctx.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.waitForFunction(() => [...document.querySelectorAll("#l-mias .pill")].filter(p => p.textContent === "Enviada").length === 2, null, { timeout: 15000 });
  // ----- Revisor: revisa, devuelve una y aprueba la otra -----
  const rc = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // Los mosaicos de mapas (OpenStreetMap, Esri, SGC) no se piden en la prueba: se responde una imagen vacía.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
  await rc.route(u => !u.href.startsWith("http://localhost"), r => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  const rp = await rc.newPage(); rp.on("pageerror", e => errores.push("revisor: " + e.message)); rp.on("console", m => { if (m.type() === "error") errores.push("revisor console: " + m.text()); });
  await rp.goto("http://localhost:8765/"); await rp.waitForSelector("#v-ingreso.on");
  await rp.fill("#in-correo", "rev@carder.gov.co"); await rp.fill("#in-pin", "222222"); await rp.click("#b-entrar");
  await rp.waitForSelector("#v-inicio.on"); await rp.waitForSelector("#l-revisar [data-srv]");
  assert.equal(await rp.locator("#l-revisar [data-srv]").count(), 2);
  assert.equal(await rp.textContent("#n-envios"), "2", "contador de por revisar");
  await rp.screenshot({ path: DIR + "/r-inicio.png" });
  const idA = conc[0].id;
  await rp.click(`#l-revisar [data-srv="${idA}"]`);
  await rp.waitForSelector("#v-editor.on");
  assert.equal(await rp.inputValue("#pet_nombre"), "Juan Pérez", "baja la ficha completa");
  await rp.click("#nav button[data-i='3']"); await rp.waitForSelector("#fotos img");
  assert.equal(await rp.inputValue("[data-fo='0'][data-fk='d']"), "Fachada con grieta", "baja la foto");
  await rp.click("#nav button[data-i='7']");
  assert(await rp.isVisible("#c-revision")); assert(!(await rp.isVisible("#b-enviar")));
  await rp.click("#b-devolver");
  assert.equal(g.tabla("Conceptos")[0].estado, "En revisión", "devolver sin observaciones no hace nada");
  await rp.fill("#obs_revision_txt", "Precise la descripción de la fisura en el muro.");
  await rp.click("#b-devolver");
  await rp.waitForFunction(() => document.getElementById("ed-estado").textContent === "Devuelta", null, { timeout: 15000 });
  assert.equal(g.tabla("Conceptos")[0].estado, "Devuelta");
  // la proyectista ve la devolución en Envíos y corrige
  await page.click("#b-sync");
  await page.waitForFunction(() => document.getElementById("n-envios").textContent === "1", null, { timeout: 15000 });
  await page.click("#b-envios"); await page.waitForSelector("#v-envios.on"); await page.waitForSelector("#l-envios .item");
  assert((await page.textContent("#l-envios")).includes("Precise la descripción"));
  await page.screenshot({ path: DIR + "/s-envios.png" });
  await page.click(`#l-envios [data-srv="${idA}"]`); await page.waitForSelector("#v-editor.on");
  assert(await page.isVisible("#ed-obs")); assert((await page.textContent("#ed-obs")).includes("Precise"));
  await page.click("#nav button[data-i='3']"); await page.fill("#estd_muros_port", "fisura diagonal de 2 mm en muro del primer piso");
  await page.click("#nav button[data-i='7']");
  await page.click("#b-enviar");
  await page.waitForFunction(() => document.getElementById("ed-estado").textContent === "En revisión", null, { timeout: 15000 });
  assert.equal(g.tabla("Conceptos")[0].estado, "En revisión");
  // el revisor sincroniza, corrige un texto y aprueba
  await rp.click("#b-volver"); await rp.waitForSelector("#v-inicio.on");
  await rp.click("#b-sync"); await rp.waitForFunction(() => !document.getElementById("b-sync").disabled);
  assert.equal(await rp.locator(`#l-mias [data-abrir="${idA}"]`).count(), 0, "la copia vieja se quitó al cambiar en el servidor");
  await rp.click(`#l-revisar [data-srv="${idA}"]`); await rp.waitForSelector("#v-editor.on");
  await rp.click("#nav button[data-i='5']"); await rp.fill("#analisis", "Análisis ajustado en la revisión.");
  await rp.click("#nav button[data-i='7']"); await rp.fill("#obs_revision_txt", "");
  await rp.click("#b-aprobar");
  await rp.waitForFunction(() => document.getElementById("ed-estado").textContent === "Aprobada", null, { timeout: 15000 });
  const ca = g.tabla("Conceptos").find(c => c.id === idA);
  assert.equal(ca.estado, "Aprobada"); assert.equal(ca.suscribe_nombre, "Revisor Prueba"); assert.equal(ca.analisis, "Análisis ajustado en la revisión.");
  assert.equal(ca.estd_muros_port, "fisura diagonal de 2 mm en muro del primer piso", "la corrección de la proyectista llegó");
  const docFinal = [...g.files.values()].filter(f => f.kind === "file" && !f.trashed && /\.doc$/.test(f.name) && f.parent.name.startsWith("VE-2026-0001"));
  assert.equal(docFinal.length, 1); const htmlFinal = Buffer.from(docFinal[0].bytes).toString("utf8");
  assert(!/^BORRADOR/.test(docFinal[0].name) && !htmlFinal.includes("NO VÁLIDO HASTA"), "el Word final no dice borrador: " + docFinal[0].name);
  assert(htmlFinal.includes("REVISOR PRUEBA") && htmlFinal.includes("Proyectó: EVA PRUEBA"));
  await rp.click("#nav button[data-i='8']"); await rp.screenshot({ path: DIR + "/r-preview.png" });
  // mapa, tablero y perfil del revisor
  await rp.click("#b-volver"); await rp.click("#tabs [data-tab=mapa]"); await rp.waitForSelector("#v-mapa.on");
  await rp.waitForSelector("#mapa .leaflet-interactive");
  console.log("mapa:", await rp.textContent("#m-info"));
  assert.equal(await rp.locator("#mapa path.leaflet-interactive").count(), 2);
  await rp.screenshot({ path: DIR + "/r-mapa.png" });
  await rp.click("#tabs [data-tab=tablero]"); await rp.waitForSelector("#tb-kpis .kpi");
  const kp = await rp.textContent("#tb-kpis"); console.log("tablero:", kp.replace(/\s+/g, " "));
  assert(/^2valoraciones/.test(kp.replace(/\s+/g, "")), "kpi total");
  await rp.screenshot({ path: DIR + "/r-tablero.png", fullPage: true });
  await rp.click("#b-perfil"); await rp.waitForSelector("#p-datos dl");
  assert((await rp.textContent("#p-datos")).includes("Revisa y suscribe"));
  await rp.screenshot({ path: DIR + "/r-perfil.png" });
  await rc.close();
  console.log("después de volver la señal:", g.tabla("Conceptos").map(c => c.consecutivo + " " + c.edif).join(" | "));
  // recargar: sesión y datos persisten
  await page.click("#tabs [data-tab=inicio]");
  await page.reload(); await page.waitForSelector("#v-inicio.on"); await page.waitForSelector("#l-mias .item");
  // la copia de la aprobada se quitó (el revisor la corrigió); queda en Envíos y se descarga al abrirla
  assert.equal(await page.locator("#l-mias .item").count(), 1);
  await page.click("#b-envios"); await page.waitForSelector("#l-envios .item");
  assert((await page.textContent("#l-envios")).includes("Aprobada"));
  // móvil
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await m.route(u => !u.href.startsWith("http://localhost"), r => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
  const mp = await m.newPage(); mp.on("pageerror", e => errores.push("móvil: " + e.message));
  await mp.goto("http://localhost:8765/"); await mp.waitForSelector("#v-ingreso.on");
  await mp.fill("#in-correo", "eva@carder.gov.co"); await mp.fill("#in-pin", "123456"); await mp.click("#b-entrar");
  await mp.waitForSelector("#v-inicio.on"); await mp.screenshot({ path: DIR + "/m-inicio.png" });
  for (const t of ["mapa", "tablero", "inicio"]) {
    await mp.click(`#tabs [data-tab=${t}]`); await mp.waitForTimeout(300);
    const ov = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (ov > 0) errores.push(`desborde horizontal en ${t}: ${ov}px`);
  }
  await mp.click("#tabs [data-tab=mapa]"); await mp.waitForTimeout(500); await mp.screenshot({ path: DIR + "/m-mapa.png" });
  await mp.click("#tabs [data-tab=inicio]");
  await mp.click("#b-nueva"); await mp.waitForSelector("#v-editor.on");
  for (const i of [0, 3, 4, 7, 8]) {
    await mp.click(`#nav button[data-i='${i}']`);
    const ov = await mp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (ov > 0) errores.push(`desborde horizontal paso ${i}: ${ov}px`);
  }
  await mp.click("#nav button[data-i='3']"); await mp.screenshot({ path: DIR + "/m-danos.png" });
  console.log("errores:", errores);
  await browser.close(); srv.close();
  if (errores.length) process.exit(1);
  console.log("E2E OK");
})().catch(e => { console.error(e); process.exit(1); });
