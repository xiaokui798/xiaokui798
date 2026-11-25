// Dependency-free local server for this static WebGL project.
const http = require("http");
const fs = require("fs");
const path = require("path");
const port = Number(process.env.WORLD_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("WORLD_PORT must be a valid port number.");
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/game.js", ["game.js", "text/javascript; charset=utf-8"]],
  ["/progression.mjs", ["progression.mjs", "text/javascript; charset=utf-8"]],
  ["/terrain.mjs", ["terrain.mjs", "text/javascript; charset=utf-8"]],
  ["/defense.mjs", ["defense.mjs", "text/javascript; charset=utf-8"]],
  ["/controls.mjs", ["controls.mjs", "text/javascript; charset=utf-8"]],
  ["/movement.mjs", ["movement.mjs", "text/javascript; charset=utf-8"]],
  ["/boss.mjs", ["boss.mjs", "text/javascript; charset=utf-8"]],
  ["/weapon-assets.mjs", ["weapon-assets.mjs", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);
for (const name of ["laserSmall_003", "impactMetal_001", "explosionCrunch_002", "lowFrequency_explosion_001"]) {
  const file = "assets/" + name + ".ogg";
  files.set("/" + file, [file, "audio/ogg"]);
}

http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  const asset = files.get(req.url.split("?", 1)[0]);
  if (!asset) {
    res.writeHead(404).end();
    return;
  }
  const [filename, contentType] = asset;
  fs.readFile(path.join(__dirname, filename), (error, content) => {
    if (error) {
      res.writeHead(500).end();
      return;
    }
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store" });
    res.end(req.method === "HEAD" ? undefined : content);
});
}).listen(port, "127.0.0.1", () => console.log(`方块世界已启动：http://127.0.0.1:${port}`));
