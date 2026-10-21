# Security policy

mdrules runs a local server bound to `127.0.0.1` that reads and writes files inside the project it was
started in. Path traversal outside the project, or any way for a web page to reach that server, is a
security issue.

## Reporting a vulnerability

Please don't open a public issue. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/rafiqui1987/mdrules/security/advisories/new),
with the steps to reproduce and the impact.

You'll get a reply as soon as possible. Fixes are released in the latest version only.
