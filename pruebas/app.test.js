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
  await page.waitForFunction(() => document.getElementById("ed-estado").textContent === "Enviada", null, { timeout: 15000 });
  const conc = g.tabla("Conceptos"); console.log("hoja Conceptos:", conc.length, conc[0].consecutivo, conc[0].estado, conc[0].hab, conc[0].pet_nombre, "cols:", Object.keys(conc[0]).length);
  assert.equal(conc[0].consecutivo, "VE-2026-0001");
  assert.equal(g.tabla("Fotos").length, 1); assert.equal(g.tabla("Solicitudes")[0].estado, "Atendida");
  const archivos = [...g.files.values()].filter(f => f.kind === "file" && !f.trashed);
  console.log("Drive:", archivos.map(f => `${f.parent.name}/${f.name} (${Math.round(f.size / 1024)} KB)`));
  // vista previa
  await page.click("#nav button[data-i='8']");
  await page.waitForSelector("#hoja table");
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
  console.log("después de volver la señal:", g.tabla("Conceptos").map(c => c.consecutivo + " " + c.edif).join(" | "));
  // recargar: sesión y datos persisten
  await page.reload(); await page.waitForSelector("#v-inicio.on"); await page.waitForSelector("#l-mias .item");
  assert.equal(await page.locator("#l-mias .item").count(), 2);
  // móvil
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  const mp = await m.newPage(); mp.on("pageerror", e => errores.push("móvil: " + e.message));
  await mp.goto("http://localhost:8765/"); await mp.waitForSelector("#v-ingreso.on");
  await mp.fill("#in-correo", "eva@carder.gov.co"); await mp.fill("#in-pin", "123456"); await mp.click("#b-entrar");
  await mp.waitForSelector("#v-inicio.on"); await mp.screenshot({ path: DIR + "/m-inicio.png" });
  await mp.click("#b-nueva"); await mp.waitForSelector("#v-editor.on");
  for (const i of [0, 3, 4, 8]) {
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
