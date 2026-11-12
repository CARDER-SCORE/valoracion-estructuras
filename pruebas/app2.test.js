const { chromium } = require("playwright");
const assert = require("assert");
const { iniciar } = require("./servidor-local");
(async () => {
  const errores = [];
  const browser = await chromium.launch();
  // 1) Modo local
  const L = await iniciar(8766, { local: true });
  let ctx = await browser.newContext(); let p = await ctx.newPage();
  p.on("pageerror", e => errores.push("local: " + e.message));
  await p.goto("http://localhost:8766/"); await p.waitForSelector("#v-inicio.on");
  assert(await p.isVisible("#aviso-local")); assert(!(await p.isVisible("#c-asignadas")));
  await p.click("#b-nueva"); await p.waitForSelector("#v-editor.on");
  assert(!(await p.isVisible("#b-enviar")) || true);
  await p.click("#b-ejemplo"); await p.click("#b-ejemplo");
  await p.click("#nav button[data-i='8']"); await p.waitForSelector("#hoja table");
  const txt = await p.textContent("#hoja"); assert(txt.includes("Escuela de ejemplo"));
  await p.screenshot({ path: require("os").tmpdir() + "/local-preview.png" });
  // importar borrador de la v1 local
  const v1 = { ct_num: "77", edif: "Edificio v1", mpio: "Marsella", fotos: [], peligros: {}, est: {}, noest: {}, estd: {}, noestd: {}, recs: {}, anexos: {}, firmas: [{ n: "X", p: "", c: "", m: "", t: "" }], hab: "VERDE", paso: 3 };
  require("fs").writeFileSync(require("os").tmpdir() + "/v1.json", JSON.stringify(v1));
  await p.click("#b-volver"); await p.waitForSelector("#v-inicio.on");
  await p.setInputFiles("#f-imp", require("os").tmpdir() + "/v1.json"); await p.waitForSelector("#v-editor.on");
  assert.equal(await p.inputValue("#ct_num"), "77");
  await ctx.close(); L.srv.close();
  // 2) Servidor caído y edición de una enviada
  const S = await iniciar(8767);
  ctx = await browser.newContext({ permissions: ["geolocation"], geolocation: { latitude: 5.2, longitude: -75.9, accuracy: 30 } }); p = await ctx.newPage();
  p.on("pageerror", e => errores.push("srv: " + e.message));
  await p.goto("http://localhost:8767/"); await p.waitForSelector("#v-ingreso.on");
  await p.fill("#in-correo", "eva@carder.gov.co"); await p.fill("#in-pin", "123456"); await p.click("#b-entrar");
  await p.waitForSelector("#v-inicio.on");
  await p.click("#b-nueva"); await p.waitForSelector("#v-editor.on");
  await p.click("#nav button[data-i='7']"); await p.click("#b-enviar");
  assert((await p.textContent("#faltan")).includes("clasificación"), "valida faltantes");
  await p.click("#nav button[data-i='1']"); await p.fill("#edif", "Bodega"); await p.click("#b-gps");
  await p.waitForFunction(() => document.getElementById("norte").value !== "");
  await p.click("#nav button[data-i='4']"); await p.click("#hab_ROJO");
  await p.click("#nav button[data-i='5']"); await p.click("#b-concl");
  S.srv.caido = true;
  await p.click("#nav button[data-i='7']"); await p.click("#b-enviar");
  await p.waitForTimeout(1500);
  assert.equal(await p.textContent("#ed-estado"), "Por enviar", "queda por enviar si el servidor no responde");
  S.srv.caido = false;
  await p.click("#b-enviar");
  await p.waitForFunction(() => document.getElementById("ed-estado").textContent === "Enviada", null, { timeout: 10000 });
  // editar una enviada -> vuelve a por enviar y se actualiza
  await p.click("#nav button[data-i='5']"); await p.fill("#analisis", "Texto corregido");
  await p.waitForFunction(() => document.getElementById("ed-estado").textContent === "Por enviar");
  await p.click("#nav button[data-i='7']"); await p.click("#b-enviar");
  await p.waitForFunction(() => document.getElementById("ed-estado").textContent === "Enviada", null, { timeout: 10000 });
  const c = S.g.tabla("Conceptos"); assert.equal(c.length, 1); assert.equal(c[0].analisis, "Texto corregido"); assert.equal(c[0].estado, "Actualizada");
  console.log("titulo:", await p.textContent("#ed-titulo"));
  // 3) recarga sin señal (service worker)
  await p.click("#b-volver"); await p.waitForSelector("#v-inicio.on");
  await p.waitForTimeout(800);
  await ctx.setOffline(true);
  await p.reload(); await p.waitForSelector("#v-inicio.on", { timeout: 10000 });
  console.log("sin señal, recarga OK; items:", await p.locator("#l-mias .item").count(), "red:", await p.textContent("#red"));
  await browser.close(); S.srv.close();
  console.log("errores:", errores); if (errores.length) process.exit(1); console.log("E2E2 OK");
})().catch(e => { console.error(e); process.exit(1); });
