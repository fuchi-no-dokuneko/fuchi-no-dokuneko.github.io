const { After, Before, setDefaultTimeout } = require("@cucumber/cucumber");
const runtime = require("../../runtime.cjs");

setDefaultTimeout(runtime.timeoutMs());

Before(function () {
  this.driver = null;
  this.demoRecording = false;
  this.androidSnapshots = new Map();
  this.androidFieldMemories = new Map();
  this.androidToggleMemories = new Map();
  this.androidBounds = new Map();
  this.canvasChecksums = new Map();
  this.browserMemory = new Map();
  this.browserWindows = new Map();
  this.androidTemporaryStopText = null;
});

After(async function ({ pickle }) {
  await runtime.captureScenario(this, pickle.name);
  await runtime.closeWorld(this);
});
