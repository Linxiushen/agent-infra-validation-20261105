# Deterministic Claude Action cleanup integration

This disposable validation repository tests candidate commit 6a26c53237c779ba353749f922e81f71e39ee951 from Linxiushen/claude-code-action in real GitHub Actions. It contains synthetic test data only and uses no model credentials or paid model calls.

The actual composite action prepares Git credentials in both commit-signing modes. Missing provider credentials deliberately stop it at environment validation before Claude executes; /bin/false is also configured as the executable. A separate verification job reads completed job logs and asserts the exact expected failure. The harness invokes the unchanged candidate cleanup module against uniquely named real refs in this validation repository, verifies ordinary deletion and concurrent-commit preservation, and saves before/after API observations. Concurrent refs remain available for independent readback.

This proves deterministic Action preparation/authentication and real API/Git cleanup behavior, not successful Claude/model end-to-end execution. ubuntu-latest is used only in this separate repository for a no-model harness; no upstream/candidate workflow or firewall policy is changed.
