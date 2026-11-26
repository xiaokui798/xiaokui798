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
  ["/enemies.mjs", ["enemies.mjs", "text/javascript; charset=utf-8"]],
  ["/recipes.mjs", ["recipes.mjs", "text/javascript; charset=utf-8"]],
  ["/save.mjs", ["save.mjs", "text/javascript; charset=utf-8"]],
  ["/hud.mjs", ["hud.mjs", "text/javascript; charset=utf-8"]],
  ["/inventory-ui.mjs", ["inventory-ui.mjs", "text/javascript; charset=utf-8"]],
  ["/item-icons.mjs", ["item-icons.mjs", "text/javascript; charset=utf-8"]],
  ["/boss-render.mjs", ["boss-render.mjs", "text/javascript; charset=utf-8"]],
  ["/input.mjs", ["input.mjs", "text/javascript; charset=utf-8"]],
  ["/waves.mjs", ["waves.mjs", "text/javascript; charset=utf-8"]],
  ["/difficulty.mjs", ["difficulty.mjs", "text/javascript; charset=utf-8"]],
  ["/weapons.mjs", ["weapons.mjs", "text/javascript; charset=utf-8"]],
  ["/armor.mjs", ["armor.mjs", "text/javascript; charset=utf-8"]],
  ["/tools.mjs", ["tools.mjs", "text/javascript; charset=utf-8"]],
  ["/tech.mjs", ["tech.mjs", "text/javascript; charset=utf-8"]],
  ["/durability.mjs", ["durability.mjs", "text/javascript; charset=utf-8"]],
  ["/crops.mjs", ["crops.mjs", "text/javascript; charset=utf-8"]],
  ["/controls.mjs", ["controls.mjs", "text/javascript; charset=utf-8"]],
  ["/movement.mjs", ["movement.mjs", "text/javascript; charset=utf-8"]],
  ["/boss.mjs", ["boss.mjs", "text/javascript; charset=utf-8"]],
  ["/forge-audio.mjs", ["forge-audio.mjs", "text/javascript; charset=utf-8"]],
  ["/weapon-assets.mjs", ["weapon-assets.mjs", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]]
]);
for (const name of ["laserSmall_003", "impactMetal_001", "explosionCrunch_002", "lowFrequency_explosion_001"]) {
  const file = "assets/" + name + ".ogg";
  files.set("/" + file, [file, "audio/ogg"]);
}
for (const name of fs.readdirSync(path.join(__dirname, "icons"))) {
  if (name.endsWith(".svg")) files.set("/icons/" + name, ["icons/" + name, "image/svg+xml"]);
}

const server = http.createServer((req, res) => {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "X-Content-Type-Options": "nosniff" }).end();
    return;
  }
  const pathname = req.url.split("?", 1)[0];
  if (pathname === "/favicon.ico") {
    res.writeHead(204, { "X-Content-Type-Options": "nosniff" }).end();
    return;
  }
  const asset = files.get(pathname);
  if (!asset) {
    res.writeHead(404, { "X-Content-Type-Options": "nosniff" }).end();
    return;
  }
  const [filename, contentType] = asset;
  fs.readFile(path.join(__dirname, filename), (error, content) => {
    if (error) {
      res.writeHead(500, { "X-Content-Type-Options": "nosniff" }).end();
      return;
    }
    res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : content);
});
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error(`端口 ${port} 已被占用：先停掉已在运行的方块世界服务，或用 WORLD_PORT=4174 node server.js 换一个端口。`);
  } else {
    console.error(error);
  }
  process.exit(1);
});

server.listen(port, "0.0.0.0", () => console.log(`方块世界已启动：http://127.0.0.1:${port}（监听 0.0.0.0，本机网卡地址也可访问）`));
