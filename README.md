# iFlow Tech Spec — CI/CD Pipeline

Automatically generates a Word technical specification whenever an SAP
Integration Suite iFlow export (`.zip`) is pushed to `iflows/`, running
entirely inside GitHub Actions.

**No external API calls of any kind.** Every field in the generated document
— step descriptions, security notes, test plan skeleton, review findings —
is derived directly from the parsed `.iflw` XML through templated logic.
Nothing about the iFlow (step names, adapter configs, script contents) is
ever sent anywhere. The workflow's network egress is explicitly locked down
to GitHub/npm infrastructure only (see `.github/workflows/techspec.yml`), so
this isn't just "the code doesn't call an API" — the runner itself blocks
any other outbound connection from happening at all.

## How it works

1. You export an iFlow from Integration Suite and drop the `.zip` into
   `iflows/` (any subfolder works, e.g. `iflows/finance/OrderSync.zip`).
2. On `git push` or in a pull request that touches `iflows/**/*.zip`, the
   workflow in `.github/workflows/techspec.yml` runs.
3. It detects which `.zip` file(s) changed, runs `tools/techspec/generate.js`
   on each, and writes `docs/tech-specs/<name>_TechSpec.docx`.
4. On a direct push (or a PR from a branch in this same repo), the generated
   doc(s) are committed straight back to `docs/tech-specs/`. They're also
   always uploaded as a downloadable workflow artifact either way.
5. On a pull request, the bot also leaves a comment confirming what happened.
6. Any Groovy scripts / message mappings referenced by the iFlow are written
   out as real files under `docs/tech-specs/<name>_TechSpec_attachments/`,
   and the document references them by filename rather than pasting source
   inline.

## One-time setup

No secrets, no API keys, nothing to configure for the generation itself.
Optionally fill in `techspec.config.json` at the repo root:

```json
{
  "watchPath": "iflows/**/*.zip",
  "outputDir": "docs/tech-specs",
  "documentMetadata": {
    "domain": "XXXX",
    "interfaceId": "I<xxx>",
    "level3Id": "",
    "author": "",
    "sapVersion": "",
    "interfacePattern": "",
    "companyName": ""
  }
}
```

`documentMetadata` fills the cover page / Document Identification table —
none of these fields exist in the iFlow export itself, so they're blank
until you set them. Everything else about the document comes from the
parsed iFlow regardless of whether you touch this file at all.

### Push an iFlow

```
git add iflows/MyProcess.zip
git commit -m "Add MyProcess iFlow export"
git push
```

Check the **Actions** tab — the workflow should pick it up, and shortly after
you'll see a new/updated file under `docs/tech-specs/`.

## What ends up in the document

Structural facts — change history, interface table, step tables (grouped by
pallet function type: all Content Modifiers together, all Scripts together,
etc.), channel/adapter configuration, version/metadata — come straight from
the parsed XML. Narrative fields (step descriptions, security/monitoring/
connectivity summaries, a starter test plan, and a findings table) are
templated from that same parsed data in `tools/techspec/lib/contentBuilder.js`
— counts, detected values, and pattern-matched credential findings, never a
guess. Any header/property table value whose key looks like a credential
(`apiKey`, `password`, `token`, etc.) is automatically flagged as a finding
and shown as `[REDACTED]` rather than printed.

## Project structure

```
.github/workflows/techspec.yml   The workflow (push / PR / manual trigger)
techspec.config.json              Document metadata + paths config
iflows/                            Drop iFlow .zip exports here
docs/tech-specs/                    Generated .docx files (+ attachments) land here
tools/techspec/
  generate.js                      CLI entry point — no network calls
  package.json
  lib/iflowParser.js               Parses the .iflw XML + scripts/mappings (xmldom)
  lib/diagrams.js                  Canvas diagrams (node-canvas)
  lib/contentBuilder.js            Templated document content (credential redaction included)
  lib/docBuilder.js                Assembles the final .docx (docx package)
```

## Known limitations

- **Pull requests from forks**: GitHub Actions can't push commits to a fork's
  branch with the default token, so for fork PRs the doc is only available as
  a workflow artifact (the bot comment says so explicitly) — it isn't
  committed back automatically. PRs from branches within this same repo work
  normally.
- **`node-canvas` native build**: the `canvas` npm package ships prebuilt
  binaries for common Linux runners, so `ubuntu-latest` should just work. If a
  future runner image causes a build failure, add this step before "Install
  generator dependencies":
  ```yaml
  - run: sudo apt-get update && sudo apt-get install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
  ```
- **No `package-lock.json` committed yet** — the workflow uses `npm install`
  rather than `npm ci` for that reason. For fully reproducible installs, run
  `npm install` once inside `tools/techspec` locally, commit the resulting
  `package-lock.json`, and switch the workflow step back to `npm ci`.
- **Message Mapping attachment lookup** uses a property key (`mappinguri`)
  that hasn't been verified against a real Message Mapping step yet — if
  your interface has one and the attachment reference doesn't show up,
  check the actual property name in the `.iflw` XML and it's a one-line fix
  in `lib/docBuilder.js`.
- Descriptions are factual/templated rather than a natural-language
  write-up (e.g. "Content Modifier step that sets 2 headers" rather than a
  narrative paragraph) — that's the deliberate trade-off for having nothing
  leave the pipeline. Treat the generated document as a strong, accurate
  first draft; add business context manually where it adds real value.
