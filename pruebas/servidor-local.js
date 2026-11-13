const http = require("http"), fs = require("fs"), path = require("path");
const { crear } = require("./gas-falso");
const ROOT = path.resolve(__dirname, "..");
function iniciar(port, { local = false } = {}) {
  const g = crear(ROOT + "/apps-script/Code.gs");
  g.ctx.configurar();
  const U = g.ss.getSheetByName("Usuarios");
  U.appendRow(["eva@carder.gov.co", "Eva Prueba", "proyectista", "SI", "Ingeniera Civil", "Profesional Universitario", "RIS-12345", g.hash("sal1123456"), "sal1", "", ""]);
  U.appendRow(["rev@carder.gov.co", "Revisor Prueba", "revisor", "SI", "Ingeniero Civil", "Profesional Especializado", "RIS-999", g.hash("sal2222222"), "sal2", "", ""]);
  const S = g.ss.getSheetByName("Solicitudes");
  S.appendRow(["S1", "SAIA", "20261104-111-E", new Date("2026-11-04T12:00:00Z"), "Subdirector SCORE", "Correo", new Date("2026-11-06T12:00:00Z"), "eva@carder.gov.co", "Pereira", "Centro", "Cra 7 # 19-20", "Edificio Prueba", "Solicito visita por grietas", "Persona natural", "Juan Pérez", "1088", "Calle 1", "300", "j@x.co", "Propietario", "NA", "Asignada", ""]);
  const tipos = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpg": "image/jpeg", ".png": "image/png" };
  const srv = http.createServer((req, res) => {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/exec") {
      if (req.method === "OPTIONS") { res.writeHead(204, { "access-control-allow-origin": "*" }); return res.end(); }
      let b = ""; req.on("data", c => b += c); req.on("end", () => {
        if (srv.caido) { req.socket.destroy(); return; }
        const out = g.ctx.doPost({ postData: { contents: b } }).s;
        res.writeHead(200, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(out);
      }); return;
    }
    let p = u.pathname === "/" ? "/index.html" : u.pathname;
    const f = path.join(ROOT, p);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    let body = fs.readFileSync(f);
    // Las pruebas nunca llaman al servidor real: se reemplaza la URL configurada.
    if (p === "/config.js") body = Buffer.from(body.toString().replace(/APPS_SCRIPT_URL: "[^"]*"/, `APPS_SCRIPT_URL: "${local ? "" : `http://localhost:${port}/exec`}"`));
    res.writeHead(200, { "content-type": tipos[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" }); res.end(body);
  });
  return new Promise(ok => srv.listen(port, () => ok({ srv, g })));
}
module.exports = { iniciar };
