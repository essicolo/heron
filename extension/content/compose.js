/* heron: a calmer compose window.
 *
 * Run by api/implementation.js in a sandbox whose prototype is the compose window (messengercompose.xhtml).
 *
 * - Send: main button, in the accent color; Attach right next to it, with its label.
 * - Aa: shows / hides the formatting bar (hidden by default, choice remembered).
 * - Encrypt, Spelling, Save, Contacts...: icons only, subdued, on the right.
 * The layout is changed on display only: the saved toolbar configuration is not modified (uninstalling heron restores the original window).
 */
(() => {
  if (window.__heronCompose) {
    return;
  }
  window.__heronCompose = true;
  heronOnStop(() => delete window.__heronCompose);

  const t = (key, ...args) =>
    args.reduce((s, v, i) => s.replaceAll(`{${i + 1}}`, v), heronStrings?.[key] || key);

  const PREF_FORMAT = "heron.compose.showFormatBar";
  const TEXT = { format: t("composeFormat"), formatTip: t("composeFormatTip") };

  const root = document.documentElement;
  const toolbar = document.getElementById("composeToolbar2");
  const send = document.getElementById("button-send");
  const attach = document.getElementById("button-attach");
  if (!toolbar || !send) {
    return;
  }

  const style = document.createElement("style");
  style.textContent = `
    /* Main toolbar: more room, no separators. */
    #composeToolbar2 { padding-block: 6px; gap: 4px; }
    #composeToolbar2 > toolbarseparator { display: none; }

    /* Send: the main button. */
    #button-send {
      background: AccentColor !important; color: AccentColorText !important;
      border-radius: 8px !important; padding-inline: 10px !important;
    }
    #button-send:not([disabled="true"]):hover { filter: brightness(1.08); }
    #button-send[disabled="true"] { opacity: 0.5; }

    /* Secondary actions: icons only, subdued (label on hover). */
    #composeToolbar2 > :is(#button-encryption, #button-encryption-options, #button-address,
                           #spellingButton, #button-save, #button-contacts, #button-signing)
      .toolbarbutton-text { display: none !important; }
    #composeToolbar2 > :is(#button-encryption, #button-encryption-options, #button-address,
                           #spellingButton, #button-save, #button-contacts, #button-signing) {
      opacity: 0.6;
    }
    #composeToolbar2 > :is(#button-encryption, #button-encryption-options, #button-address,
                           #spellingButton, #button-save, #button-contacts, #button-signing):hover {
      opacity: 1;
    }

    /* Aa */
    #heron-format-toggle {
      appearance: none; min-width: 0; margin: 0; padding: 2px 10px; border-radius: 8px;
      border: 1px solid transparent; background: transparent; color: inherit;
      font: 600 15px/1 Georgia, "Times New Roman", serif; cursor: pointer;
    }
    #heron-format-toggle:hover { background: color-mix(in srgb, currentColor 10%, transparent); }
    #heron-format-toggle[aria-pressed="true"] {
      background: color-mix(in srgb, AccentColor 18%, transparent); color: AccentColor;
    }
    #heron-format-toggle[hidden] { display: none; }

    /* Headers (From, To, Cc, Subject): a line under each field instead of a border, accented when the field has focus; gray labels, like Apple Mail. */
    #MsgHeadersToolbar { padding-block: 4px 8px !important; }
    #MsgHeadersToolbar :is(.address-container, #msgSubject) {
      border: none !important; border-radius: 0 !important; box-shadow: none !important;
      background: transparent !important;
      border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent) !important;
    }
    #MsgHeadersToolbar :is(.address-container:focus-within, #msgSubject:focus) {
      border-bottom-color: AccentColor !important; outline: none !important;
    }
    #identityLabel, .address-label-container label, #subjectLabel {
      color: color-mix(in srgb, currentColor 55%, transparent) !important; font-weight: normal !important;
    }
    #msgIdentity { border-color: transparent !important; background: transparent !important; }
    #extraAddressRowsArea .recipient-button { color: color-mix(in srgb, currentColor 60%, transparent); }
    #extraAddressRowsArea .recipient-button:hover { color: inherit; }

    /* Formatting bar hidden until requested. */
    :root:not([heron-format]) #FormatToolbar { display: none !important; }
  `;
  root.appendChild(style);

  // Layout: Send, Attach, Aa ... (the other actions follow, on the right).
  // Remember the original place of Attach and of the spring, to put them back on stop.
  const homeOf = node => node && { node, parent: node.parentNode, next: node.nextSibling };
  const homes = [homeOf(attach), homeOf(toolbar.querySelector("toolbarspring"))].filter(Boolean);
  if (attach) {
    send.after(attach);
  }
  const toggle = document.createElement("button");
  toggle.id = "heron-format-toggle";
  toggle.type = "button";
  toggle.textContent = "Aa";
  toggle.title = TEXT.formatTip;
  toggle.setAttribute("aria-label", TEXT.format);
  (attach ?? send).after(toggle);

  // The first toolbar "spring" pushes the secondary actions to the right.
  const spring = toolbar.querySelector("toolbarspring");
  if (spring) {
    toggle.after(spring);
  }

  const showFormat = () => Services.prefs.getBoolPref(PREF_FORMAT, false);

  function update() {
    // In plain text, Thunderbird has no formatting bar: Aa disappears too.
    toggle.hidden = !isHTML();
    const on = showFormat() && isHTML();
    root.toggleAttribute("heron-format", on);
    toggle.setAttribute("aria-pressed", String(on));
  }

  /** Is the message HTML? (Thunderbird exposes gMsgCompose once the editor is ready.) */
  function isHTML() {
    try {
      return Boolean(window.gMsgCompose?.composeHTML ?? true);
    } catch {
      return true;
    }
  }

  toggle.addEventListener("click", () => {
    Services.prefs.setBoolPref(PREF_FORMAT, !showFormat());
    update();
  });
  heronListen(window, "compose-editor-ready", update);
  update();

  // On stop: restore the original toolbar and formatting.
  heronOnStop(() => {
    toggle.remove();
    style.remove();
    root.removeAttribute("heron-format");
    for (const { node, parent, next } of homes.reverse()) {
      parent.insertBefore(node, next?.parentNode == parent ? next : null);
    }
  });
})();
