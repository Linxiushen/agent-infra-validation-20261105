import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const expectedRepository = "Linxiushen/agent-infra-validation-20261105";
const candidateSha = "6a26c53237c779ba353749f922e81f71e39ee951";
const cleanupHash =
  "e32d03ccbee31164e77c443224864e1ffeac2520c32e441711ddf5f5c173883a";
const token = process.env.GH_TOKEN!;
const signing = process.env.SIGNING!;
const runId = process.env.GITHUB_RUN_ID!;
const attempt = process.env.GITHUB_RUN_ATTEMPT!;
const workspace = process.env.GITHUB_WORKSPACE!;
const evidenceFile = join(
  process.env.RUNNER_TEMP!,
  "cleanup-evidence-" + signing + ".json",
);
const evidence: Record<string, any> = {
  startedAt: new Date().toISOString(),
  expectedRepository,
  candidateSha,
  signing,
  cases: [],
};
const persist = () =>
  writeFileSync(evidenceFile, JSON.stringify(evidence, null, 2) + "\n");
const git = (...args: string[]) =>
  execFileSync("git", args, {
    cwd: workspace,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

try {
  assert.equal(process.env.GITHUB_REPOSITORY, expectedRepository);
  assert.equal(process.env.ACTION_OUTCOME, "failure");
  assert.ok(token);
  assert.match(runId, /^\d+$/);
  assert.match(attempt, /^\d+$/);
  assert.ok(signing === "false" || signing === "true");
  assert.equal(
    git("-C", ".candidate-source", "rev-parse", "HEAD"),
    candidateSha,
  );
  const source = join(
    workspace,
    ".candidate-source/src/github/operations/branch-cleanup.ts",
  );
  assert.equal(
    createHash("sha256").update(readFileSync(source)).digest("hex"),
    cleanupHash,
  );
  assert.equal(
    readFileSync(
      join(process.env.RUNNER_TEMP!, "claude-prompts/claude-prompt.txt"),
      "utf8",
    ),
    "Synthetic cleanup authentication smoke; no model should execute.",
  );
  assert.equal(git("status", "--porcelain"), "");

  // Checkouts persist no credential. The actual candidate Action must install it.
  const origin = new URL(git("remote", "get-url", "origin"));
  assert.equal(origin.protocol, "https:");
  assert.equal(origin.hostname, "github.com");
  assert.equal(origin.pathname, "/" + expectedRepository + ".git");
  assert.equal(origin.username, "x-access-token");
  assert.ok(
    decodeURIComponent(origin.password) === token,
    "Action did not install expected credential",
  );
  evidence.authenticatedOriginVerified = true;
  evidence.sourceSha256 = cleanupHash;
  persist();

  const { createOctokit } = await import(
    pathToFileURL(join(workspace, ".candidate-source/src/github/api/client.ts"))
      .href
  );
  const { checkAndCommitOrDeleteBranch } = await import(
    pathToFileURL(source).href
  );
  const octokit = createOctokit(token);
  const [owner, repo] = expectedRepository.split("/");
  const baseSha = git("rev-parse", "HEAD");
  const { data: baseCommit } = await octokit.rest.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });
  const realCompare = octokit.rest.repos.compareCommitsWithBasehead;

  for (const scenario of ["unchanged", "concurrent"] as const) {
    const branch =
      "validation/cleanup/" + [runId, attempt, signing, scenario].join("-");
    const ref = "refs/heads/" + branch;
    const record: Record<string, any> = {
      scenario,
      branch,
      ref,
      createdAt: new Date().toISOString(),
      baseSha,
      sourceSha: candidateSha,
    };
    evidence.cases.push(record);
    persist();
    // Never reuse a ref: verify absence and let atomic createRef reject collisions.
    try {
      await octokit.rest.git.getRef({ owner, repo, ref: "heads/" + branch });
      throw new Error("Test ref already exists");
    } catch (error: any) {
      if (error.status !== 404) throw error;
    }
    await octokit.rest.git.createRef({ owner, repo, ref, sha: baseSha });
    const before = await octokit.rest.repos.getBranch({ owner, repo, branch });
    record.before = {
      status: before.status,
      sha: before.data.commit.sha,
      readAt: new Date().toISOString(),
    };
    assert.equal(record.before.sha, baseSha);
    persist();

    octokit.rest.repos.compareCommitsWithBasehead = async (parameters: any) => {
      assert.equal(parameters.basehead, baseSha + "..." + baseSha);
      const comparison = await realCompare(parameters);
      assert.equal(comparison.data.total_commits, 0);
      record.comparison = {
        basehead: parameters.basehead,
        totalCommits: comparison.data.total_commits,
        at: new Date().toISOString(),
      };
      if (scenario === "concurrent") {
        const { data: collaboratorCommit } =
          await octokit.rest.git.createCommit({
            owner,
            repo,
            message:
              "Synthetic collaborator commit for " +
              [runId, attempt, signing].join("/"),
            tree: baseCommit.tree.sha,
            parents: [baseSha],
          });
        await octokit.rest.git.updateRef({
          owner,
          repo,
          ref: "heads/" + branch,
          sha: collaboratorCommit.sha,
          force: false,
        });
        record.concurrentSha = collaboratorCommit.sha;
        record.concurrentPushAt = new Date().toISOString();
      }
      persist();
      return comparison;
    };

    const result = await checkAndCommitOrDeleteBranch(
      octokit,
      owner,
      repo,
      branch,
      baseSha,
      signing === "true",
    );
    record.result = result;
    try {
      const after = await octokit.rest.repos.getBranch({ owner, repo, branch });
      record.after = {
        status: after.status,
        sha: after.data.commit.sha,
        readAt: new Date().toISOString(),
      };
    } catch (error: any) {
      if (error.status !== 404) throw error;
      record.after = {
        status: 404,
        sha: null,
        readAt: new Date().toISOString(),
      };
    }
    persist();
    if (scenario === "unchanged") {
      assert.equal(record.after.status, 404);
      assert.equal(result.shouldDeleteBranch, true);
      assert.equal(result.branchLink, "");
    } else {
      assert.equal(record.after.sha, record.concurrentSha);
      assert.equal(result.shouldDeleteBranch, false);
      assert.ok(result.branchLink.includes(branch));
      record.retainedForIndependentReadback = true;
    }
    record.passed = true;
    persist();
  }
  evidence.passed = true;
  evidence.completedAt = new Date().toISOString();
  persist();
  console.log(JSON.stringify(evidence));
} catch (error: any) {
  evidence.passed = false;
  // Never serialize request headers, credentials, remote URL, or raw errors.
  evidence.failure = {
    name: error?.name || "Error",
    status: error?.status ?? null,
    at: new Date().toISOString(),
  };
  persist();
  console.error(
    "Deterministic cleanup verification failed; inspect sanitized evidence artifact.",
  );
  process.exitCode = 1;
}
