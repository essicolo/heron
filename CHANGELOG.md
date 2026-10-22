# Changelog

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
