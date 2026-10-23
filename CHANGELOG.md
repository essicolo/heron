# Changelog

## 0.4.2

- CSS-only edition: heron's look as a plain userChrome.css, with no add-on, no code and no permissions. It is generated from the add-on's style sheets, attached to each release and attested like the add-on.
- The compose window's styles now live in a style sheet (styles/compose.css) instead of the script, so both editions share them.

## 0.4.1

Security and trust.

- Undo send: an undone message now leaves the Outbox before anything else (it moves to the local Drafts folder and reopens from there), so it can never be sent afterwards, even if the compose window is slow to open.
- Quoted-text folding reads the message through Xray wrappers, and its detection is bounded, so a crafted message can neither trick the privileged code nor freeze Thunderbird.
- Updates are pinned: `updates.json` records the SHA-256 of each package, and Thunderbird refuses a download that doesn't match.
- Releases are built by GitHub Actions from the tagged source, reproducibly, with a signed build provenance attestation. See SECURITY.md to verify a release yourself.
- The message list now redraws as soon as Thunderbird has computed a preview.

## 0.4.0

First public release.

- A (i) button in the search field lists the quick search keywords; a click adds one to the field.
- Search by tag: `tag:important` (`étiquette:` in French, `etiqueta:` in Spanish), or the Tag list in the filter panel.

- Spanish translation, and quote folding and search keywords for Spanish mail ("De: ... Enviado:", "para:", "asunto:").

- Disabling or removing heron takes effect right away, without a restart. Nothing is left in the interface and Thunderbird's settings are restored. A message waiting because of undo send is sent immediately.
- Turning a feature on or off in the preferences applies right away.
- A new "If I remove heron" section lets you keep some settings: the roomier interface, the text size and the unified folders.
- Quote folding now recognizes Outlook's reply header in HTML and plain text. The signature, the "wrote:" line and the history share a single button.
- Long recipient lists can be collapsed again after they are expanded.
- The New message button shows a pencil and shortens its label to "Write" when space is short. The pane headers are aligned and share one continuous divider, and the main menu no longer overlaps its button.
- Swipe follows the system's own gesture tracking where available (macOS with two-finger page swiping): the card follows the fingers and holds still while they rest on the touchpad. Moving back before releasing reliably cancels the swipe.
- The manifest declares that no data is collected.
