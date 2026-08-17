#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { XMLBuilder } from "fast-xml-parser";

function option(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name}`);
  return process.argv[index + 1];
}

const input = option("--input");
const output = option("--output");
const suite = option("--suite");
const startedAt = option("--started-at");
const project = JSON.parse(readFileSync(path.resolve("acceptance/project.json"), "utf8"));
const cucumber = JSON.parse(readFileSync(input, "utf8"));

function localCommit() {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function scenarioStatus(steps) {
  return steps.length > 0 && steps.every((step) => step.passed);
}

const checks = [];
for (const feature of cucumber) {
  for (const scenario of feature.elements || []) {
    if (scenario.type !== "scenario") continue;
    const steps = (scenario.steps || []).map((step) => ({
      keyword: String(step.keyword || "").trim(),
      name: step.name,
      passed: step.result?.status === "passed",
      status: step.result?.status || "unknown",
      durationMs: Math.round(Number(step.result?.duration || 0) / 1_000_000),
      error: step.result?.error_message || "",
    }));
    checks.push({
      id: scenario.id,
      feature: feature.name,
      name: scenario.name,
      passed: scenarioStatus(steps),
      durationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
      steps,
    });
  }
}

if (!checks.length) {
  checks.push({
    id: `${suite};runner`,
    feature: suite,
    name: "Cucumber produced at least one scenario",
    passed: false,
    durationMs: 0,
    steps: [{ keyword: "Then", name: "at least one scenario is reported", passed: false, status: "missing", durationMs: 0, error: "No scenarios were reported." }],
  });
}

const checklist = {
  schemaVersion: 1,
  repository: project.repository,
  platform: project.platform,
  suite,
  commit: localCommit(),
  startedAt,
  finishedAt: new Date().toISOString(),
  passed: checks.every((check) => check.passed),
  checks,
};
writeFileSync(path.join(output, "checklist.json"), `${JSON.stringify(checklist, null, 2)}\n`);

const testCases = checks.map((check) => {
  const failures = check.steps.filter((step) => !step.passed);
  const testCase = {
    "@_name": check.name,
    "@_duration": check.durationMs,
  };
  if (failures.length) {
    const detail = failures.map((step) => `${step.keyword} ${step.name}: ${step.error || step.status}`).join("\n");
    testCase.failure = { "@_message": "UAT checklist failed", "#text": detail };
  }
  return testCase;
});
const xmlDocument = {
  testExecutions: {
    "@_version": "1",
    file: [{
      "@_path": `acceptance/features/${suite}.feature`,
      testCase: testCases,
    }],
  },
};
const xml = new XMLBuilder({ ignoreAttributes: false, format: true, suppressEmptyNode: true }).build(xmlDocument);
writeFileSync(path.join(output, "sonar-test-execution.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n${xml}\n`);

const passedCount = checks.filter((check) => check.passed).length;
const summary = [
  `# ${project.repository} ${suite} report`,
  "",
  `- Passed: **${checklist.passed}**`,
  `- Scenarios: **${passedCount}/${checks.length} passed**`,
  `- Commit: \`${checklist.commit}\``,
  `- Started: ${checklist.startedAt}`,
  `- Finished: ${checklist.finishedAt}`,
  "",
  "| Scenario | Passed | Duration |",
  "| --- | --- | ---: |",
  ...checks.map((check) => `| ${check.name.replaceAll("|", "\\|")} | ${check.passed} | ${check.durationMs} ms |`),
  "",
].join("\n");
writeFileSync(path.join(output, "summary.md"), summary);
process.stdout.write(`${project.repository} ${suite}: ${passedCount}/${checks.length} scenarios passed\n`);
