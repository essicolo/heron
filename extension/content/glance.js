/* heron: "Glance": no tabs, overlaid cards.
 *
 * Run by api/implementation.js in a sandbox whose prototype is the main window (messenger.xhtml).
 *
 * Thunderbird opens Settings, Add-ons, Troubleshooting and double-clicked messages in tabs. Thunderbird still creates its tabs (its features depend on them), but the tab bar is gone and the content of these tabs shows as a floating card above the dimmed mail view, like the "Glance" feature of Zen Browser. Closing the card (✕, Escape, click on the backdrop) closes the tab and returns to mail.
 */
(() => {
  if (window.__heronGlance) {
    return;
  }
  window.__heronGlance = true;
  heronOnStop(() => delete window.__heronGlance);

  const t = (key, ...args) =>
    args.reduce((s, v, i) => s.replaceAll(`{${i + 1}}`, v), heronStrings?.[key] || key);

  /** Tab types shown as a card. Spaces (calendar, contacts...) stay full views. */
  const GLANCE_MODES = new Set([
    "preferencesTab",
    "contentTab",
    "mailMessageTab",
    "calendarEvent",
    "calendarTask",
  ]);

  const tabmail = document.getElementById("tabmail");
  const root = document.documentElement;

  const style = document.createElement("style");
  style.textContent = `
    /* No tab bar, ever. */
    #tabs-toolbar { display: none !important; }

    /* Mail stays visible under the card (Thunderbird usually hides inactive tabs). */
    :root[heron-glance] #tabpanelcontainer > [id^="mail3PaneTab"] {
      -moz-subtree-hidden-only-visually: 0 !important;
      visibility: visible !important;
    }

    #heron-glance-backdrop {
      display: none; position: fixed; inset: 0; z-index: 2;
      background: rgba(0, 0, 0, 0.38);
    }
    :root[heron-glance] #heron-glance-backdrop { display: block; animation: heron-fade 140ms ease-out; }

    /* The card: the selected tab's panel. */
    :root[heron-glance] #tabpanelcontainer > .deck-selected {
      z-index: 3; margin: 36px 7vw; border-radius: 14px; overflow: hidden;
      background: var(--layout-background-0, Canvas);
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
      animation: heron-pop 160ms cubic-bezier(.2, .8, .2, 1);
    }
    /* A message is read in a narrower, centered card. */
    :root[heron-glance="message"] #tabpanelcontainer > .deck-selected {
      margin-inline: max(7vw, calc((100% - 1000px) / 2));
    }

    #heron-glance-close, .heron-glance-nav {
      all: unset; box-sizing: border-box; min-width: 0; margin: 0; padding: 0; appearance: none;
      display: none; position: fixed; z-index: 4; width: 30px; height: 30px;
      align-items: center; justify-content: center; cursor: pointer;
      border: none; border-radius: 50%; font: 18px/1 system-ui, sans-serif;
      color: var(--layout-color-1, CanvasText);
      background: color-mix(in srgb, var(--layout-background-0, Canvas) 85%, CanvasText);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    }
    #heron-glance-close:hover, .heron-glance-nav:hover {
      background: color-mix(in srgb, var(--layout-background-0, Canvas) 70%, CanvasText);
    }
    :root[heron-glance] #heron-glance-close { display: flex; }
    :root[heron-glance="message"] .heron-glance-nav { display: flex; }

    @keyframes heron-fade { from { opacity: 0; } }
    @keyframes heron-pop { from { opacity: 0; transform: scale(0.985); } }
  `;
  root.appendChild(style);

  const backdrop = document.createElement("div");
  backdrop.id = "heron-glance-backdrop";
  root.appendChild(backdrop);

  const close = document.createElement("button");
  close.id = "heron-glance-close";
  close.type = "button";
  close.textContent = "✕";
  close.title = t("glanceCloseTip");
  close.setAttribute("aria-label", t("glanceClose"));
  root.appendChild(close);

  // Next / previous message, without closing the card.
  const navButtons = [
    ["↑", t("glancePrevious"), "cmd_previousMsg"],
    ["↓", t("glanceNext"), "cmd_nextMsg"],
  ].map(([label, title, command]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "heron-glance-nav";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", () => {
      tabmail.currentTabInfo?.chromeBrowser?.contentWindow?.commandController?.doCommand(command);
    });
    root.appendChild(button);
    return button;
  });

  const isGlance = tab => GLANCE_MODES.has(tab?.mode?.name);

  // Side of the ✕: the same as the system's window buttons.
  // macOS: left. Linux: per GTK (elementary OS, or GNOME / KDE set to the left → left).
  // Windows and everything else: right. The heron.closeButtonSide preference (auto | left | right) forces a side.
  const leftPlacement = [
    window.matchMedia("(-moz-platform: macos)"),
    window.matchMedia("(-moz-gtk-csd-reversed-placement)"),
  ];
  function closeSide() {
    const forced = Services.prefs.getStringPref("heron.closeButtonSide", "auto");
    if (forced == "left" || forced == "right") {
      return forced;
    }
    return leftPlacement.some(query => query.matches) ? "left" : "right";
  }

  /** Places the ✕ button on the card's top corner (left or right, see closeSide). */
  function placeCloseButton() {
    const panel = tabmail.currentTabInfo?.panel;
    if (!panel) {
      return;
    }
    const rect = panel.getBoundingClientRect();
    const left = closeSide() == "left";
    // Straddling a top corner: the button hides none of the content.
    close.style.top = `${rect.top - 15}px`;
    close.style.left = `${(left ? rect.left : rect.right) - 15}px`;
    // The arrows go on the same side, outside the card, below the ✕: they do not cover the header.
    navButtons.forEach((button, i) => {
      button.style.top = `${rect.top + 30 + i * 38}px`;
      button.style.left = `${left ? rect.left - 12 - 30 : rect.right + 12}px`;
    });
  }

  function update() {
    const tab = tabmail.currentTabInfo;
    if (isGlance(tab)) {
      root.setAttribute("heron-glance", tab.mode.name == "mailMessageTab" ? "message" : "page");
      requestAnimationFrame(placeCloseButton);
    } else {
      root.removeAttribute("heron-glance");
    }
  }

  function closeGlance() {
    const tab = tabmail.currentTabInfo;
    if (isGlance(tab)) {
      tabmail.closeTab(tab);
    }
  }

  close.addEventListener("click", closeGlance);
  backdrop.addEventListener("click", closeGlance);

  /**
   * A second mail tab (middle click on a folder, an extension...) would be invisible without a tab bar: open its folder in the main mail tab instead.
   */
  function foldExtraMailTab(tab) {
    const main = tabmail.tabInfo.find(other => other != tab && other.mode?.name == "mail3PaneTab");
    if (!main || tab.mode?.name != "mail3PaneTab") {
      return;
    }
    const uri = tab.folder?.URI ?? tab.chromeBrowser?.contentWindow?.gFolder?.URI;
    tabmail.closeTab(tab);
    tabmail.switchToTab(main);
    if (uri) {
      main.chromeBrowser.contentWindow.displayFolder?.(uri);
    }
  }

  const tabs = tabmail.tabContainer;
  heronListen(tabs, "TabSelect", update);
  heronListen(tabs, "TabOpen", event => {
    const tab = tabmail.tabInfo.find(info => info.tabNode == event.target);
    if (tab?.mode?.name == "mail3PaneTab") {
      // The folder is only known once the tab has loaded.
      setTimeout(() => foldExtraMailTab(tab), 600);
    }
    setTimeout(update, 0);
  });
  heronListen(tabs, "TabClose", () => setTimeout(update, 0));
  const replace = () => root.hasAttribute("heron-glance") && placeCloseButton();
  heronListen(window, "resize", replace);
  // The system setting can change while Thunderbird is running (e.g. GNOME Tweaks).
  for (const query of leftPlacement) {
    heronListen(query, "change", replace);
  }

  // Escape closes the card. A window <key> also receives keystrokes made in the card's content (Settings, Add-ons...) when that content does not use them itself.
  const keyset = document.getElementById("mailKeys") ?? document.querySelector("keyset");
  if (keyset) {
    // The key triggers a command (no code in an attribute) that closes the card.
    const command = document.createXULElement("command");
    command.id = "heron-glance-escape-command";
    command.addEventListener("command", () => {
      if (root.hasAttribute("heron-glance")) {
        closeGlance();
      }
    });
    (document.querySelector("commandset") ?? keyset).appendChild(command);
    const key = document.createXULElement("key");
    key.id = "heron-glance-escape";
    key.setAttribute("keycode", "VK_ESCAPE");
    key.setAttribute("command", command.id);
    keyset.appendChild(key);
    heronOnStop(() => {
      key.remove();
      command.remove();
    });
  }

  update();

  // On stop: the tab bar comes back, cards become tabs again.
  heronOnStop(() => {
    root.removeAttribute("heron-glance");
    for (const node of [style, backdrop, close, ...navButtons]) {
      node.remove();
    }
  });
})();
