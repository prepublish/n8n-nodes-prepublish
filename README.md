# n8n-nodes-prepublish

An [n8n](https://n8n.io/) community node for [Prepublish](https://prepublish.ai): audit a YouTube script before you record it. Each audit returns hook, structure and pacing scores, a ready-to-record verdict, the passages most likely to lose viewers, and a rewrite for each one.

It is built for pipelines that produce scripts in volume, such as faceless channels and AI-assisted scriptwriting: every script gets audited automatically, and only scripts that pass go on to voiceover.

- [Installation](#installation)
- [Credentials](#credentials)
- [Operations](#operations)
- [Free vs paid](#free-vs-paid)
- [Workflow template: faceless script QA gate](#workflow-template-faceless-script-qa-gate)
- [Errors](#errors)
- [Compatibility](#compatibility)
- [Development](#development)
- [Publishing (maintainers)](#publishing-maintainers)
- [n8n documentation this package follows](#n8n-documentation-this-package-follows)

## Installation

### From the n8n editor (Community Nodes)

On a self-hosted n8n, as the instance owner or an admin:

1. Go to **Settings → Community Nodes**.
2. Select **Install**, enter `n8n-nodes-prepublish`, accept the risk notice and select **Install**.
3. Search for **Prepublish** in the nodes panel.

Once the node is verified by n8n, it also appears in the nodes panel under **More from the community** (on n8n Cloud as well), where you install it with one click.

### With npm

For a self-hosted n8n where you manage packages yourself (for example in Docker, inside the container):

```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-prepublish
```

Then restart n8n. n8n loads every community package in `~/.n8n/nodes/node_modules` when it starts.

## Credentials

The credential is **optional**. Without one, the node calls the API anonymously on the free tier (see [Free vs paid](#free-vs-paid)).

To use your plan:

1. Sign in at [prepublish.ai/dashboard](https://prepublish.ai/dashboard) and create an API key. API keys come with the paid plans and start with `pp_live_`.
2. In n8n, open a Prepublish node, choose **Credential to connect with → Create new credential**, and paste the key into **API Key**.
3. Leave **Base URL** as `https://api.prepublish.ai`. It exists only to point the node at a Prepublish test server.
4. Save. n8n tests the key by calling `GET /api/auth/me`.

The key is sent as `Authorization: Bearer <key>`.

## Operations

### Audit Script

Starts an audit (`POST /api/analyze`) and, by default, waits for it to finish.

| Parameter | Description |
| --- | --- |
| Video Title | The working title (up to 255 characters). Required. |
| Script Text | The full script as it will be read aloud (at least 50 characters). Required. |
| Wait for Result | On by default. The node checks the audit every 3 seconds until it is finished (usually 10 to 60 seconds) and outputs the full report. Off: the node outputs the audit ID right away and you fetch the report later with **Get Audit**. |
| Timeout (Seconds) | How long to wait when **Wait for Result** is on. Default 180. If the audit is still running at the deadline, the node stops with a message that includes the audit ID, so you can fetch it later. |
| Additional Fields | **Audience**, **Category** (free text, up to 500 characters each), **Direction for This Pass** (what the audit should focus on, up to 500 characters), **Keep Passages Unchanged** (up to 10 passages copied exactly from the script that the audit must not suggest changing), **Results Email** (Prepublish emails the finished report to this address), **Video Duration (Seconds)**. |

Each input item is audited separately, so a list of 20 scripts produces 20 audits.

### Get Audit

Fetches an audit by its ID (`GET /api/analysis/{id}`): the `analysis_id` output by **Audit Script**, or the last part of the report URL.

### Output

Both operations output the same clean JSON. The script text is never passed back.

This is the real output of **Audit Script** run anonymously against production from n8n 2.44.6 on 2026-10-23 (a 189-word history script):

```json
{
  "analysis_id": "d6414d64-40fd-44b0-9f03-0fce3f63f94e",
  "video_title": "The Shipwreck That Rewrote Roman History",
  "status": "completed",
  "overall_score": 68,
  "hook_score": 74,
  "structure_score": 65,
  "pacing_score": 66,
  "ready_to_record": false,
  "one_key_improvement": "Abrupt ending drops the narrative before delivering the promised payoff.",
  "lock_reason": "upgrade_required",
  "created_at": "2026-10-23T17:34:11.024777Z",
  "score_explanations": {
    "hook": "The underwater imagery of dead bodies turning out to be bronze statues grabs attention immediately, though the introductory date and weather details delay the punchline slightly.",
    "structure": "The narrative flows logically from discovery to revelation, but ends abruptly on an unresolved teaser question without delivering an initial substantive insight.",
    "pacing": "The sentences maintain a clear, steady cadence, but the second half shifts into an informational list rather than maintaining the suspense built in the opening."
  },
  "improvements": [
    {
      "priority": "CRITICAL",
      "category": "closing",
      "title": "Replace empty cliffhanger outro",
      "timestamp": "~0:55 mark",
      "original_quote": "So who built it, and why did the knowledge disappear? That is what we are going to find out.",
      "improved": "So who built it, and why did this level of engineering disappear from the historical record? The investigation starts right here.",
      "why": "Eliminates the cliché TV phrasing while preserving the core historical questions that define the topic.",
      "locked": false
    },
    {
      "priority": "HIGH",
      "category": "hook",
      "title": "Lead with the diver's panic",
      "timestamp": "Opening 0:00-0:15",
      "original_quote": "In 1900, sponge divers off the Greek island of Antikythera were waiting out a storm when one of them dropped into the water and came back up shaking. He said he had seen a pile of dead bodies on the seabed.",
      "locked": true
    },
    {
      "priority": "MEDIUM",
      "category": "structure",
      "title": "Sharpen transition to the artifact",
      "timestamp": "~0:20 mark",
      "original_quote": "The divers hauled up statues, glassware, coins and pottery. And one lump of corroded bronze and wood that nobody paid attention to for almost two years.",
      "locked": true
    },
    {
      "priority": "MEDIUM",
      "category": "structure",
      "title": "Energize mechanism capability list",
      "timestamp": "~0:40 mark",
      "original_quote": "Today we call it the Antikythera mechanism. X-ray scans have shown it could predict eclipses, track the phases of the moon and follow the cycle of the Olympic Games.",
      "locked": true
    }
  ],
  "locked_count": 3,
  "locked": true,
  "policy_preflight": {
    "verdict": "no_matches",
    "total_flags": 0,
    "counts_by_category": {},
    "locked": true,
    "scope_statement": "This reads your script text only. Visuals, thumbnails, delivery, and edits are not checked. It flags passages that match categories in YouTube's published guidelines. It is not a YouTube decision, and it is not a guarantee."
  },
  "report_url": "https://prepublish.ai/analysis/d6414d64-40fd-44b0-9f03-0fce3f63f94e"
}
```

| Field | Meaning |
| --- | --- |
| `ready_to_record` | Prepublish's verdict. Branch on this with an **If** node. |
| `overall_score`, `hook_score`, `structure_score`, `pacing_score` | 0 to 100. |
| `one_key_improvement` | The single change that matters most. |
| `improvements[]` | The flagged passages in priority order: `priority`, `category`, `title`, `timestamp` (position in the script), `original_quote`, `improved` (the rewrite), `why`, `locked`. A locked item has no `improved` or `why` on your plan. |
| `locked_count` | How many improvements are locked. `0` on a paid plan. |
| `locked`, `lock_reason` | Whether the plan held anything back on this report, and why. |
| `policy_preflight` | Verdict of the YouTube advertiser-policy read (`no_matches`, `review_suggested` or `high_matches`), with counts. |
| `report_url` | The full report on prepublish.ai, to share with an editor or client. |

With **Wait for Result** off, the output is the audit ID, `status` (`pending`), `progress` and `report_url`.

The node can also be used as a tool by n8n AI Agents.

## Free vs paid

| | No credential (free tier) | API key (paid plan) |
| --- | --- | --- |
| Audits | 3 a day per IP address | Creator plan: up to 50 scripts a day |
| Scores, verdict, one key improvement | Yes | Yes |
| Rewrites | The biggest issue only; the other improvements come back `locked` | Every improvement |
| Policy passages | Locked | Included |

Plans: Ready-to-Record Pass ($19 once, per script), Creator ($29 a month or $290 a year), Creator Lifetime ($149 once). See [prepublish.ai/pricing](https://prepublish.ai/pricing).

The free allowance is counted per IP address. On a shared host, such as n8n Cloud, other users behind the same address may already have used it, so add an API key for anything beyond a quick test.

## Workflow template: faceless script QA gate

[`templates/faceless-script-qa-gate.json`](templates/faceless-script-qa-gate.json) is a ready-to-import workflow for faceless and AI video pipelines:

```
Start: sample script ─► Audit script with Prepublish ─► Ready to record?
                                                         ├─ true ─► Send to voiceover
                                                         └─ false ─► Build rewrite brief ─► Rewrite script with OpenAI
                                                                     ─► Re-audit rewritten script ─► Ready after one rewrite?
                                                                                                     ├─ true ─► Send rewritten script to voiceover
                                                                                                     └─ false ─► Needs human review
```

- The Manual Trigger has pinned sample data (a title and a 250-word script), so it runs as soon as it is imported.
- **Build rewrite brief** turns `one_key_improvement` and each improvement's `title`, `original_quote` and `improved` into a numbered brief.
- **Rewrite script with OpenAI** (the OpenAI node's **Message a model** operation, model `gpt-5-mini`) applies the brief and returns only the revised script.
- The rewritten script is audited once more. There is exactly one rewrite pass, so the workflow cannot loop.
- Sticky notes on the canvas explain setup in plain English.

To use it:

1. Install this node (see [Installation](#installation)); both Prepublish nodes in the template need it.
2. In n8n, select **Workflows → Create Workflow**, open the **⋯** menu → **Import from File…**, and choose the JSON file (or paste its contents onto the canvas).
3. Optional: add a **Prepublish API** credential to both Prepublish nodes.
4. Select your OpenAI credential on **Rewrite script with OpenAI**.
5. Select **Execute workflow**. Then replace the first node with your real trigger; it only needs to output `video_title` and `script_text`.

Without an API key the template uses up to 2 of the 3 free daily audits per script.

## Errors

Errors say what happened and what to do next. The ones you are most likely to see:

| Situation | Message |
| --- | --- |
| Free daily audits used up (no credential) | "The free daily Prepublish audits from this network are used up", telling you to add an API key from prepublish.ai/dashboard to the 'Prepublish API' credential. |
| Plan's daily limit reached (with credential) | "The daily audit limit on this Prepublish account is used up", with the server's message and the pricing link. |
| Wrong API key | "Prepublish did not accept the API key". |
| A parameter the API rejects | "Prepublish did not accept the 'Script Text' parameter" (or whichever parameter), with the API's reason, for example "Script must be at least 50 characters". |
| Audit still running at the timeout | "The audit did not finish within 180 seconds", with the audit ID for **Get Audit**. |

With **Settings → On Error → Continue** on the node, a failed item outputs `{ "error", "description" }` and the remaining items carry on.

## Compatibility

Built with `@n8n/node-cli` 0.53.4 against `n8n-workflow` 2.44.2 (nodes API version 1). Tested on n8n 2.44.6.

The package has no runtime dependencies.

## Development

```bash
npm install
npm run build     # n8n-node build
npm run lint      # n8n-node lint
npm run dev       # n8n-node dev: starts n8n with this node loaded (needs Docker or Podman, or use --external-n8n)
```

To run the built node in an n8n you start yourself, point `N8N_CUSTOM_EXTENSIONS` at `dist/` (the node type is then `CUSTOM.prepublish`), or extract the `npm pack` tarball into `~/.n8n/nodes/node_modules/n8n-nodes-prepublish` (the node type is then `n8n-nodes-prepublish.prepublish`, the one the template uses).

## Publishing (maintainers)

n8n only verifies community nodes that are published from GitHub Actions with an npm provenance statement (required since May 1, 2026). `package.json` blocks a plain `npm publish` from a laptop on purpose (`prepublishOnly: n8n-node prerelease`). The steps:

### 1. Create the public repository

1. Create the **public** repository `prepublish/n8n-nodes-prepublish` on GitHub (the `repository` field in `package.json` already points there; change it if you choose another name).
2. Copy the contents of this directory to the root of that repository, without `node_modules/` and `dist/` (both are in `.gitignore`), so `.github/workflows/publish.yml` and `ci.yml` sit at the repository root. Commit and push to `main`. From then on that repository is the source of truth for the node.

### 2. Publish to npm

1. Sign in to npmjs.com with the account that will own the package. The name `n8n-nodes-prepublish` was unclaimed on 2026-10-23.
2. Give the workflow permission to publish, using one of:
   - **Trusted Publishing** (recommended): on npmjs.com, open the package's **Settings → Publish access → Trusted Publishers → Add a publisher**, choose **GitHub Actions**, owner `prepublish`, repository `n8n-nodes-prepublish`, workflow `publish.yml`.
   - **Token**: create a Granular Access Token with read and write access to the package and save it in the GitHub repository as the Actions secret `NPM_TOKEN`. If npm does not let you add a Trusted Publisher before the package exists, use the token for the first release, then switch to Trusted Publishing and delete the secret.
3. In a clean clone of the repository on `main`, run:

   ```bash
   npm ci
   npm run release
   ```

   This lints, builds, asks for the version (choose `0.1.0` for the first release, or bump), updates `CHANGELOG.md`, commits, tags, pushes and creates a GitHub release. release-it needs a `GITHUB_TOKEN` environment variable with access to the repository to create the GitHub release.
4. The pushed tag starts `publish.yml`, which publishes to npm with provenance. Check that the package page on npmjs.com shows the provenance badge.
5. Run n8n's package scan and fix anything it reports:

   ```bash
   npx @n8n/scan-community-package n8n-nodes-prepublish
   ```

### 3. Submit the node for verification

1. Sign up or sign in at the [n8n Creator Portal](https://creators.n8n.io/nodes).
2. Submit `n8n-nodes-prepublish`. n8n reviews it against the [verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines.md) and the [UX guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines.md) and fetches the package from npm.

### 4. Submit the template to the n8n template library

1. Register as a creator at [creators.n8n.io/register](https://creators.n8n.io/register) and read the [Creator Hub guide](https://n8n.notion.site/n8n-Creator-hub-7bd2cbe0fce0449198ecb23ff4a2f76f) (submission guidelines and review checks).
2. Import `templates/faceless-script-qa-gate.json` into an n8n with the published node installed, run it once with your own OpenAI credential, then remove all credentials before exporting.
3. In the [Creator Dashboard](https://creators.n8n.io/login), submit it as a new template with a name, short description, categories and the workflow JSON. Reviews usually take up to a week; new creators can have one template in review at a time.

Whether the template library accepts templates that use a community node before that node is verified could not be confirmed (the Creator Hub guide did not load outside a browser session). Submitting the template after the node is verified avoids the question.

## n8n documentation this package follows

Pages read on 2026-10-23 (the docs site does not publish version numbers, so the date is the version):

- [Using the n8n-node tool](https://docs.n8n.io/connect/create-nodes/build-your-node/using-the-n8n-node-tool) (`https://docs.n8n.io/integrations/creating-nodes/` now redirects into this section)
- [Verification guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines.md)
- [UX guidelines](https://docs.n8n.io/connect/create-nodes/build-your-node/reference/ux-guidelines.md)
- [Submit community nodes](https://docs.n8n.io/connect/create-nodes/deploy-your-node/submit-community-nodes)
- [Install verified community nodes](https://docs.n8n.io/integrations/community-nodes/installation-and-management/install-verified-community-nodes.md)
- [Use templates](https://docs.n8n.io/build/ways-of-building-workflows/use-templates.md) and n8n's help article [Becoming an n8n template creator](https://support.n8n.io/article/becoming-an-n8n-template-creator-and-getting-help)

Tooling: scaffolded with `npm create @n8n/node@latest -- --template programmatic/example` (`@n8n/create-node` 0.54.2), built and linted with `@n8n/node-cli` 0.53.4, whose lint uses `@n8n/eslint-plugin-community-nodes` 0.36.0.

The node uses the programmatic style rather than the declarative one because **Audit Script** with **Wait for Result** is one request followed by a polling loop of dependent requests, which declarative routing cannot express, and because the credential has to be optional for the free tier.

## License

[MIT](LICENSE.md)
