const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const repo = "Linxiushen/agent-infra-validation-20261105";
assert.equal(process.env.GITHUB_REPOSITORY, repo);
assert.match(process.env.GITHUB_RUN_ID, /^\d+$/);
const api = (path) =>
  execFileSync("gh", ["api", path], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
const jobs = JSON.parse(
  api(
    "/repos/" +
      repo +
      "/actions/runs/" +
      process.env.GITHUB_RUN_ID +
      "/jobs?filter=latest&per_page=100",
  ),
).jobs;
for (const signing of ["false", "true"]) {
  const matches = jobs.filter(
    (job) => job.name === "Cleanup signing " + signing,
  );
  assert.equal(matches.length, 1);
  const job = matches[0];
  assert.equal(job.status, "completed");
  assert.equal(job.conclusion, "success");
  const log = api("/repos/" + repo + "/actions/jobs/" + job.id + "/logs");
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
  assert.ok(log.includes('"passed":true'));
  console.log(
    JSON.stringify({
      jobId: job.id,
      jobUrl: job.html_url,
      signing,
      expectedProviderValidationFailureVerified: true,
      modelInvoked: false,
      verifiedAt: new Date().toISOString(),
    }),
  );
}
