// State of the most recent compose window: button order, Aa, formatting toolbar.
const w = Services.wm.getMostRecentWindow("msgcompose");
const d = w.document;
const bar = d.getElementById("composeToolbar2");
const toggle = d.getElementById("heron-format-toggle");
const fmt = d.getElementById("FormatToolbar");
return {
  order: [...bar.children].filter(e => w.getComputedStyle(e).display != "none").map(e => e.id || e.localName),
  aa: toggle ? { hidden: toggle.hidden, pressed: toggle.getAttribute("aria-pressed") } : null,
  formatToolbarVisible: !!fmt && w.getComputedStyle(fmt).display != "none" && !fmt.hidden,
  html: w.gMsgCompose?.composeHTML,
};
