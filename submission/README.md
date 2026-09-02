# WebMCP Challenge submission checklist

Deadline: **September 3, 2026 at 1:00 PM PDT**.

This directory contains the material needed to publish and submit DSTAR. It is
not product documentation and should stay factual about what is deployed and
verified.

## Required before submission

- [x] Register for the WebMCP Challenge on Devpost.
- [x] Choose and add an open source license. Apache-2.0 is recommended for this
      protocol and SDK repository because it includes an explicit patent grant.
- [x] Make the source repository public and confirm the license is detected on
      the repository landing page.
- [x] Publish a stable HTTPS URL that judges can open without payment or local
      setup through the end of judging.
- [x] Verify the deployed page in the ChatGPT in-app browser: tools are
      discovered, context and document reads succeed, and an Owner can submit a
      revision without the agent accepting it.
- [x] Verify a fresh judge session using the exact access instructions and any
      credentials placed in Devpost.
- [x] Replace every placeholder in [devpost.md](devpost.md).
- [x] Record, edit and publish the demo described in
      [demo-script.md](demo-script.md) as a public YouTube video under three
      minutes.
- [ ] Add final screenshots without third-party trademarks or unlicensed
      material.
- [ ] Save a Devpost draft early, then run one final link and permissions check
      before submitting.

## Recommended deployment shape

For judging, prefer an isolated workspace per visitor over one shared mutable
document. The existing workspace service can create a fresh copy of a read-only
seed with separate Owner and Reviewer URLs and rotate both credentials on reset.
It requires one HTTPS control origin, wildcard DNS/TLS for workspace subdomains,
one persistent local volume and one service replica.

If wildcard DNS cannot be ready in time, deploy one fixed Viewer instance and
provide its complete Owner access link in Devpost testing instructions. Treat
that as a fallback: concurrent judges share history and can affect one another.

## Final evidence to retain

- Public repository URL and commit used for submission.
- Live URL and deployment revision.
- Screenshot or transcript of WebMCP tool discovery on the deployed origin.
- Successful deployed calls for `get_review_context`, `read_document`, and an
  Owner `propose_revision` followed by an explicit human decision.
- `pnpm verify` output for the submitted commit.
- Public YouTube URL: https://youtu.be/v66wnIOBoZU (1:47.421 source duration;
  YouTube displays 1:48).
- A copy of the final Devpost text and testing instructions.

## Production verification — September 2, 2026

- Live URL: https://www.thinkofu.ai/dstar/
- Vercel deployment: `dpl_BAUGHzgxyEWNym2m2sVbsRgeQvQN` (`READY`, production).
- Response policy: `Permissions-Policy: tools=(self)` on both the library and
  document review routes.
- Fresh in-app-browser session discovered all five public WebMCP tools.
- `get_review_context` returned the exact accepted revision and
  `read_document` returned its complete HTML/CSS files.
- `propose_revision` created pending revision
  `sha256:afceb807c4b6583ab7ce20103ca918b186d2a6171b23145927161d3e28e71703`
  while the current revision remained unchanged. The revision became current
  only after an explicit Owner review and Accept action in the Viewer.
