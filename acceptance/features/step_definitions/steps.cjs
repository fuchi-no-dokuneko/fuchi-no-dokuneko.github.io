const assert = require("node:assert/strict");
const { Given, Then, When } = require("@cucumber/cucumber");
const { By, Select } = require("selenium-webdriver");
const runtime = require("../../runtime.cjs");

Given("I begin a recorded demo", async function () {
  await runtime.beginRecording(this);
});

Then("I finish the recorded demo", async function () {
  await runtime.finishRecording(this);
});

When("I narrate in {string} for at least {int} seconds:", async function (language, seconds, text) {
  await runtime.narrate(language, seconds, text);
});

When("I wait for {int} seconds", async function (seconds) {
  await runtime.sleep(seconds * 1000);
});

Given("I open the web application at path {string}", async function (pathname) {
  await runtime.openWeb(this, pathname);
});

Then("the web page title contains {string}", async function (expected) {
  const driver = await runtime.ensureBrowser(this);
  assert.ok((await driver.getTitle()).includes(expected), `Expected page title to include ${expected}`);
});

Then("CSS {string} is visible", async function (selector) {
  await runtime.cssElement(this, selector);
});

Then("CSS {string} contains text {string}", async function (selector, expected) {
  const text = await (await runtime.cssElement(this, selector)).getText();
  assert.ok(text.includes(expected), `Expected ${selector} to contain ${expected}; got ${text}`);
});

Then("CSS {string} has text {string}", async function (selector, expected) {
  assert.equal(await (await runtime.cssElement(this, selector)).getText(), expected);
});

Then("CSS {string} eventually contains text {string}", async function (selector, expected) {
  await runtime.waitCssText(this, selector, expected, true);
});

Then("CSS {string} eventually excludes text {string}", async function (selector, expected) {
  await runtime.waitCssText(this, selector, expected, false);
});

Then("at least {int} elements match CSS {string}", async function (minimum, selector) {
  await runtime.waitCssCount(this, selector, minimum);
});

Then("exactly {int} elements match CSS {string}", async function (expected, selector) {
  await runtime.waitCssExactCount(this, selector, expected);
});

Then("no elements match CSS {string}", async function (selector) {
  await runtime.waitCssExactCount(this, selector, 0);
});

Then("CSS {string} has value {string}", async function (selector, expected) {
  const value = await (await runtime.cssElement(this, selector)).getAttribute("value");
  assert.equal(value, expected);
});

Then("CSS {string} has value:", async function (selector, expected) {
  const value = await (await runtime.cssElement(this, selector)).getAttribute("value");
  assert.equal(value, expected);
});

Then("CSS {string} is enabled", async function (selector) {
  assert.equal(await (await runtime.cssElement(this, selector)).isEnabled(), true);
});

Then("CSS {string} is disabled", async function (selector) {
  assert.equal(await (await runtime.cssElement(this, selector, false)).isEnabled(), false);
});

Then("CSS {string} has no {string} attribute", async function (selector, attribute) {
  assert.equal(await (await runtime.cssElement(this, selector)).getAttribute(attribute), null);
});

Then("CSS {string} has attribute {string} equal to {string}", async function (selector, attribute, expected) {
  assert.equal(await (await runtime.cssElement(this, selector, false)).getAttribute(attribute), expected);
});

Then("CSS {string} eventually has a non-empty value", async function (selector) {
  await runtime.waitCssValue(this, selector, (value) => Boolean(value), "a non-empty value");
});

Then("the numeric text in CSS {string} is greater than {int}", async function (selector, minimum) {
  const text = await (await runtime.cssElement(this, selector)).getText();
  const value = Number(text.replaceAll(",", "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  assert.ok(Number.isFinite(value) && value > minimum, `Expected ${selector} numeric text to exceed ${minimum}; got ${text}`);
});

When("I click CSS {string}", async function (selector) {
  await runtime.clickCss(this, selector);
});

When("I replace CSS {string} with {string}", async function (selector, value) {
  await runtime.replaceCss(this, selector, value);
});

When("I replace CSS {string} with:", async function (selector, value) {
  await runtime.replaceCss(this, selector, value);
});

When("I replace CSS {string} with environment variable {string}", async function (selector, name) {
  const value = process.env[name];
  assert.ok(value, `Required environment variable is missing: ${name}`);
  await runtime.replaceCss(this, selector, value);
});

When("I upload acceptance fixture {string} to CSS {string}", async function (fixtureNames, selector) {
  await runtime.uploadAcceptanceFixtures(this, selector, fixtureNames.split(",").map((name) => name.trim()));
});

When("I remember the value of CSS {string} as {string}", async function (selector, name) {
  this.browserMemory.set(name, await (await runtime.cssElement(this, selector, false)).getAttribute("value"));
});

When("I replace CSS {string} with remembered value {string}", async function (selector, name) {
  assert.ok(this.browserMemory.has(name), `No remembered browser value named ${name}`);
  await runtime.replaceCss(this, selector, this.browserMemory.get(name));
});

When("I choose value {string} in CSS {string}", async function (value, selector) {
  const element = await runtime.cssElement(this, selector);
  await new Select(element).selectByValue(value);
});

When("I set CSS checkbox {string} to checked", async function (selector) {
  const element = await runtime.cssElement(this, selector);
  if (!(await element.isSelected())) await element.click();
});

When("I set CSS checkbox {string} to unchecked", async function (selector) {
  const element = await runtime.cssElement(this, selector);
  if (await element.isSelected()) await element.click();
});

Then("CSS checkbox {string} is checked", async function (selector) {
  assert.equal(await (await runtime.cssElement(this, selector)).isSelected(), true);
});

Then("CSS checkbox {string} is unchecked", async function (selector) {
  assert.equal(await (await runtime.cssElement(this, selector)).isSelected(), false);
});

When("I remember the pixel checksum of CSS canvas {string}", async function (selector) {
  this.canvasChecksums ||= new Map();
  this.canvasChecksums.set(selector, await runtime.canvasChecksum(this, selector));
});

Then("the pixel checksum of CSS canvas {string} is different", async function (selector) {
  assert.ok(this.canvasChecksums?.has(selector), `No remembered canvas checksum for ${selector}`);
  assert.notEqual(await runtime.canvasChecksum(this, selector), this.canvasChecksums.get(selector));
});

Then("JavaScript expression {string} returns true", async function (expression) {
  const driver = await runtime.ensureBrowser(this);
  assert.equal(await driver.executeScript(`return Boolean(${expression});`), true);
});

Then("JavaScript expression {string} eventually returns true", async function (expression) {
  await runtime.waitJavaScript(this, expression);
});

When("I execute JavaScript:", async function (source) {
  const driver = await runtime.ensureBrowser(this);
  await driver.executeScript(source);
});

When("I remember JavaScript expression {string} as {string}", async function (expression, name) {
  const driver = await runtime.ensureBrowser(this);
  this.browserMemory.set(name, await driver.executeScript(`return (${expression});`));
});

Then("JavaScript expression {string} equals remembered value {string}", async function (expression, name) {
  assert.ok(this.browserMemory.has(name), `No remembered browser value named ${name}`);
  const driver = await runtime.ensureBrowser(this);
  assert.deepEqual(await driver.executeScript(`return (${expression});`), this.browserMemory.get(name));
});

Then("JavaScript expression {string} does not equal remembered value {string}", async function (expression, name) {
  assert.ok(this.browserMemory.has(name), `No remembered browser value named ${name}`);
  const driver = await runtime.ensureBrowser(this);
  assert.notDeepEqual(await driver.executeScript(`return (${expression});`), this.browserMemory.get(name));
});

When("I click CSS canvas {string} at column {int} row {int} of a {int} by {int} board", async function (selector, column, row, width, height) {
  assert.equal(width, height, "Only square boards are supported.");
  await runtime.clickBoardPoint(this, selector, column, row, width);
});

When("I reload the web page", async function () {
  const driver = await runtime.ensureBrowser(this);
  await driver.navigate().refresh();
});

When("I switch to the newest browser window", async function () {
  await runtime.switchToNewestWindow(this);
});

When("I name the current browser window {string}", async function (name) {
  await runtime.nameCurrentWindow(this, name);
});

When("I open path {string} in a new browser window named {string}", async function (pathname, name) {
  await runtime.openNewWindow(this, pathname, name);
});

When("I switch to browser window {string}", async function (name) {
  await runtime.switchToNamedWindow(this, name);
});

Then("the web path ends with {string}", async function (suffix) {
  const driver = await runtime.ensureBrowser(this);
  assert.ok(new URL(await driver.getCurrentUrl()).pathname.endsWith(suffix));
});

Then("a downloaded file matching {string} appears", async function (pattern) {
  await runtime.waitForDownloadedFile(this, pattern);
});

Given("an Android device is connected through ADB", function () {
  runtime.androidState();
});

Given("the configured Android app is installed", function () {
  runtime.androidInstalled();
});

When("I launch the configured Android app", async function () {
  await runtime.launchAndroid();
});

When("I press Android back", async function () {
  runtime.adb(["shell", "input", "keyevent", "4"]);
  await runtime.sleep(350);
});

Then("the configured Android app is foreground", function () {
  assert.equal(runtime.configuredAndroidAppIsForeground(), true, `${runtime.config.appPackage} is not foreground`);
});

When("I stop any active configured Android service", async function () {
  await runtime.stopConfiguredAndroidService();
});

Then("Android text {string} is visible", async function (text) {
  await runtime.waitAndroidText(text);
});

Then("Android text containing {string} is visible", async function (text) {
  await runtime.waitAndroidText(text, { contains: true });
});

Then("Android text {string} is not visible", function (text) {
  assert.equal(runtime.androidTextVisible(text), false, `Android text is still visible: ${text}`);
});

Then("Android text containing {string} is not visible", function (text) {
  assert.equal(runtime.androidTextVisible(text, true), false, `Android text is still visible: ${text}`);
});

When("I tap Android text {string}", async function (text) {
  await runtime.tapAndroidText(text);
});

When("I tap Android text containing {string}", async function (text) {
  await runtime.tapAndroidText(text, { contains: true });
});

When("I tap Android text {string} {int} times", async function (text, count) {
  await runtime.tapAndroidTextRepeated(text, count);
});

When("I tap Android text {string} if it is enabled", async function (text) {
  await runtime.tapAndroidTextIfEnabled(text);
});

When("I start a temporary Android recording by tapping {string}", async function (text) {
  await runtime.startTemporaryAndroidRecording(this, text);
});

When("I stop the temporary Android recording by tapping {string}", async function (text) {
  await runtime.stopTemporaryAndroidRecording(this, text);
});

When("I tap Android text {string} in the same panel as {string}", async function (button, anchor) {
  await runtime.tapInSamePanel(button, anchor);
});

When("I tap Android text {string} in the same panel as environment variable {string}", async function (button, name) {
  const value = process.env[name];
  assert.ok(value, `Required environment variable is missing: ${name}`);
  await runtime.tapInSamePanel(button, value);
});

When("I tap Android text containing {string} in the same panel as {string}", async function (button, anchor) {
  await runtime.tapInSamePanel(button, anchor, true);
});

When("I tap Android text containing {string} in the same panel as environment variable {string}", async function (button, name) {
  const value = process.env[name];
  assert.ok(value, `Required environment variable is missing: ${name}`);
  await runtime.tapInSamePanel(button, value, true);
});

Then("Android text from environment variable {string} is visible", async function (name) {
  const value = process.env[name];
  assert.ok(value, `Required environment variable is missing: ${name}`);
  await runtime.waitAndroidText(value);
});

Then("Android text from environment variable {string} is not visible", function (name) {
  const value = process.env[name];
  assert.ok(value, `Required environment variable is missing: ${name}`);
  assert.equal(runtime.androidTextVisible(value), false, `Android text is still visible: ${value}`);
});

When("I replace the Android field labelled {string} with {string}", async function (label, value) {
  await runtime.replaceAndroidField(label, value);
});

When("I replace the Android field labelled {string} with environment variable {string}", async function (label, name) {
  const value = process.env[name];
  assert.ok(value, `Required environment variable is missing: ${name}`);
  await runtime.replaceAndroidField(label, value);
});

When("I replace Android editable field {int} with {string}", async function (index, value) {
  await runtime.replaceAndroidFieldByIndex(index, value);
});

When("I replace Android editable field {int} with environment variable {string}", async function (index, name) {
  const value = process.env[name];
  assert.ok(value, `Required environment variable is missing: ${name}`);
  await runtime.replaceAndroidFieldByIndex(index, value);
});

Then("Android editable field {int} has value {string}", async function (index, expected) {
  assert.equal(await runtime.androidFieldValueByIndex(index), expected);
});

Then("the Android field labelled {string} has value {string}", async function (label, expected) {
  assert.equal(await runtime.androidFieldValue(label), expected);
});

Then("the Android field labelled {string} has value from environment variable {string}", async function (label, name) {
  const value = process.env[name];
  assert.ok(value, `Required environment variable is missing: ${name}`);
  assert.equal(await runtime.androidFieldValue(label), value);
});

Given("I remember Android field {string} for restoration with button {string}", async function (label, button) {
  await runtime.rememberAndroidField(this, label, button);
});

When("I restore Android field {string}", async function (label) {
  await runtime.restoreAndroidField(this, label);
});

Given("I remember Android checkbox {string} for restoration", async function (label) {
  await runtime.rememberAndroidToggle(this, label);
});

When("I set Android checkbox {string} to checked", async function (label) {
  await runtime.setAndroidToggle(label, true);
});

When("I set Android checkbox {string} to unchecked", async function (label) {
  await runtime.setAndroidToggle(label, false);
});

Then("Android checkbox {string} is checked", async function (label) {
  assert.equal(await runtime.androidToggleState(label), true);
});

Then("Android checkbox {string} is unchecked", async function (label) {
  assert.equal(await runtime.androidToggleState(label), false);
});

When("I restore Android checkbox {string}", async function (label) {
  await runtime.restoreAndroidToggle(this, label);
});

When("I hide the Android keyboard", function () {
  runtime.adb(["shell", "input", "keyevent", "4"]);
});

When("I scroll the Android screen to the top", async function () {
  await runtime.scrollAndroidToTop();
});

When("I select Android option {string} from spinner {int}", async function (option, index) {
  await runtime.selectAndroidOption(option, index);
});

When("I dismiss the StudyShield setup reminder if present", async function () {
  if (!runtime.androidTextVisible("Setup required")) return;
  await runtime.tapAndroidText("Close", { scroll: false });
  await runtime.waitAndroidText("Close setup reminder?");
  await runtime.tapAndroidText("Close anyway", { scroll: false });
});

When("I grant Android permission {string}", function (permission) {
  runtime.adb(["shell", "pm", "grant", runtime.config.appPackage, permission], { allowFailure: true });
});

Given("I remember existing Android entries under {string}", function (directory) {
  this.androidSnapshots.set(directory, runtime.listAndroidEntries(directory));
});

Then("a new Android entry appears under {string}", async function (directory) {
  await runtime.waitForNewAndroidEntry(this, directory);
});

Then("at least {int} new Android entries appear under {string}", async function (minimum, directory) {
  await runtime.waitForNewAndroidEntries(this, directory, minimum);
});

Then("I delete only Android entries created during this scenario under {string}", function (directory) {
  runtime.cleanupAndroidEntries(this, directory);
  this.androidSnapshots.delete(directory);
});

When("I remember bounds of Android text {string} as {string}", async function (text, name) {
  await runtime.rememberAndroidTextBounds(this, text, name);
});

Then("bounds of Android text {string} differ from {string}", async function (text, name) {
  assert.equal(await runtime.androidTextBoundsDiffer(this, text, name), true);
});
