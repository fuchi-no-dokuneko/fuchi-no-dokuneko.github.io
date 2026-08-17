#!/usr/bin/env node

import { spawn } from "node:child_process";
import { constants as fsConstants, createReadStream } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const reportDirectory = path.resolve(process.argv[2] || "build/reports/browser-uat");
const testPath = process.argv[3] || "/tests/browser-smoke.html";
const timeoutMs = Number(process.env.UAT_TIMEOUT_MS || 60_000);

const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".yaml", "application/yaml; charset=utf-8"],
  [".yml", "application/yaml; charset=utf-8"],
]);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function workflowError(title, message) {
  if (!process.env.GITHUB_ACTIONS) return;
  const escape = (value) => String(value)
    .replaceAll("%", "%25")
    .replaceAll("\r", "%0D")
    .replaceAll("\n", "%0A");
  process.stderr.write(`::error title=${escape(title)}::${escape(message)}\n`);
}

async function findBrowser() {
  const candidates = [
    process.env.BROWSER_BIN,
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/snap/bin/chromium",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next known browser path.
    }
  }
  throw new Error("Chromium or Google Chrome was not found");
}

async function startStaticServer() {
  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      let pathname = decodeURIComponent(requestUrl.pathname);
      if (pathname.endsWith("/")) pathname += "index.html";
      const file = path.resolve(root, `.${pathname}`);
      const rootPrefix = `${root}${path.sep}`;
      if (file !== root && !file.startsWith(rootPrefix)) {
        response.writeHead(403).end("Forbidden");
        return;
      }

      const fileStat = await stat(file);
      if (!fileStat.isFile()) throw new Error("Not a file");
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Length": fileStat.size,
        "Content-Type": mimeTypes.get(path.extname(file).toLowerCase()) || "application/octet-stream",
      });
      createReadStream(file).pipe(response);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return server;
}

async function unusedPort() {
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result || {});
        return;
      }
      for (const listener of this.listeners.get(message.method) || []) {
        listener(message.params || {});
      }
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", () => reject(new Error("Could not connect to Chromium DevTools")), { once: true });
    });
    return new CdpClient(socket);
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  call(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function connectToPage(debugPort, browserProcess, browserLog) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(`Chromium exited before DevTools was ready\n${browserLog()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return CdpClient.connect(page.webSocketDebuggerUrl);
    } catch {
      // Chromium is still starting.
    }
    await sleep(100);
  }
  throw new Error(`Timed out waiting for Chromium DevTools\n${browserLog()}`);
}

function applicationUrl(url, origin) {
  try {
    const parsed = new URL(url);
    return parsed.origin === origin
      && !parsed.pathname.includes("/tests/")
      && !parsed.pathname.includes("/vendor/")
      && /\.(?:html|js|mjs)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function executableLine(trimmed) {
  return trimmed
    && !trimmed.startsWith("//")
    && !trimmed.startsWith("/*")
    && !trimmed.startsWith("*")
    && trimmed !== "*/";
}

function lineCoverage(source, ranges, firstLine) {
  const results = [];
  let offset = 0;
  const lines = source.split("\n");

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!executableLine(trimmed)) {
      offset += line.length + 1;
      continue;
    }

    const nonWhitespace = line.search(/\S/);
    const position = offset + Math.max(0, nonWhitespace);
    const containing = ranges
      .filter((range) => range.startOffset <= position && position < range.endOffset)
      .sort((left, right) => (left.endOffset - left.startOffset) - (right.endOffset - right.startOffset));
    const intersecting = containing.length ? containing : ranges
      .filter((range) => range.startOffset < offset + line.length && range.endOffset > offset)
      .sort((left, right) => (left.endOffset - left.startOffset) - (right.endOffset - right.startOffset));

    if (intersecting.length) {
      results.push({ line: firstLine + index + 1, count: intersecting[0].count > 0 ? 1 : 0 });
    }
    offset += line.length + 1;
  }
  return results;
}

async function createCoverageReports(client, coverageEntries, scripts, origin) {
  const files = new Map();

  for (const entry of coverageEntries) {
    if (!applicationUrl(entry.url, origin)) continue;
    let source;
    try {
      ({ scriptSource: source } = await client.call("Debugger.getScriptSource", { scriptId: entry.scriptId }));
    } catch {
      continue;
    }

    const parsed = new URL(entry.url);
    const relativePath = decodeURIComponent(parsed.pathname).replace(/^\/+/, "");
    const metadata = scripts.get(entry.scriptId) || {};
    const ranges = entry.functions.flatMap((item) => item.ranges);
    const lines = lineCoverage(source, ranges, Number(metadata.startLine || 0));
    const current = files.get(relativePath) || { lines: new Map(), functions: 0, coveredFunctions: 0 };

    for (const item of lines) {
      current.lines.set(item.line, Math.max(current.lines.get(item.line) || 0, item.count));
    }
    for (const item of entry.functions) {
      if (!item.ranges.length) continue;
      current.functions += 1;
      if (item.ranges[0].count > 0) current.coveredFunctions += 1;
    }
    files.set(relativePath, current);
  }

  const rows = [...files.entries()].sort(([left], [right]) => left.localeCompare(right));
  let totalLines = 0;
  let coveredLines = 0;
  let totalFunctions = 0;
  let coveredFunctions = 0;
  const lcov = [];
  const reportFiles = [];

  for (const [file, data] of rows) {
    const lines = [...data.lines.entries()].sort(([left], [right]) => left - right);
    const hitLines = lines.filter(([, count]) => count > 0).length;
    totalLines += lines.length;
    coveredLines += hitLines;
    totalFunctions += data.functions;
    coveredFunctions += data.coveredFunctions;
    reportFiles.push({
      file,
      lines: lines.length,
      coveredLines: hitLines,
      functions: data.functions,
      coveredFunctions: data.coveredFunctions,
    });

    lcov.push("TN:browser-uat", `SF:${file}`);
    for (const [line, count] of lines) lcov.push(`DA:${line},${count}`);
    lcov.push(`LF:${lines.length}`, `LH:${hitLines}`, "end_of_record");
  }

  await writeFile(path.join(reportDirectory, "lcov.info"), `${lcov.join("\n")}\n`);
  const report = {
    coveredFunctions,
    coveredLines,
    files: reportFiles,
    functionPercent: totalFunctions ? (coveredFunctions / totalFunctions) * 100 : 0,
    linePercent: totalLines ? (coveredLines / totalLines) * 100 : 0,
    totalFunctions,
    totalLines,
  };
  await writeFile(path.join(reportDirectory, "coverage.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

function parseChecks(resultText) {
  const lines = resultText.trim().split(/\r?\n/);
  const checks = lines.slice(1).flatMap((line) => {
    const match = line.match(/^(PASS|FAIL)\s+(.+)$/);
    return match ? [{ name: match[2], passed: match[1] === "PASS" }] : [];
  });
  return checks.length ? checks : [{ name: "browser acceptance test", passed: lines[0] === "PASS" }];
}

async function writeTestReports(checks, durationMs, resultText, coverage) {
  const failures = checks.filter((check) => !check.passed).length;
  const testCases = checks.map((check) => {
    const failure = check.passed ? "" : `<failure message="UAT assertion failed">${xml(check.name)}</failure>`;
    return `    <testcase classname="browser.uat" name="${xml(check.name)}" time="0">${failure}</testcase>`;
  });
  const junit = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="browser-uat" tests="${checks.length}" failures="${failures}" time="${(durationMs / 1000).toFixed(3)}">`,
    ...testCases,
    `  <system-out>${xml(resultText)}</system-out>`,
    "</testsuite>",
    "",
  ].join("\n");
  await writeFile(path.join(reportDirectory, "junit.xml"), junit);

  const sonarCases = checks.map((check) => {
    const failure = check.passed ? "" : `<failure message="UAT assertion failed">${xml(check.name)}</failure>`;
    return `    <testCase name="${xml(check.name)}" duration="0">${failure}</testCase>`;
  });
  const sonar = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testExecutions version="1">',
    `  <file path="${xml(testPath.replace(/^\/+/, ""))}">`,
    ...sonarCases,
    "  </file>",
    "</testExecutions>",
    "",
  ].join("\n");
  await writeFile(path.join(reportDirectory, "sonar-test-execution.xml"), sonar);

  const status = failures ? "FAIL" : "PASS";
  const summary = [
    "## Browser unit and UAT report",
    "",
    `- Status: **${status}**`,
    `- Assertions: **${checks.length - failures}/${checks.length} passed**`,
    `- Application line coverage: **${coverage.linePercent.toFixed(1)}%** (${coverage.coveredLines}/${coverage.totalLines})`,
    `- Application function coverage: **${coverage.functionPercent.toFixed(1)}%** (${coverage.coveredFunctions}/${coverage.totalFunctions})`,
    "",
    "| Assertion | Result |",
    "| --- | --- |",
    ...checks.map((check) => `| ${check.name.replaceAll("|", "\\|")} | ${check.passed ? "PASS" : "FAIL"} |`),
    "",
    "| Covered file | Lines | Functions |",
    "| --- | ---: | ---: |",
    ...coverage.files.map((file) => `| ${file.file} | ${file.coveredLines}/${file.lines} | ${file.coveredFunctions}/${file.functions} |`),
    "",
  ].join("\n");
  await writeFile(path.join(reportDirectory, "summary.md"), summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  }
}

async function main() {
  await mkdir(reportDirectory, { recursive: true });
  const browserPath = await findBrowser();
  const server = await startStaticServer();
  const serverPort = server.address().port;
  const debugPort = await unusedPort();
  const profileDirectory = await mkdtemp(path.join(os.tmpdir(), "browser-uat-"));
  let browserOutput = "";
  const browser = spawn(browserPath, [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  browser.stdout.on("data", (chunk) => { browserOutput += chunk; });
  browser.stderr.on("data", (chunk) => { browserOutput += chunk; });

  let client;
  const startedAt = Date.now();
  try {
    client = await connectToPage(debugPort, browser, () => browserOutput.slice(-4000));
    const scripts = new Map();
    client.on("Debugger.scriptParsed", (script) => scripts.set(script.scriptId, script));
    await client.call("Page.enable");
    await client.call("Runtime.enable");
    await client.call("Debugger.enable");
    await client.call("Profiler.enable");
    await client.call("Profiler.startPreciseCoverage", { callCount: true, detailed: true });

    const url = `http://127.0.0.1:${serverPort}${testPath}`;
    await client.call("Page.navigate", { url });
    let title = "RUNNING";
    let resultText = "RUNNING";
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const evaluated = await client.call("Runtime.evaluate", {
        expression: 'JSON.stringify({title: document.title, result: document.getElementById("result")?.textContent || ""})',
        returnByValue: true,
      });
      if (evaluated.result?.value) {
        const state = JSON.parse(evaluated.result.value);
        title = state.title;
        resultText = state.result;
      }
      if (title === "PASS" || title === "FAIL") break;
      await sleep(100);
    }

    const screenshot = await client.call("Page.captureScreenshot", { format: "png", fromSurface: true });
    await writeFile(path.join(reportDirectory, "screenshot.png"), Buffer.from(screenshot.data, "base64"));
    const { result: coverageEntries } = await client.call("Profiler.takePreciseCoverage");
    await client.call("Profiler.stopPreciseCoverage");
    const coverage = await createCoverageReports(client, coverageEntries, scripts, new URL(url).origin);
    const checks = parseChecks(resultText);
    await writeFile(path.join(reportDirectory, "result.txt"), `${resultText}\n`);
    await writeTestReports(checks, Date.now() - startedAt, resultText, coverage);

    process.stdout.write(`${resultText}\n`);
    process.stdout.write(`Line coverage ${coverage.coveredLines}/${coverage.totalLines} (${coverage.linePercent.toFixed(1)}%)\n`);
    if (title !== "PASS" || checks.some((check) => !check.passed)) {
      workflowError("Browser UAT failed", resultText);
      process.exitCode = 1;
    }
    if (!coverage.totalLines) {
      const message = "No application coverage was collected";
      process.stderr.write(`${message}\n`);
      workflowError("Browser coverage failed", message);
      process.exitCode = 1;
    }
  } finally {
    client?.close();
    browser.kill("SIGTERM");
    await new Promise((resolve) => server.close(resolve));
    await rm(profileDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  const message = error.stack || error;
  process.stderr.write(`${message}\n`);
  workflowError("Browser UAT runner failed", message);
  process.exitCode = 1;
});
