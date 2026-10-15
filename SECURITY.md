# Gateway security review context

This is a review starting point, not a claim of a completed audit. Validate these intended
invariants against the exact revision and report any uncertainty. Keep vulnerability reports
private pending explicit disclosure authorization; do not open public issues with exploit
details or credentials.

## Assets and trust boundaries

- Gateway keys, admin sessions, signing secrets and key records control access. Anonymous
  clients, ordinary scoped keys and administrators have different authority. Revocation,
  expiration and model restrictions must apply on every relevant request path.
- Client headers, bodies, model names and forwarded addresses are untrusted. Proxy headers
  may affect identity/rate limits only under configured trusted-proxy rules. Attackers must
  not evade limits by supplying arbitrary forwarding headers.
- Upstream endpoints are privileged configuration. Review URL validation, redirects, timeouts,
  error paths and credential boundaries. Client Authorization must not be forwarded upstream.
  Network failures must not reveal private endpoints, secrets or raw upstream bodies.
- Key persistence and logs cross memory/filesystem boundaries. Review permissions, atomicity,
  deletion/revocation, failure recovery and redaction. Logs must not retain keys, passwords,
  private prompts, responses or authorization headers.
- The admin browser crosses session, DOM and API boundaries. Review session authorization,
  injection, credential reveal/copy, logout and error recovery without leaking secrets into
  screenshots, traces or diagnostics.
- Streaming crosses client/upstream lifecycle boundaries. Preserve cancellation, bounded
  resource usage, safe errors and the OpenAI-compatible completion/SSE contract. Client
  messages must remain exact; semantic diagnostic fixtures cannot become production prompts.
- Dependencies, executable policy scripts, hooks, CI and containers can execute code.
  Review supply-chain changes, shell input, permissions and trusted-base selection. Read-only
  CI must not gain credentials, publishing or merge authority through candidate changes.

## Review evidence

Trace attacker-controlled input to a consequential sink or failed control. Record prerequisites,
reachable attack path, impact, inspected code and reproducible evidence or explicit proof gaps.
Use synthetic credentials and disposable state. Do not contact production services, enumerate
private infrastructure, deploy, or publish findings as part of a scan without authorization.

Prioritize authentication/authorization bypass, credential exposure, SSRF/endpoint misuse,
rate-limit bypass, persistent key compromise, injection, denial of service and contract-breaking
stream behavior. Distinguish a real security defect from hardening suggestions. A fixture
test or disconnected Docker health smoke cannot establish live provider safety or visual
acceptance. Follow [review handling](docs/CODE_REVIEW_SECURITY.md) and the existing independent
review blocker rules; an advisory scan never grants merge authority.
