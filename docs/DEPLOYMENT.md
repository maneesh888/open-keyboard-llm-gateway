# Gateway deployment

The repository has two named runtime environments. They are locations and lifecycle types, not provider modes:

| Environment | Runtime | Existing endpoint | Deployable unit |
| --- | --- | --- | --- |
| `mac-staging` | Local Docker container `llm-gateway` | `http://127.0.0.1:8880` | OCI image tagged `llm-gateway:git-<full-revision>` |
| `oneplus7t-production` | Native Node 24 bundle managed by OpenRC | `http://192.168.1.130:8880` | Revision-labelled `app/` release archive |

Ollama and Apfel remain provider routes inside a deployment. They are not deployment environments.

## Safety boundary

`scripts/deploy-gateway.mjs` is plan-only unless `--apply` and an exact `<environment>:<full-revision>` confirmation are both supplied. Creating or merging a change does not authorize a deployment. Run apply only after the repository owner separately authorizes that exact target and revision. The script deploys one target per invocation and never changes Cloudflare, DNS, GitHub Environments, credentials, provider data, or the other target.

Every revision must be a full commit on `origin/main`. The script emits only sanitized booleans, revisions, target names, and rollback state. It does not print container environment values, mount sources, credentials, request bodies, or gateway responses.

Inspect a target without changing it:

```sh
npm run deploy:gateway -- \
  --environment mac-staging \
  --revision <full-origin-main-sha>
```

## Mac Docker target

Builds are allowed only from a clean checkout whose `HEAD` and pinned semantic-contract gitlink match the requested revision. The image uses the full revision tag and OCI revision label. If that tag already exists, the script refuses to replace it when its label differs.

Apply form, after separate exact authorization:

```sh
npm run deploy:gateway -- \
  --environment mac-staging \
  --revision <full-origin-main-sha> \
  --build \
  --apply \
  --confirm mac-staging:<full-origin-main-sha>
```

The script obtains a deployment lock, holds the inspected container configuration only in process memory, stops and renames the existing container as the rollback container, and creates the candidate with that inspected configuration while changing only the image and revision label. This retains bind mounts—including existing config and secret mounts—ports, environment, restart policy, network, security options, command, user, and health check without printing them.

The candidate must become healthy, return HTTP 200 from `/health` and `/ui`, return HTTP 401 from unauthenticated `/v1/models`, and expose the exact same mount set. Failure removes only the candidate and restores/restarts the retained previous container. Success removes the temporary rollback container; the previous image remains locally available by its immutable revision tag.

An already-built image may be selected with `--image`; its OCI revision label must exactly match `--revision`.

## OnePlus 7T target

The phone cannot safely use normal Docker on its current kernel. Its deployable unit is therefore an immutable release archive, not an OCI image. The archive must contain:

```text
app/RELEASE.json
app/package.json
app/dist/index.js
...the complete production app bundle...
```

`RELEASE.json` must name the exact `git_revision` and target `existing phone Linux arm64 Node 24 runtime`. If the installed app contains `KEEPALIVE_OVERRIDE.json`, the candidate must contain a byte-identical marker; otherwise deployment fails before the service is stopped. The bundle preparation process must also include the documented phone-specific runtime changes represented by that marker.

Plan with pinned SSH evidence and an artifact:

```sh
npm run deploy:gateway -- \
  --environment oneplus7t-production \
  --revision <full-origin-main-sha> \
  --artifact /absolute/private/path/llm-gateway-phone-<full-origin-main-sha>.tar.gz \
  --ssh-identity /absolute/private/path/server-ssh-key \
  --known-hosts /absolute/private/path/known_hosts
```

After separate exact authorization, append:

```sh
  --apply \
  --confirm oneplus7t-production:<full-origin-main-sha>
```

Apply requires an interactive terminal for the phone's existing `sudo` authentication. The password is entered directly into the remote prompt and is never accepted as an argument, environment variable, file, or log value. The release archive contains no `/etc/oneplus-llm` data or credentials.

The privileged phone installer verifies the artifact digest and safe archive paths, obtains a remote lock, fingerprints `/etc/oneplus-llm` without printing it, retains the current app as a revision-labelled rollback bundle, replaces only `/opt/oneplus-llm/app`, and restarts only `oneplus-llm`. It requires HTTP 200 from `/health` and `/ui`, HTTP 401 from unauthenticated `/v1/models`, and an unchanged configuration fingerprint. Any failure after the swap automatically stops the candidate, restores the previous app, restarts the service, and verifies old health. A successful deployment retains the previous bundle for an explicit later rollback.

## Evidence limits

These checks prove deployment mechanics, health, UI serving, and the unauthenticated API boundary. They do not prove real Ollama/Apfel inference, semantic quality, public tunnel routing, OpenKeyboard behavior, or long-run phone thermal/memory behavior. Run the repository's separately classified exact-head verification before deployment, and authorize any live provider, public route, credential, or device change separately.
