#!/usr/bin/env node

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const acceptanceDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(acceptanceDirectory, "..");
const suites = {
  uat: "uat.feature",
  "demo-en": "demo-en.feature",
  "demo-yue": "demo-yue.feature",
};

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write("Usage: node acceptance/run.mjs <uat|demo-en|demo-yue> [--dry-run] [--headless] [--sonar] [--base-url URL] [--tags EXPRESSION]\n");
  process.exit(2);
}

const argumentsList = process.argv.slice(2);
const suite = argumentsList.shift();
if (!suites[suite]) usage("Choose one of the three configured pipelines.");

let dryRun = false;
let headless = false;
let submitSonar = false;
let baseUrl = "";
let tags = "";
while (argumentsList.length) {
  const option = argumentsList.shift();
  if (option === "--dry-run") dryRun = true;
  else if (option === "--headless") headless = true;
  else if (option === "--sonar") submitSonar = true;
  else if (option === "--base-url") baseUrl = argumentsList.shift() || usage("--base-url requires a URL.");
  else if (option === "--tags") tags = argumentsList.shift() || usage("--tags requires a Cucumber tag expression.");
  else usage(`Unknown option: ${option}`);
}
if (submitSonar && suite !== "uat") usage("Only the UAT pipeline can submit test execution data to SonarQube.");
if (submitSonar && dryRun) usage("A dry run cannot be submitted to SonarQube.");

const cucumberBinary = path.join(acceptanceDirectory, "node_modules", "@cucumber", "cucumber", "bin", "cucumber.js");
if (!existsSync(cucumberBinary)) {
  process.stderr.write("Acceptance dependencies are missing. Run: sh acceptance/bootstrap.sh\n");
  process.exit(2);
}

const reportDirectory = path.join(root, "build", "reports", "acceptance", suite);
const rawReport = path.join(reportDirectory, "cucumber.json");
if (!dryRun) {
  rmSync(reportDirectory, { recursive: true, force: true });
  mkdirSync(reportDirectory, { recursive: true });
}
const startedAt = new Date().toISOString();
const runId = process.env.ACCEPTANCE_RUN_ID || startedAt.replaceAll(/[-:.TZ]/g, "").slice(0, 14);
const childEnvironment = {
  ...process.env,
  ACCEPTANCE_SUITE: suite,
  ACCEPTANCE_REPORT_DIR: reportDirectory,
  ACCEPTANCE_RUN_ID: runId,
  ACCEPTANCE_KEEP_NOTE: process.env.ACCEPTANCE_KEEP_NOTE || `UAT keep ${runId}`,
  ACCEPTANCE_REMOVE_NOTE: process.env.ACCEPTANCE_REMOVE_NOTE || `UAT remove ${runId}`,
  ACCEPTANCE_EDIT_NOTE: process.env.ACCEPTANCE_EDIT_NOTE || `UAT edited ${runId}`,
  ACCEPTANCE_DEMO_NOTE: process.env.ACCEPTANCE_DEMO_NOTE || `Demo occurrence ${runId}`,
  ACCEPTANCE_TODO_TITLE: process.env.ACCEPTANCE_TODO_TITLE || `UAT todo ${runId}`,
  ACCEPTANCE_TODO_EDITED_TITLE: process.env.ACCEPTANCE_TODO_EDITED_TITLE || `UAT edited ${runId}`,
  ACCEPTANCE_DIARY_NOTE: process.env.ACCEPTANCE_DIARY_NOTE || `UAT diary ${runId}`,
  ACCEPTANCE_SLEEP_NOTE: process.env.ACCEPTANCE_SLEEP_NOTE || `UAT sleep ${runId}`,
  ...(headless ? { ACCEPTANCE_HEADLESS: "1" } : {}),
  ...(baseUrl ? { UAT_BASE_URL: baseUrl } : {}),
};

const cucumberArguments = [
  cucumberBinary,
  path.join("acceptance", "features", suites[suite]),
  "--require",
  path.join("acceptance", "features", "support", "*.cjs"),
  "--require",
  path.join("acceptance", "features", "step_definitions", "*.cjs"),
  "--format",
  "progress",
];
if (dryRun) cucumberArguments.push("--dry-run");
else cucumberArguments.push("--format", `json:${rawReport}`);
if (tags) cucumberArguments.push("--tags", tags);

const cucumber = spawnSync(process.execPath, cucumberArguments, {
  cwd: root,
  env: childEnvironment,
  stdio: "inherit",
});
const cucumberStatus = cucumber.status ?? 1;
if (dryRun) process.exit(cucumberStatus);

if (!existsSync(rawReport)) {
  writeFileSync(rawReport, "[]\n");
}
const report = spawnSync(process.execPath, [
  path.join(acceptanceDirectory, "report.mjs"),
  "--input", rawReport,
  "--output", reportDirectory,
  "--suite", suite,
  "--started-at", startedAt,
], {
  cwd: root,
  env: childEnvironment,
  stdio: "inherit",
});
const reportStatus = report.status ?? 1;

let sonarStatus = 0;
if (submitSonar) {
  if (!process.env.SONAR_TOKEN) {
    process.stderr.write("SONAR_TOKEN is required for --sonar. The token remains on this laptop and is passed only to sonar-scanner.\n");
    sonarStatus = 2;
  } else {
    const scanner = process.env.SONAR_SCANNER_BIN || "sonar-scanner";
    const reportPath = path.relative(root, path.join(reportDirectory, "sonar-test-execution.xml"));
    const scan = spawnSync(scanner, [`-Dsonar.testExecutionReportPaths=${reportPath}`], {
      cwd: root,
      env: {
        ...process.env,
        SONAR_SCANNER_OPTS: `${process.env.SONAR_SCANNER_OPTS || ""} -Djava.net.preferIPv4Stack=true -Djava.net.preferIPv6Addresses=false`.trim(),
      },
      stdio: "inherit",
    });
    if (scan.error) {
      process.stderr.write(`Could not start ${scanner}: ${scan.error.message}\n`);
      sonarStatus = 2;
    } else {
      sonarStatus = scan.status ?? 1;
    }
  }
}

process.exit(cucumberStatus || reportStatus || sonarStatus);
