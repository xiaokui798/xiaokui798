// server.js 的回归测试：import 图与白名单必须一致，且白名单里的文件都能 200。
// 自包含：临时端口上起一个独立的 server 进程，不依赖已在跑的 4173 端口。
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const serverSource = fs.readFileSync(path.join(dir, "server.js"), "utf8");

// 白名单分两部分：files Map 里的字面量条目，和循环登记的 assets/*.ogg。
function parseWhitelist(source) {
  const routes = new Set();
  for (const match of source.matchAll(/\[\s*"(\/[^"]*)"\s*,/g)) routes.add(match[1]);
  const oggList = source.match(/for \(const name of \[([^\]]+)\]\)/);
  if (oggList) {
    for (const match of oggList[1].matchAll(/"([^"]+)"/g)) {
      routes.add(`/assets/${match[1]}.ogg`);
    }
  }
  return routes;
}

const whitelist = parseWhitelist(serverSource);

// 业务源码（不含 *.test.mjs，测试文件的 import 不走浏览器/服务器）。
function sourceFiles() {
  return fs.readdirSync(dir)
    .filter((name) => /\.m?js$/.test(name) && !name.endsWith(".test.mjs") && name !== "server.js")
    .map((name) => path.join(dir, name));
}

function relativeImports(file) {
  const source = fs.readFileSync(file, "utf8");
  const imports = [];
  const pattern = /from\s+["'](\.[^"']+)["']|import\s+["'](\.[^"']+)["']|import\(\s*["'](\.[^"']+)["']\s*\)/g;
  for (const match of source.matchAll(pattern)) {
    imports.push(match[1] ?? match[2] ?? match[3]);
  }
  return imports;
}

function toRoute(file, specifier) {
  const resolved = path.resolve(path.dirname(file), specifier);
  return `/${path.relative(dir, resolved).split(path.sep).join("/")}`;
}

test("每个相对导入都在 server.js 白名单里或在 assets 下", () => {
  assert.ok(whitelist.size > 0, "白名单解析为空，server.js 的 files Map 可能改了格式");
  for (const file of sourceFiles()) {
    for (const specifier of relativeImports(file)) {
      const route = toRoute(file, specifier);
      assert.ok(
        fs.existsSync(path.join(dir, route.slice(1))),
        `${path.basename(file)} 导入的 ${specifier} 在磁盘上不存在`,
      );
      assert.ok(
        whitelist.has(route) || route.startsWith("/assets/"),
        `${path.basename(file)} 导入的 ${specifier}（${route}）不在 server.js 白名单里`,
      );
    }
  }
});

test("forge-audio.mjs 必须在白名单里", () => {
  assert.ok(whitelist.has("/forge-audio.mjs"), "白名单里没有 /forge-audio.mjs，game.js 的静态导入会 404");
});

function startServer(port) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", ["server.js"], {
      cwd: dir,
      env: { ...process.env, WORLD_PORT: String(port) },
    });
    let output = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`server 在端口 ${port} 上 5 秒内未启动，输出：${output}`));
    }, 5000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
      if (output.includes("方块世界已启动")) {
        clearTimeout(timer);
        child._baseUrl = `http://127.0.0.1:${port}`;
        resolve(child);
      }
    });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`server 在端口 ${port} 上启动失败，退出码 ${code}，输出：${output}`));
    });
  });
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 2000)),
  ]);
}

test("临时端口上的 server：白名单里的每个文件都返回 200 且带 nosniff", async () => {
  let child;
  let lastError;
  // 随机高位端口，极小概率撞上已有服务时换一个再试。
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = 49152 + Math.floor(Math.random() * 16383);
    try {
      child = await startServer(port);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!child) throw lastError;
  const base = child._baseUrl;
  try {
    for (const route of [...whitelist].sort()) {
      const response = await fetch(`${base}${route}`);
      assert.equal(response.status, 200, `${route} 应返回 200，实际 ${response.status}`);
      assert.equal(
        response.headers.get("x-content-type-options"), "nosniff",
        `${route} 应带 X-Content-Type-Options: nosniff`,
      );
      await response.arrayBuffer();
    }
    const favicon = await fetch(`${base}/favicon.ico`);
    assert.equal(favicon.status, 204, `/favicon.ico 应返回 204，实际 ${favicon.status}`);
    assert.equal(favicon.headers.get("x-content-type-options"), "nosniff");
    const missing = await fetch(`${base}/does-not-exist.js`);
    assert.equal(missing.status, 404, "不存在的路径应返回 404");
  } finally {
    await stopServer(child);
  }
});
