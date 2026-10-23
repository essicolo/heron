# Security

heron asks for a lot of trust, so this page explains what it can do, what it actually does, and how to check that for yourself instead of taking my word for it.

## What full access means

Thunderbird's extension APIs cannot reach the message list, the reading pane, the search field or the tab bar, so heron is a Thunderbird Experiment: privileged code that runs inside Thunderbird. In principle, such code can read every message, contact and setting, and use the network. That is why Thunderbird warns you when you install it, and why being careful is reasonable.

## What heron actually does

heron makes no network requests at all. It has no telemetry, no remote code and no server. The only file it fetches is its own translation file, from inside the add-on.

It reads, on your computer only:

- the messages shown in the list and the reading pane, and the previews Thunderbird computes for messages already stored locally;
- Thunderbird's search index, for the unified search and to gather a conversation's replies from other folders;
- your address books, for search suggestions;
- your own identities, to put your messages on the right in the conversation view.

It writes:

- a few Thunderbird preferences (density, text size, sender display, conversation view), listed in `MODULE_PREFS` in `extension/api/implementation.js`, all restored when heron is disabled or removed;
- its own settings, in the add-on's local storage;
- the actions you ask for: swipe actions, and moving an undone message from the Outbox to the local Drafts folder.

It sends mail only when you press Send. With undo send, the message waits in the Outbox for the delay you chose, then Thunderbird sends it.

Message content is never interpreted as code. The quoted-text folding works on the message's document through Xray wrappers, so a crafted message cannot trick the privileged code.

## Not comfortable with full access?

The CSS-only edition gives heron's look with no add-on and no code at all: a style sheet that Thunderbird applies to its own windows, which you can read in full before installing. See CSS-only edition in the README.

## Check it yourself

The code is all here and readable: no minified or bundled files. The only generated file is `css/userChrome.css`, built from `extension/styles/` by `dev/make-css.py`, and the release workflow checks that it matches. A quick search for `fetch`, `XMLHttpRequest` or `WebSocket` in `extension/` shows the single local fetch.

Every release is built by GitHub Actions from the tagged source (`.github/workflows/release.yml`) and comes with a signed build provenance attestation. To check that a downloaded package comes from this repository, with the GitHub CLI:

```sh
gh attestation verify heron-0.4.2.xpi --repo essicolo/heron
gh attestation verify userChrome.css --repo essicolo/heron
```

Builds are reproducible: the same source always gives the same file, byte for byte. To rebuild a release yourself and compare:

```sh
git checkout v0.4.2
python3 -I dev/pack.py heron.xpi --update-url https://raw.githubusercontent.com/essicolo/heron/main/updates.json
shasum -a 256 heron.xpi heron-0.4.2.xpi
```

The two SHA-256 must be identical, and equal to the `update_hash` of that version in `updates.json`.

To watch the network, run Thunderbird with an outgoing firewall such as LuLu or Little Snitch: with heron installed, Thunderbird makes the same connections as without it (your mail servers, and whatever remote content you allow).

## Updates

Installed copies update themselves from `updates.json` in this repository. Each entry pins the SHA-256 of its package, and Thunderbird refuses a download that does not match.

If you prefer to review each version before running it, turn automatic updates off for heron: in Add-ons and Themes, select heron and set Allow automatic updates to Off. Then update by hand, after reading `CHANGELOG.md` and the changes since the version you trust.

## Reporting a problem

Please report security issues privately, through Report a vulnerability in this repository's Security tab, rather than in a public issue.
