# WebMCP Challenge submission checklist

Deadline: **September 3, 2026 at 1:00 PM PDT**.

This directory contains the material needed to publish and submit DSTAR. It is
not product documentation and should stay factual about what is deployed and
verified.

## Required before submission

- [ ] Register for the WebMCP Challenge on Devpost.
- [x] Choose and add an open source license. Apache-2.0 is recommended for this
      protocol and SDK repository because it includes an explicit patent grant.
- [x] Make the source repository public and confirm the license is detected on
      the repository landing page.
- [ ] Publish a stable HTTPS URL that judges can open without payment or local
      setup through the end of judging.
- [ ] Verify the deployed page in the ChatGPT in-app browser: tools are
      discovered, context and document reads succeed, and an Owner can submit a
      revision without the agent accepting it.
- [ ] Verify a fresh judge session using the exact access instructions and any
      credentials placed in Devpost.
- [ ] Replace every placeholder in [devpost.md](devpost.md).
- [ ] Record, edit and publish the demo described in
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
- Public YouTube URL and exact video duration.
- A copy of the final Devpost text and testing instructions.
