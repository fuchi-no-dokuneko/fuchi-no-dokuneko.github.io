const { execFileSync, spawnSync } = require("node:child_process");
const { resolve4 } = require("node:dns/promises");
const { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");
const { deflateSync } = require("node:zlib");
const { XMLParser } = require("fast-xml-parser");
const { Builder, By, Select, until } = require("selenium-webdriver");
const chrome = require("selenium-webdriver/chrome");

const root = path.resolve(__dirname, "..");
const acceptanceDirectory = __dirname;
const config = JSON.parse(readFileSync(path.join(acceptanceDirectory, "project.json"), "utf8"));

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const timeoutMs = () => Number(process.env.ACCEPTANCE_TIMEOUT_SECONDS || config.timeoutSeconds || 45) * 1000;

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "scenario";
}

async function ensureBrowser(world) {
  if (world.driver) return world.driver;
  const downloadDirectory = path.join(process.env.ACCEPTANCE_REPORT_DIR, "downloads");
  mkdirSync(downloadDirectory, { recursive: true });
  const options = new chrome.Options();
  const base = new URL(process.env.UAT_BASE_URL || config.baseUrl);
  const requestedHosts = [base.hostname, ...(config.ipv4Hosts || [])];
  const mappings = ["MAP localhost 127.0.0.1"];
  for (const host of [...new Set(requestedHosts)]) {
    if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host) || host === "localhost") continue;
    if (!/^[a-z0-9.-]+$/i.test(host)) throw new Error(`Unsafe browser host in IPv4 mapping: ${host}`);
    const addresses = await resolve4(host);
    if (!addresses.length) throw new Error(`No IPv4 address found for browser host: ${host}`);
    mappings.push(`MAP ${host} ${addresses[0]}`);
  }
  options.addArguments(
    "--window-size=1440,1000",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--remote-debugging-pipe",
    "--disable-ipv6",
    `--host-resolver-rules=${mappings.join(", ")}`
  );
  if (process.env.ACCEPTANCE_HEADLESS === "1") options.addArguments("--headless=new", "--disable-gpu");
  if (process.env.CHROME_BINARY) options.setChromeBinaryPath(process.env.CHROME_BINARY);
  options.setUserPreferences({
    "download.default_directory": downloadDirectory,
    "download.prompt_for_download": false,
    "download.directory_upgrade": true,
    "safebrowsing.enabled": true,
  });
  const driverBinary = process.env.CHROMEDRIVER_PATH || (existsSync("/usr/bin/chromedriver") ? "/usr/bin/chromedriver" : "");
  const builder = new Builder().forBrowser("chrome").setChromeOptions(options);
  if (driverBinary) builder.setChromeService(new chrome.ServiceBuilder(driverBinary));
  world.driver = await builder.build();
  await world.driver.manage().setTimeouts({ pageLoad: timeoutMs(), script: timeoutMs() });
  world.downloadDirectory = downloadDirectory;
  world.downloadBaseline = new Set(readdirSync(downloadDirectory, { withFileTypes: false }));
  return world.driver;
}

async function openWeb(world, pathname) {
  const driver = await ensureBrowser(world);
  const base = process.env.UAT_BASE_URL || config.baseUrl;
  if (!base) throw new Error("UAT_BASE_URL or project.json baseUrl is required.");
  await driver.get(new URL(pathname, base).href);
}

async function cssElement(world, selector, visible = true) {
  const driver = await ensureBrowser(world);
  const element = await driver.wait(until.elementLocated(By.css(selector)), timeoutMs(), `CSS not found: ${selector}`);
  if (visible) await driver.wait(until.elementIsVisible(element), timeoutMs(), `CSS not visible: ${selector}`);
  return element;
}

async function clickCss(world, selector) {
  const driver = await ensureBrowser(world);
  const element = await cssElement(world, selector);
  await driver.executeScript("arguments[0].scrollIntoView({block:'center',inline:'center'});", element);
  await driver.wait(until.elementIsEnabled(element), timeoutMs());
  await element.click();
}

async function replaceCss(world, selector, value) {
  const driver = await ensureBrowser(world);
  const element = await cssElement(world, selector);
  await driver.executeScript(`
    const element = arguments[0];
    const value = String(arguments[1]);
    const prototype = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value").set;
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  `, element, value);
}

async function waitCssText(world, selector, expected, shouldContain = true) {
  const driver = await ensureBrowser(world);
  await driver.wait(async () => {
    try {
      const text = await (await cssElement(world, selector, false)).getText();
      return shouldContain ? text.includes(expected) : !text.includes(expected);
    } catch {
      return !shouldContain;
    }
  }, timeoutMs(), `CSS ${selector} did not ${shouldContain ? "contain" : "exclude"} ${expected}`);
}

async function waitCssCount(world, selector, minimum) {
  const driver = await ensureBrowser(world);
  await driver.wait(async () => (await driver.findElements(By.css(selector))).length >= minimum, timeoutMs(), `Expected at least ${minimum} matches for ${selector}`);
}

async function waitCssExactCount(world, selector, expected) {
  const driver = await ensureBrowser(world);
  await driver.wait(async () => (await driver.findElements(By.css(selector))).length === expected, timeoutMs(), `Expected exactly ${expected} matches for ${selector}`);
}

async function waitCssValue(world, selector, predicate, description) {
  const driver = await ensureBrowser(world);
  await driver.wait(async () => {
    try {
      return predicate(await (await cssElement(world, selector, false)).getAttribute("value"));
    } catch {
      return false;
    }
  }, timeoutMs(), `CSS ${selector} did not reach ${description}`);
}

async function waitJavaScript(world, expression) {
  const driver = await ensureBrowser(world);
  await driver.wait(
    async () => Boolean(await driver.executeScript(`return Boolean(${expression});`)),
    timeoutMs(),
    `JavaScript expression did not become true: ${expression}`
  );
}

async function switchToNewestWindow(world) {
  const driver = await ensureBrowser(world);
  await driver.wait(async () => (await driver.getAllWindowHandles()).length > 1, timeoutMs(), "A second browser window did not open.");
  const handles = await driver.getAllWindowHandles();
  await driver.switchTo().window(handles[handles.length - 1]);
}

async function nameCurrentWindow(world, name) {
  const driver = await ensureBrowser(world);
  world.browserWindows.set(name, await driver.getWindowHandle());
}

async function openNewWindow(world, pathname, name) {
  const driver = await ensureBrowser(world);
  const before = new Set(await driver.getAllWindowHandles());
  const target = new URL(pathname, process.env.UAT_BASE_URL || config.baseUrl).href;
  await driver.executeScript("window.open(arguments[0], '_blank');", target);
  await driver.wait(async () => (await driver.getAllWindowHandles()).some((handle) => !before.has(handle)), timeoutMs());
  const handle = (await driver.getAllWindowHandles()).find((candidate) => !before.has(candidate));
  world.browserWindows.set(name, handle);
  await driver.switchTo().window(handle);
}

async function switchToNamedWindow(world, name) {
  const handle = world.browserWindows?.get(name);
  if (!handle) throw new Error(`No browser window named ${name}`);
  await (await ensureBrowser(world)).switchTo().window(handle);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  name.copy(output, 4);
  data.copy(output, 8);
  output.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return output;
}

function makePng(alternate = false) {
  const width = 8;
  const height = 8;
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 4);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const offset = row + 1 + x * 4;
      const center = x >= 2 && x <= 5 && y >= 2 && y <= 5;
      const color = center ? (alternate ? [210, 45, 70] : [25, 145, 90]) : [255, 255, 255];
      raw[offset] = color[0];
      raw[offset + 1] = color[1];
      raw[offset + 2] = color[2];
      raw[offset + 3] = 255;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makePdf(pageCount) {
  const objects = new Array(3 + pageCount * 2);
  const pageIds = Array.from({ length: pageCount }, (_, index) => 3 + index);
  const contentIds = Array.from({ length: pageCount }, (_, index) => 3 + pageCount + index);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;
  pageIds.forEach((id, index) => {
    objects[id] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents ${contentIds[index]} 0 R >>`;
    const stream = `${20 + index * 20} ${20 + index * 20} 80 80 re S\n`;
    objects[contentIds[index]] = `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`;
  });
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(output);
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(output, "ascii");
}

function acceptanceFixture(world, name) {
  const directory = path.join(process.env.ACCEPTANCE_REPORT_DIR, "fixtures");
  mkdirSync(directory, { recursive: true });
  const fixtures = {
    "sample.txt": Buffer.from("UsefulTool acceptance text\nsecond line\n", "utf8"),
    "sample.md": Buffer.from("# Acceptance note\n\nA **local** Markdown fixture.\n", "utf8"),
    "draft-key.json": Buffer.from(JSON.stringify({
      version: 1,
      activeId: "fixture-draft",
      drafts: [{
        id: "fixture-draft",
        name: "Key draft",
        text: "Imported key text",
        mode: "markdown",
        updatedAt: 1,
      }],
    }), "utf8"),
    "sample.png": makePng(false),
    "sample-alt.png": makePng(true),
    "one-page.pdf": makePdf(1),
    "two-page.pdf": makePdf(2),
    "invalid.txt": Buffer.from("not an image or PDF", "utf8"),
  };
  if (!Object.hasOwn(fixtures, name)) throw new Error(`Unknown acceptance fixture: ${name}`);
  const target = path.join(directory, name);
  writeFileSync(target, fixtures[name]);
  return target;
}

async function uploadAcceptanceFixtures(world, selector, names) {
  if (!names.length) throw new Error("At least one acceptance fixture is required.");
  const input = await cssElement(world, selector, false);
  await input.sendKeys(names.map((name) => acceptanceFixture(world, name)).join("\n"));
}

function wildcardExpression(pattern) {
  const escaped = pattern.split("*").map((part) => part.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")).join(".*");
  return new RegExp(`^${escaped}$`);
}

async function waitForDownloadedFile(world, pattern) {
  const expression = wildcardExpression(pattern);
  const deadline = Date.now() + timeoutMs();
  while (Date.now() < deadline) {
    const names = readdirSync(world.downloadDirectory || "", { withFileTypes: false });
    const match = names.find((name) => !world.downloadBaseline?.has(name) && expression.test(name) && !name.endsWith(".crdownload"));
    if (match) {
      world.downloadBaseline.add(match);
      return match;
    }
    await sleep(250);
  }
  throw new Error(`New download did not appear: ${pattern}`);
}

async function canvasChecksum(world, selector) {
  const driver = await ensureBrowser(world);
  const canvas = await cssElement(world, selector);
  return driver.executeScript(`
    const canvas = arguments[0];
    const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (let index = 0; index < data.length; index += 17) {
      hash ^= data[index];
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  `, canvas);
}

async function clickBoardPoint(world, selector, column, row, size) {
  const driver = await ensureBrowser(world);
  const canvas = await cssElement(world, selector);
  await driver.executeScript(`
    const canvas = arguments[0];
    const column = arguments[1];
    const row = arguments[2];
    const size = arguments[3];
    const rectangle = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: rectangle.left + rectangle.width * column / (size + 1),
      clientY: rectangle.top + rectangle.height * row / (size + 1),
    }));
  `, canvas, column, row, size);
}

function adbPrefix() {
  return process.env.ANDROID_SERIAL ? ["-s", process.env.ANDROID_SERIAL] : [];
}

function adb(args, options = {}) {
  const executable = process.env.ADB_BIN || "adb";
  const result = spawnSync(executable, [...adbPrefix(), ...args], {
    encoding: options.binary ? null : "utf8",
    timeout: options.timeout || timeoutMs(),
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    throw new Error(`adb ${args.join(" ")} failed: ${String(result.stderr || result.stdout).trim()}`);
  }
  return options.binary ? result.stdout : String(result.stdout || "").trim();
}

function androidState() {
  if (adb(["get-state"]) !== "device") throw new Error("ADB device is not in the device state.");
}

function androidInstalled() {
  const output = adb(["shell", "pm", "path", config.appPackage], { allowFailure: true });
  if (!output.includes("package:")) throw new Error(`${config.appPackage} is not installed on the selected Android device.`);
}

async function launchAndroid() {
  androidState();
  androidInstalled();
  adb(["shell", "am", "force-stop", config.appPackage]);
  adb(["shell", "am", "start", "-W", "-n", `${config.appPackage}/${config.mainActivity}`]);
  await sleep(700);
}

async function stopConfiguredAndroidService() {
  if (!config.serviceClass || !config.stopServiceAction) {
    throw new Error("project.json must define serviceClass and stopServiceAction for this step.");
  }
  adb([
    "shell", "am", "startservice",
    "-n", `${config.appPackage}/${config.serviceClass}`,
    "-a", config.stopServiceAction,
  ], { allowFailure: true });
  await sleep(500);
}

function parseBounds(value) {
  const match = String(value || "").match(/^\[(\d+),(\d+)]\[(\d+),(\d+)]$/);
  if (!match) return null;
  const [, x1, y1, x2, y2] = match.map(Number);
  return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1, area: Math.max(1, (x2 - x1) * (y2 - y1)) };
}

function flattenXml(document) {
  const flat = [];
  function visit(raw, parent) {
    if (!raw) return;
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      const item = { raw: value, parent, children: [], bounds: parseBounds(value.bounds) };
      flat.push(item);
      if (parent) parent.children.push(item);
      visit(value.node, item);
    }
  }
  visit(document.hierarchy?.node, null);
  return flat;
}

function dumpAndroid() {
  let lastError;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      adb(["shell", "uiautomator", "dump", "/sdcard/acceptance-window.xml"]);
      const xml = adb(["exec-out", "cat", "/sdcard/acceptance-window.xml"]);
      const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "" }).parse(xml);
      return flattenXml(parsed);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function displayedText(node) {
  return String(node.raw.text || node.raw["content-desc"] || "").trim();
}

function matchingNodes(nodes, text, contains = false) {
  return nodes.filter((node) => {
    const value = displayedText(node);
    return contains ? value.includes(text) : value === text;
  });
}

function screenSize() {
  const output = adb(["shell", "wm", "size"]);
  const matches = [...output.matchAll(/(\d+)x(\d+)/g)];
  if (!matches.length) return { width: 1080, height: 1920 };
  const match = matches[matches.length - 1];
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function swipeUp() {
  const { width, height } = screenSize();
  adb(["shell", "input", "swipe", String(width / 2), String(height * 0.78), String(width / 2), String(height * 0.3), "420"]);
  await sleep(300);
}

async function scrollAndroidToTop() {
  const { width, height } = screenSize();
  for (let attempt = 0; attempt < 10; attempt += 1) {
    adb(["shell", "input", "swipe", String(width / 2), String(height * 0.28), String(width / 2), String(height * 0.82), "260"]);
    await sleep(90);
  }
}

async function findAndroidText(text, options = {}) {
  const attempts = options.scroll === false ? 1 : 9;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const nodes = dumpAndroid();
    const matches = matchingNodes(nodes, text, Boolean(options.contains));
    if (matches.length) return { nodes, matches };
    if (attempt + 1 < attempts) await swipeUp();
  }
  throw new Error(`Android text not found: ${text}`);
}

function clickableAncestor(node) {
  let current = node;
  while (current && current.raw.clickable !== "true") current = current.parent;
  return current || node;
}

function tapNode(node) {
  const target = clickableAncestor(node);
  if (!target.bounds) throw new Error(`Android node has no tappable bounds: ${displayedText(node)}`);
  const x = Math.round((target.bounds.x1 + target.bounds.x2) / 2);
  const y = Math.round((target.bounds.y1 + target.bounds.y2) / 2);
  adb(["shell", "input", "tap", String(x), String(y)]);
}

async function tapAndroidText(text, options = {}) {
  const found = await findAndroidText(text, options);
  const enabled = found.matches.find((node) => node.raw.enabled !== "false") || found.matches[0];
  tapNode(enabled);
  await sleep(350);
}

async function tapAndroidTextIfEnabled(text) {
  const nodes = dumpAndroid();
  const match = matchingNodes(nodes, text, false).find((node) => node.raw.enabled !== "false");
  if (!match) return false;
  tapNode(match);
  await sleep(350);
  return true;
}

async function startTemporaryAndroidRecording(world, text) {
  await tapAndroidText(text);
  world.androidTemporaryStopText = "Stop";
}

async function stopTemporaryAndroidRecording(world, text) {
  await tapAndroidText(text);
  world.androidTemporaryStopText = null;
}

function ancestorChain(node) {
  const values = [];
  for (let current = node; current; current = current.parent) values.push(current);
  return values;
}

async function tapInSamePanel(buttonText, anchorText, buttonContains = false) {
  const { nodes, matches: anchors } = await findAndroidText(anchorText, { contains: false });
  const buttons = matchingNodes(nodes, buttonText, buttonContains);
  let best = null;
  for (const anchor of anchors) {
    const anchorAncestors = new Set(ancestorChain(anchor));
    for (const button of buttons) {
      const common = ancestorChain(button).find((ancestor) => anchorAncestors.has(ancestor));
      if (!common?.bounds) continue;
      if (!best || common.bounds.area < best.area) best = { button, area: common.bounds.area };
    }
  }
  if (!best) throw new Error(`Could not associate ${buttonText} with panel containing ${anchorText}`);
  tapNode(best.button);
  await sleep(350);
}

async function waitAndroidText(text, options = {}) {
  const deadline = Date.now() + timeoutMs();
  while (Date.now() < deadline) {
    const nodes = dumpAndroid();
    if (matchingNodes(nodes, text, Boolean(options.contains)).length) return;
    await sleep(300);
  }
  throw new Error(`Timed out waiting for Android text: ${text}`);
}

function androidTextVisible(text, contains = false) {
  return matchingNodes(dumpAndroid(), text, contains).length > 0;
}

async function androidFieldNode(label) {
  const { nodes, matches } = await findAndroidText(label, { contains: false });
  const labelNode = matches[0];
  const editables = nodes.filter((node) => String(node.raw.class || "").includes("EditText") && node.bounds);
  const below = editables
    .filter((node) => !labelNode.bounds || node.bounds.y1 >= labelNode.bounds.y1)
    .sort((left, right) => {
      const leftDistance = labelNode.bounds ? Math.abs(left.bounds.y1 - labelNode.bounds.y2) : left.bounds.y1;
      const rightDistance = labelNode.bounds ? Math.abs(right.bounds.y1 - labelNode.bounds.y2) : right.bounds.y1;
      return leftDistance - rightDistance;
    });
  const field = below[0] || editables[0];
  if (!field) throw new Error(`No editable Android field found for label: ${label}`);
  return field;
}

function androidEditableNodes() {
  return dumpAndroid().filter((node) => String(node.raw.class || "").includes("EditText") && node.bounds);
}

function androidFieldNodeByIndex(index) {
  const fields = androidEditableNodes();
  if (index < 1 || index > fields.length) throw new Error(`Android editable field ${index} was not found; visible fields: ${fields.length}`);
  return fields[index - 1];
}

async function replaceAndroidNode(field, value) {
  tapNode(field);
  await sleep(150);
  adb(["shell", "input", "keyevent", "123"]);
  for (let batch = 0; batch < 5; batch += 1) adb(["shell", "input", "keyevent", ...Array(24).fill("67")]);
  if (!/^[\w .:@+%-]*$/.test(value)) throw new Error("Android input contains unsupported shell characters.");
  if (value) adb(["shell", "input", "text", value.replaceAll(" ", "%s")]);
  await sleep(200);
}

async function replaceAndroidField(label, value) {
  await replaceAndroidNode(await androidFieldNode(label), value);
}

async function replaceAndroidFieldByIndex(index, value) {
  await replaceAndroidNode(androidFieldNodeByIndex(index), value);
}

async function androidFieldValue(label) {
  return displayedText(await androidFieldNode(label));
}

async function androidFieldValueByIndex(index) {
  return displayedText(androidFieldNodeByIndex(index));
}

async function rememberAndroidField(world, label, applyButton) {
  world.androidFieldMemories.set(label, { value: await androidFieldValue(label), applyButton });
}

async function restoreAndroidField(world, label) {
  const memory = world.androidFieldMemories?.get(label);
  if (!memory) throw new Error(`No remembered Android field: ${label}`);
  await replaceAndroidField(label, memory.value);
  adb(["shell", "input", "keyevent", "4"]);
  await tapAndroidText(memory.applyButton);
  world.androidFieldMemories.delete(label);
}

function commonAncestorArea(left, right) {
  const leftAncestors = new Set(ancestorChain(left));
  const common = ancestorChain(right).find((ancestor) => leftAncestors.has(ancestor) && ancestor.bounds);
  return common?.bounds?.area || Number.MAX_SAFE_INTEGER;
}

async function androidToggleNode(label) {
  const { nodes, matches } = await findAndroidText(label, { contains: false });
  const toggles = nodes.filter((node) => /CheckBox|Switch/.test(String(node.raw.class || "")) && node.bounds);
  const direct = matches.find((node) => toggles.includes(node));
  if (direct) return direct;
  let best;
  for (const labelNode of matches) {
    for (const toggle of toggles) {
      const area = commonAncestorArea(labelNode, toggle);
      const distance = labelNode.bounds && toggle.bounds
        ? Math.abs((labelNode.bounds.y1 + labelNode.bounds.y2) / 2 - (toggle.bounds.y1 + toggle.bounds.y2) / 2)
        : 100000;
      const score = area + distance;
      if (!best || score < best.score) best = { toggle, score };
    }
  }
  if (!best) throw new Error(`No Android checkbox or switch found for label: ${label}`);
  return best.toggle;
}

async function androidToggleState(label) {
  return (await androidToggleNode(label)).raw.checked === "true";
}

async function setAndroidToggle(label, checked) {
  const node = await androidToggleNode(label);
  if ((node.raw.checked === "true") !== checked) {
    tapNode(node);
    await sleep(300);
  }
  if (await androidToggleState(label) !== checked) throw new Error(`Android toggle did not change: ${label}`);
}

async function rememberAndroidToggle(world, label) {
  world.androidToggleMemories.set(label, await androidToggleState(label));
}

async function restoreAndroidToggle(world, label) {
  if (!world.androidToggleMemories?.has(label)) throw new Error(`No remembered Android checkbox: ${label}`);
  await setAndroidToggle(label, world.androidToggleMemories.get(label));
  world.androidToggleMemories.delete(label);
}

async function tapAndroidTextRepeated(text, count) {
  if (count < 1 || count > 500) throw new Error("Repeated Android tap count must be from 1 through 500.");
  const found = await findAndroidText(text);
  const target = clickableAncestor(found.matches[0]);
  if (!target.bounds) throw new Error(`Android node has no bounds: ${text}`);
  const x = Math.round((target.bounds.x1 + target.bounds.x2) / 2);
  const y = Math.round((target.bounds.y1 + target.bounds.y2) / 2);
  const script = `i=0; while [ $i -lt ${count} ]; do input tap ${x} ${y}; i=$((i+1)); sleep 0.14; done`;
  adb(["shell", "sh", "-c", script], { timeout: Math.max(timeoutMs(), count * 250) });
  await sleep(500);
}

async function rememberAndroidTextBounds(world, text, name) {
  const found = await findAndroidText(text);
  const bounds = found.matches[0].bounds;
  if (!bounds) throw new Error(`Android text has no bounds: ${text}`);
  world.androidBounds.set(name, bounds);
}

async function androidTextBoundsDiffer(world, text, name) {
  const before = world.androidBounds?.get(name);
  if (!before) throw new Error(`No remembered Android bounds named ${name}`);
  const found = await findAndroidText(text);
  const after = found.matches[0].bounds;
  return Boolean(after && (before.x1 !== after.x1 || before.y1 !== after.y1 || before.x2 !== after.x2 || before.y2 !== after.y2));
}

function configuredAndroidAppIsForeground() {
  const output = adb(["shell", "dumpsys", "window", "windows"], { allowFailure: true });
  return output.includes(`${config.appPackage}/`);
}

async function selectAndroidOption(option, index = 1) {
  let nodes = dumpAndroid();
  let spinners = nodes.filter((node) => String(node.raw.class || "").includes("Spinner"));
  for (let attempt = 0; spinners.length < index && attempt < 8; attempt += 1) {
    await swipeUp();
    nodes = dumpAndroid();
    spinners = nodes.filter((node) => String(node.raw.class || "").includes("Spinner"));
  }
  if (spinners.length < index) throw new Error(`Android spinner ${index} was not found.`);
  tapNode(spinners[index - 1]);
  await sleep(300);
  await tapAndroidText(option, { scroll: false });
}

function listAndroidEntries(directory) {
  const output = adb(["shell", "find", directory, "-mindepth", "1", "-maxdepth", "1", "-print"], { allowFailure: true });
  return new Set(output.split(/\r?\n/).map((value) => value.trim()).filter((value) => value.startsWith(`${directory}/`)));
}

async function waitForNewAndroidEntry(world, directory) {
  const before = world.androidSnapshots?.get(directory) || new Set();
  const deadline = Date.now() + timeoutMs();
  while (Date.now() < deadline) {
    const current = listAndroidEntries(directory);
    if ([...current].some((entry) => !before.has(entry))) return;
    await sleep(500);
  }
  throw new Error(`No new Android entry appeared under ${directory}`);
}

async function waitForNewAndroidEntries(world, directory, minimum) {
  const before = world.androidSnapshots?.get(directory) || new Set();
  const deadline = Date.now() + timeoutMs();
  while (Date.now() < deadline) {
    const current = listAndroidEntries(directory);
    if ([...current].filter((entry) => !before.has(entry)).length >= minimum) return;
    await sleep(500);
  }
  throw new Error(`Fewer than ${minimum} new Android entries appeared under ${directory}`);
}

function cleanupAndroidEntries(world, directory) {
  const before = world.androidSnapshots?.get(directory) || new Set();
  const current = listAndroidEntries(directory);
  for (const entry of current) {
    if (!before.has(entry) && entry.startsWith(`${directory}/`) && entry.length > directory.length + 1) {
      adb(["shell", "rm", "-rf", entry]);
    }
  }
}

function runExternalCommand(variable, extraEnvironment = {}) {
  const executable = process.env[variable];
  if (!executable) return false;
  const result = spawnSync(executable, [], {
    env: { ...process.env, ...extraEnvironment },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${variable} exited with status ${result.status}`);
  return true;
}

async function beginRecording(world) {
  runExternalCommand("DEMO_RECORD_START_COMMAND", { DEMO_SUITE: process.env.ACCEPTANCE_SUITE, DEMO_REPOSITORY: config.repository });
  world.demoRecording = true;
}

async function finishRecording(world) {
  if (!world.demoRecording) return;
  runExternalCommand("DEMO_RECORD_STOP_COMMAND", { DEMO_SUITE: process.env.ACCEPTANCE_SUITE, DEMO_REPOSITORY: config.repository });
  world.demoRecording = false;
}

async function narrate(language, minimumSeconds, text) {
  const started = Date.now();
  const invoked = runExternalCommand("DEMO_TTS_COMMAND", {
    DEMO_TTS_LANGUAGE: language,
    DEMO_TTS_TEXT: text,
    DEMO_TTS_MIN_SECONDS: String(minimumSeconds),
  });
  if (!invoked) process.stdout.write(`NARRATION [${language}, >=${minimumSeconds}s]: ${text}\n`);
  const remaining = minimumSeconds * 1000 - (Date.now() - started);
  if (remaining > 0) await sleep(remaining);
}

async function captureScenario(world, scenarioName) {
  const directory = process.env.ACCEPTANCE_REPORT_DIR;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  const target = path.join(directory, `${slug(scenarioName)}.png`);
  try {
    if (world.driver) {
      writeFileSync(target, await world.driver.takeScreenshot(), "base64");
    } else if (config.platform === "android") {
      const image = adb(["exec-out", "screencap", "-p"], { binary: true, allowFailure: true });
      if (image?.length) writeFileSync(target, image);
    }
  } catch (error) {
    process.stderr.write(`Could not capture scenario screenshot: ${error.message}\n`);
  }
}

async function closeWorld(world) {
  if (world.androidTemporaryStopText) {
    try {
      await tapAndroidTextIfEnabled(world.androidTemporaryStopText);
      await sleep(700);
    } catch (error) {
      process.stderr.write(`Android recording stop failed: ${error.message}\n`);
    }
    world.androidTemporaryStopText = null;
  }
  if (world.androidSnapshots) {
    for (const directory of world.androidSnapshots.keys()) {
      try { cleanupAndroidEntries(world, directory); } catch (error) { process.stderr.write(`Android cleanup failed: ${error.message}\n`); }
    }
  }
  if (world.androidFieldMemories?.size || world.androidToggleMemories?.size) {
    try {
      await launchAndroid();
      for (const label of [...world.androidFieldMemories.keys()]) await restoreAndroidField(world, label);
      for (const label of [...world.androidToggleMemories.keys()]) await restoreAndroidToggle(world, label);
    } catch (error) {
      process.stderr.write(`Android preference restoration failed: ${error.message}\n`);
    }
  }
  await finishRecording(world);
  if (world.driver) {
    await world.driver.quit();
    world.driver = null;
  }
}

module.exports = {
  adb,
  androidInstalled,
  androidFieldValue,
  androidFieldValueByIndex,
  androidState,
  androidTextBoundsDiffer,
  androidTextVisible,
  androidToggleState,
  beginRecording,
  captureScenario,
  cleanupAndroidEntries,
  clickBoardPoint,
  clickCss,
  closeWorld,
  config,
  configuredAndroidAppIsForeground,
  cssElement,
  ensureBrowser,
  findAndroidText,
  finishRecording,
  launchAndroid,
  listAndroidEntries,
  narrate,
  openWeb,
  openNewWindow,
  nameCurrentWindow,
  rememberAndroidField,
  rememberAndroidTextBounds,
  rememberAndroidToggle,
  replaceAndroidField,
  replaceAndroidFieldByIndex,
  replaceCss,
  restoreAndroidField,
  restoreAndroidToggle,
  selectAndroidOption,
  setAndroidToggle,
  scrollAndroidToTop,
  sleep,
  stopConfiguredAndroidService,
  tapAndroidText,
  tapAndroidTextRepeated,
  tapAndroidTextIfEnabled,
  tapInSamePanel,
  timeoutMs,
  waitAndroidText,
  waitCssCount,
  waitCssExactCount,
  waitCssText,
  waitCssValue,
  waitForDownloadedFile,
  waitJavaScript,
  waitForNewAndroidEntry,
  waitForNewAndroidEntries,
  startTemporaryAndroidRecording,
  stopTemporaryAndroidRecording,
  switchToNewestWindow,
  switchToNamedWindow,
  uploadAcceptanceFixtures,
  canvasChecksum,
};
