const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const repo = "Linxiushen/agent-infra-validation-20261105";
const targetRunId = "41980810012";
const expectedWorkflowHead = "c280f62085bf51d1149ad031a2566bc6725887f3";
const candidateSha = "6a26c53237c779ba353749f922e81f71e39ee951";
assert.equal(process.env.GITHUB_REPOSITORY, repo);
const api = (endpoint, rawLog = false) =>
  execFileSync(
    "gh",
    ["api", endpoint, ...(rawLog ? ["--allow-escape-sequences"] : [])],
    {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
const run = JSON.parse(api("/repos/" + repo + "/actions/runs/" + targetRunId));
assert.equal(run.head_sha, expectedWorkflowHead);
assert.equal(run.event, "workflow_dispatch");
assert.equal(run.status, "completed");
assert.equal(run.conclusion, "failure"); // Original readback-job failure remains recorded.
const jobs = JSON.parse(
  api(
    "/repos/" +
      repo +
      "/actions/runs/" +
      targetRunId +
      "/jobs?filter=latest&per_page=100",
  ),
).jobs;
const verified = [];
for (const signing of ["false", "true"]) {
  const matches = jobs.filter(
    (job) => job.name === "Cleanup signing " + signing,
  );
  assert.equal(matches.length, 1);
  const job = matches[0];
  assert.equal(job.status, "completed");
  assert.equal(job.conclusion, "success");
  // The runner CLI requires explicit opt-in for ANSI-containing logs. They
  // stay in a captured pipe; only the sanitized verification JSON is printed.
  const log = api("/repos/" + repo + "/actions/jobs/" + job.id + "/logs", true);
  assert.ok(log.includes("Using custom Claude Code executable: /bin/false"));
  assert.ok(
    log.includes(
      "Action failed with error: Environment variable validation failed:",
    ),
  );
  assert.ok(
    log.includes(
      "Either ANTHROPIC_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, or workload identity federation (ANTHROPIC_FEDERATION_RULE_ID and ANTHROPIC_ORGANIZATION_ID) is required when using direct Anthropic API.",
    ),
  );
  assert.ok(!log.includes("Installing Claude Code v"));
  assert.ok(log.includes('"candidateSha":"' + candidateSha + '"'));
  assert.ok(log.includes('"authenticatedOriginVerified":true'));
  assert.ok(log.includes('"passed":true'));
  assert.ok(log.includes("(stale info)"));
  verified.push({
    jobId: job.id,
    jobUrl: job.html_url,
    signing,
    expectedProviderValidationFailureVerified: true,
    modelInvoked: false,
  });
}
console.log(
  JSON.stringify({
    targetRunId,
    expectedWorkflowHead,
    candidateSha,
    originalRunConclusion: run.conclusion,
    verifiedAt: new Date().toISOString(),
    verified,
    readOnly: true,
    passed: true,
  }),
);
