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
    root.removeAttribute("heron-format");
    for (const { node, parent, next } of homes.reverse()) {
      parent.insertBefore(node, next?.parentNode == parent ? next : null);
    }
  });
})();
