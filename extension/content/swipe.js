/* heron: swiping messages in the list (about:3pane).
 *
 * Run by api/implementation.js in a sandbox whose prototype is the about:3pane window: `window`, `document` and Thunderbird's globals (gDBView, commandController...) are available. `heronConfig` is provided and replaced by the extension on every settings change: { left, right, undoSeconds, invert, enabled }.
 *
 * Gesture: two-finger horizontal swipe on a message (`wheel` events).
 * A card moving left triggers the "left" action, moving right the "right" action.
 *
 * Smoothness: during the gesture, only `transform` (card) and `opacity` (band) change, once per frame (requestAnimationFrame): no layout recalculation. Actions apply directly to the message without selecting it: nothing loads in the message pane.
 */
(() => {
  if (document.documentElement.dataset.heronSwipe) {
    return;
  }
  document.documentElement.dataset.heronSwipe = "1";

  const { MessageArchiver } = ChromeUtils.importESModule("resource:///modules/MessageArchiver.sys.mjs");

  const top = window.top;

  const t = (key, ...args) =>
    args.reduce((s, v, i) => s.replaceAll(`{${i + 1}}`, v), heronStrings?.[key] || key);

  /** Actions: `run(hdr)` acts on the message; `undo(hdr)` reverts it ("native" = Thunderbird's undo). */
  const ACTIONS = {
    delete: {
      icon: "var(--icon-trash)", label: t("swipeDelete"), done: t("swipeDoneDelete"), color: "#e5484d",
      can: hdr => !(hdr.folder.flags & Ci.nsMsgFolderFlags.Virtual),
      run: hdr => hdr.folder.deleteMessages([hdr], top.msgWindow, false, false, null, true),
      undo: "native",
    },
    archive: {
      icon: "var(--icon-archive)", label: t("swipeArchive"), done: t("swipeDoneArchive"), color: "#30a46c",
      can: hdr => MessageArchiver.canArchive([hdr], true),
      run: hdr => {
        const archiver = new MessageArchiver();
        archiver.msgWindow = top.msgWindow;
        archiver.archiveMessages([hdr]);
      },
      undo: "native",
    },
    toggleRead: {
      icon: "var(--icon-mail-sm, var(--icon-dot))", label: t("swipeToggleRead"), done: t("swipeDoneToggleRead"), color: "#0090ff",
      can: () => true,
      run: hdr => hdr.folder.markMessagesRead([hdr], !hdr.isRead),
      undo: hdr => hdr.folder.markMessagesRead([hdr], !hdr.isRead),
    },
    flag: {
      icon: "var(--icon-star)", label: t("swipeFlag"), done: t("swipeDoneFlag"), color: "#f76b15",
      can: () => true,
      run: hdr => hdr.folder.markMessagesFlagged([hdr], !hdr.isFlagged),
      undo: hdr => hdr.folder.markMessagesFlagged([hdr], !hdr.isFlagged),
    },
    junk: {
      // Thunderbird has no equivalent without selection: use its command.
      icon: "var(--icon-spam)", label: t("swipeJunk"), done: t("swipeDoneJunk"), color: "#8e4ec6",
      can: () => true,
      run: hdr => runCommandOn(hdr, "cmd_markAsJunk"),
      undo: hdr => runCommandOn(hdr, "cmd_markAsNotJunk"),
    },
  };

  const ROW = "tr.card-layout";
  const SETTLE_MS = 90; // silence that marks the end of the gesture
  const COOLDOWN_MS = 350; // ignore the tail of touchpad inertia after a gesture
  // Gesture physics
  const ELASTIC = 0.45; // past the threshold, the card follows the fingers but damped
  const FLICK_SPEED = 1.1; // px/ms: a quick flick triggers the action even below the threshold...
  const FLICK_MIN = 45; // ... if it traveled at least this distance
  const REVERSE_SPEED = 0.35; // px/ms: moving back before release cancels...
  const REVERSE_MIN = 40; // ... as does moving back this distance from the farthest point
  const BACK_MS = 320; // elastic return
  const VELOCITY_WINDOW = 120; // ms: window for computing velocity
  // Native swipe tracking (Gecko's MozSwipeGesture* events): the system says when the fingers leave the touchpad, so the card can hold still during a pause.
  const SWIPE_PIXELS = parseFloat(Services.prefs.getStringPref("widget.swipe.pixel-size", "550")) || 550; // fingers' travel for a delta of 1
  const NATIVE_COOLDOWN_MS = 1000; // ignore the inertia that follows a tracked gesture
  const NATIVE_START_MS = 400; // after accepting, wait this long for the system to start tracking
  const NATIVE_STALL_MS = 6000; // safety: release a tracked gesture after this long without news from the system
  const DIRECTION_LEFT = 4; // SimpleGestureEvent.DIRECTION_LEFT
  const DIRECTION_RIGHT = 8; // SimpleGestureEvent.DIRECTION_RIGHT
  // Native tracking (on by default; heron.swipe.native = false turns it off): the card follows the fingers and holds still during a pause.
  const nativeOn = () => Services.prefs.getBoolPref("heron.swipe.native", true);
  const debug = (...args) => Services.prefs.getBoolPref("heron.swipe.debug", false) && Services.console.logStringMessage(`heron swipe: ${args.join(" ")}`);

  const config = () => ({ left: "delete", right: "archive", undoSeconds: 6, invert: false, enabled: true, ...heronConfig });
  const tree = () => document.getElementById("threadTree");

  const style = document.createElement("style");
  style.textContent = `
    /* Everything goes in the card's CELL, never on the table row (a ::before on a <tr> becomes an extra cell and turns the whole table into two columns). */
    ${ROW} > td[data-heron-swipe] { position: relative; overflow: clip; }
    .heron-band {
      position: absolute; inset: 2px 6px; z-index: 0; display: flex; align-items: center;
      box-sizing: border-box; padding-inline: 24px; border-radius: 10px;
      color: #fff; font-weight: 600; opacity: 0.35; will-change: opacity;
    }
    .heron-band[data-side="left"] { justify-content: flex-end; }
    .heron-band[data-side="right"] { justify-content: flex-start; }
    .heron-band .heron-label { display: flex; align-items: center; gap: 8px; transition: transform 140ms cubic-bezier(.3,1.6,.5,1); }
    .heron-band .heron-icon {
      width: 18px; height: 18px; background: var(--heron-icon) center / 18px no-repeat;
      -moz-context-properties: fill, stroke; fill: #fff; stroke: #fff;
    }
    .heron-band[data-armed] .heron-label { transform: scale(1.15); }
    ${ROW} > td[data-heron-swipe] > .card-container {
      position: relative; z-index: 1; will-change: transform;
      background-color: var(--layout-background-0, Canvas) !important;
    }
    #heron-toast {
      position: fixed; z-index: 100; bottom: 18px; transform: translateX(-50%);
      display: flex; align-items: center; gap: 14px; padding: 9px 10px 9px 16px;
      border-radius: 12px; background: #2b2b2e; color: #fff; font: 13px system-ui, sans-serif;
      box-shadow: 0 6px 24px rgba(0,0,0,.28);
    }
    #heron-toast button {
      all: unset; cursor: pointer; padding: 4px 12px; border-radius: 8px; font-weight: 600;
      background: rgba(255,255,255,.16);
    }
    #heron-toast button:hover { background: rgba(255,255,255,.28); }
  `;
  document.head.appendChild(style);

  // --- Undo toast ---------------------------------------------------------------

  let toast = null;
  let toastTimer = null;

  function hideToast() {
    clearTimeout(toastTimer);
    toast?.remove();
    toast = null;
  }

  /** Shows `text`. With `onUndo`, offers "Undo"; without, it is a plain notice. */
  function showToast(text, onUndo) {
    hideToast();
    toast = document.createElement("div");
    toast.id = "heron-toast";
    toast.setAttribute("role", "status");
    const span = document.createElement("span");
    span.textContent = text;
    toast.append(span);
    if (onUndo) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = t("swipeUndo");
      button.addEventListener("click", () => {
        hideToast();
        onUndo();
      });
      toast.append(button);
    }
    document.body.appendChild(toast);
    const rect = tree().getBoundingClientRect();
    toast.style.left = `${rect.left + rect.width / 2}px`;
    toastTimer = setTimeout(hideToast, Math.max(2, config().undoSeconds) * 1000);
  }

  // --- Actions ----------------------------------------------------------------------------

  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

  function undoNative() {
    if (top.messenger?.undo) {
      top.messenger.undo(top.msgWindow);
    } else {
      top.goDoCommand?.("cmd_undo");
    }
  }

  /** For the rare actions without a direct equivalent: selects the message, then runs the command. */
  function runCommandOn(hdr, command) {
    const index = gDBView.findIndexOfMsgHdr(hdr, true);
    if (index == nsMsgViewIndex_None) {
      return;
    }
    tree().selectedIndex = index;
    commandController.doCommand(command);
  }

  /** Runs action `key` on message `hdr` and offers to undo. */
  function perform(hdr, key) {
    const action = ACTIONS[key];
    if (!action || !hdr) {
      return;
    }
    if (!action.can(hdr)) {
      showToast(t("swipeImpossible"));
      return;
    }
    try {
      action.run(hdr);
    } catch (e) {
      console.error("heron: swipe", e);
      showToast(t("swipeImpossible"));
      return;
    }
    showToast(action.done, () => (action.undo == "native" ? undoNative() : action.undo(hdr)));
  }

  // --- Gesture ------------------------------------------------------------------------------

  /**
   * Current gesture: { cell, card, band, label, text, hdr, dx, width, side, key, armed, frame, timer, peak, quiet, samples, velocity, maxSpeed, farthest }
   * dx: distance traveled by the fingers; the card itself is damped past the threshold.
   */
  let gesture = null;
  let cooldownUntil = 0;

  const threshold = g => Math.min(150, g.width * 0.3);

  /** Displayed card position: 1:1 up to the threshold, then elastic resistance. */
  function visualOffset(g) {
    const t = threshold(g);
    const d = Math.abs(g.dx);
    const shown = d <= t ? d : t + (d - t) * ELASTIC;
    return Math.sign(g.dx) * Math.min(shown, g.width * 0.9);
  }

  /** Setup, once at the start of the gesture. */
  function start(row) {
    const cell = row.querySelector("td");
    const card = cell?.querySelector(".card-container");
    const hdr = gDBView.getMsgHdrAt(row.index);
    if (!card || !hdr) {
      return null;
    }
    const band = document.createElement("div");
    band.className = "heron-band";
    const label = document.createElement("span");
    label.className = "heron-label";
    const icon = document.createElement("span");
    icon.className = "heron-icon";
    const text = document.createElement("span");
    label.append(icon, text);
    band.append(label);
    cell.prepend(band);
    cell.dataset.heronSwipe = "1";
    card.style.transition = "none";
    return {
      cell, card, band, label, text, hdr,
      dx: 0, width: cell.getBoundingClientRect().width, side: null,
      peak: 0, quiet: 0, samples: [], velocity: 0, maxSpeed: 0, farthest: 0,
    };
  }

  /** Finger velocity (px/ms, signed) over the last VELOCITY_WINDOW ms. */
  function track(g, now) {
    g.samples.push({ t: now, dx: g.dx });
    while (g.samples.length > 2 && now - g.samples[0].t > VELOCITY_WINDOW) {
      g.samples.shift();
    }
    const first = g.samples[0];
    const span = now - first.t;
    if (span > 8) {
      g.velocity = (g.dx - first.dx) / span;
      // Maximum speed in the gesture's direction (a quick flick counts, even if short).
      g.maxSpeed = Math.max(g.maxSpeed, g.velocity * Math.sign(g.dx || 1));
    }
  }

  /** One frame: only transform (card) and opacity (band). */
  function render(g) {
    g.frame = 0;
    const side = g.dx > 0 ? "left" : "right"; // direction the card moves
    if (side != g.side) {
      g.side = side;
      g.key = config()[side];
      const action = ACTIONS[g.key];
      g.band.dataset.side = side;
      g.band.style.background = action?.color ?? "transparent";
      g.band.style.setProperty("--heron-icon", action?.icon ?? "none");
      g.text.textContent = action?.label ?? "";
    }
    const armed = Boolean(ACTIONS[g.key]) && Math.abs(g.dx) >= threshold(g);
    if (armed != g.armed) {
      g.armed = armed;
      g.band.toggleAttribute("data-armed", armed);
    }
    const offset = visualOffset(g);
    g.card.style.transform = `translate3d(${-offset}px, 0, 0)`;
    g.band.style.opacity = String(0.35 + Math.min(1, Math.abs(g.dx) / threshold(g)) * 0.65);
  }

  function cleanup(g) {
    g.band.remove();
    g.card.style.removeProperty("transform");
    g.card.style.removeProperty("transition");
    delete g.cell.dataset.heronSwipe;
  }

  async function finish(g) {
    if (gesture != g) {
      return;
    }
    gesture = null;
    clearTimeout(g.timer);
    clearTimeout(g.nativeTimer);
    if (g.frame) {
      cancelAnimationFrame(g.frame);
      render(g);
    }
    // After a tracked gesture, the touchpad's inertia keeps sending wheel events for a moment: ignore them longer.
    cooldownUntil = Date.now() + (g.native == "active" ? NATIVE_COOLDOWN_MS : COOLDOWN_MS);

    const direction = Math.sign(g.dx);
    // Moving back before release cancels, even past the threshold (as on iOS).
    // (Touchpad inertia never moves backward: no false cancellation.)
    const reversing = g.velocity * direction < -REVERSE_SPEED || g.farthest - Math.abs(g.dx) >= REVERSE_MIN;
    // A quick, long enough flick triggers the action, even below the threshold.
    const flick = g.maxSpeed > FLICK_SPEED && Math.abs(g.dx) > FLICK_MIN;
    // With native tracking, the system decided on release (distance and speed): MozSwipeGesture came, or not.
    // Same rule in both modes: armed (or flicked) and not moving back. With native tracking, the system's own success (a quick swipe) counts too: its threshold is further than heron's.
    const commit = Boolean(ACTIONS[g.key]) && ((g.native == "active" && g.nativeSuccess) || (!reversing && (g.armed || flick)));
    debug("finish", g.native == "active" ? "native" : "wheel", "dx", Math.round(g.dx), "speed", g.maxSpeed.toFixed(2), "armed", Boolean(g.armed), "flick", flick, "reversing", reversing, "commit", commit);

    if (commit) {
      // The card leaves at the gesture's speed (fast: quickly; slow: gently), then the action runs.
      g.band.style.opacity = "1";
      g.band.toggleAttribute("data-armed", true);
      const remaining = g.width - Math.abs(visualOffset(g));
      const speed = Math.max(g.maxSpeed, 1.2);
      const duration = Math.round(Math.min(260, Math.max(120, remaining / speed)));
      g.card.style.transition = `transform ${duration}ms cubic-bezier(.2,.7,.3,1)`;
      g.card.style.transform = `translate3d(${g.side == "left" ? -g.width : g.width}px, 0, 0)`;
      await pause(duration);
      cleanup(g);
      perform(g.hdr, g.key);
    } else {
      // Not far enough (or moved back): the card returns with a slight bounce.
      g.card.style.transition = `transform ${BACK_MS}ms cubic-bezier(.34,1.35,.64,1)`;
      g.card.style.transform = "translate3d(0, 0, 0)";
      g.band.style.transition = `opacity ${BACK_MS}ms`;
      g.band.style.opacity = "0";
      await pause(BACK_MS);
      cleanup(g);
    }
  }

  heronListen(
    document,
    "wheel",
    event => {
      if (!config().enabled || event.deltaMode != 0 || Date.now() < cooldownUntil) {
        return;
      }
      let first = false;
      if (!gesture) {
        const row = event.target.closest?.(ROW);
        // A gesture starts only if clearly horizontal: vertical scrolling stays intact.
        if (!row || Math.abs(event.deltaX) < Math.abs(event.deltaY) * 1.5 || Math.abs(event.deltaX) < 2) {
          return;
        }
        gesture = start(row);
        if (!gesture) {
          return;
        }
        first = true;
        debug("start (wheel)", event.deltaX);
      }
      const g = gesture;
      if (g.native == "active") {
        // The system tracks the gesture: its MozSwipeGestureUpdate events move the card.
        event.preventDefault();
        return;
      }
      // With native tracking on, wheel events are never cancelled before the system has started tracking: the system gives up on a gesture whose wheel events were cancelled (MozSwipeGestureMayStart below).
      if (!nativeOn()) {
        event.preventDefault();
      }
      debug("wheel", event.deltaX.toFixed(2), event.deltaY.toFixed(2), first ? "(first)" : "");
      event.stopPropagation();
      try {
        const delta = (config().invert ? -1 : 1) * event.deltaX;
        g.dx = Math.max(-g.width * 1.5, Math.min(g.width * 1.5, g.dx + delta));
        track(g, performance.now());
        g.farthest = Math.max(g.farthest, Math.abs(g.dx));

        // Early finish: after the peak, touchpad inertia decays; once negligible, the fingers have been lifted for a while: conclude without waiting for the end.
        const magnitude = Math.abs(event.deltaX);
        g.peak = Math.max(g.peak, magnitude);
        g.quiet = g.peak > 6 && magnitude < 1.5 ? g.quiet + 1 : 0;
        if (g.quiet >= 2) {
          finish(g);
          return;
        }

        if (!g.frame) {
          g.frame = requestAnimationFrame(() => render(g));
        }
        clearTimeout(g.timer);
        g.timer = setTimeout(() => finish(g), SETTLE_MS);
      } catch (e) {
        // Never leave a card stuck halfway: reset everything.
        console.error("heron: swipe", e);
        gesture = null;
        cleanup(g);
      }
    },
    { passive: false, capture: true }
  );

  // --- Native swipe tracking ---------------------------------------------------------------
  // On macOS (with "Swipe between pages" on) and wherever Gecko tracks swipes, the system takes over after the first wheel event and reports the finger travel until the fingers are lifted.

  /** The system offers to track the gesture: accept it if a card is being swiped. */
  function onMayStart(event) {
    debug("may start offered by the system, native tracking", nativeOn() ? "on" : "off", "target", event.target?.localName);
    if (!nativeOn() || !config().enabled || Date.now() < cooldownUntil) {
      return;
    }
    // On a real touchpad the first wheel events are tiny, so the system usually offers to track the gesture before heron has started one: start it here, on the row under the fingers.
    if (!gesture) {
      const row = event.target?.closest?.(ROW);
      if (!row || row.ownerDocument != document) {
        debug("may start, not over a message");
        return;
      }
      gesture = start(row);
      if (!gesture) {
        return;
      }
    }
    const g = gesture;
    if (g.native) {
      return;
    }
    event.preventDefault();
    event.allowedDirections = DIRECTION_LEFT | DIRECTION_RIGHT;
    // Accepted, but the system starts tracking only later (MozSwipeGestureStart), and may still give up: until then, wheel events keep moving the card, and without a start the gesture stays a wheel gesture.
    g.native = "pending";
    g.nativeTimer = setTimeout(() => {
      if (gesture == g && g.native == "pending") {
        g.native = null;
        debug("no start from the system, wheel gesture");
        clearTimeout(g.timer);
        g.timer = setTimeout(() => finish(g), SETTLE_MS);
      }
    }, NATIVE_START_MS);
    debug("may start accepted, dx", Math.round(g.dx));
  }

  function onNativeStart(event) {
    const g = gesture;
    if (g?.native != "pending") {
      return;
    }
    event.preventDefault();
    event.allowedDirections = DIRECTION_LEFT | DIRECTION_RIGHT;
    g.native = "active";
    g.nativeBase = g.dx;
    g.nativeSign = 0;
    clearTimeout(g.nativeTimer);
    clearTimeout(g.timer);
    g.timer = setTimeout(() => finish(g), NATIVE_STALL_MS);
    debug("start (system), dx", Math.round(g.dx));
  }

  function onUpdate(event) {
    const g = gesture;
    if (g?.native != "active") {
      return;
    }
    event.preventDefault();
    // Safety: if the system never says the gesture ended, release it after a long silence.
    clearTimeout(g.timer);
    g.timer = setTimeout(() => finish(g), NATIVE_STALL_MS);
    const travel = event.delta * SWIPE_PIXELS;
    // Gecko's convention: a positive delta is the fingers moving right (as when swiping back between pages), which moves the card right (negative dx here). If wheel events already moved the card, the sign is calibrated on them instead.
    if (!g.nativeSign && travel) {
      g.nativeSign = g.nativeBase ? (Math.sign(travel) == Math.sign(g.nativeBase) ? 1 : -1) : -1;
    }
    g.dx = Math.max(-g.width * 1.5, Math.min(g.width * 1.5, g.nativeBase + (g.nativeSign || 1) * travel));
    track(g, performance.now());
    g.farthest = Math.max(g.farthest, Math.abs(g.dx));
    if (!g.frame) {
      g.frame = requestAnimationFrame(() => render(g));
    }
    debug("update", event.delta.toFixed(3), "dx", Math.round(g.dx));
  }

  function onSwipe(event) {
    if (gesture?.native == "active") {
      event.preventDefault();
      gesture.nativeSuccess = true;
      debug("success, direction", event.direction);
    }
  }

  function onEnd(event) {
    const g = gesture;
    if (g?.native == "active") {
      event.preventDefault();
      debug("end, success", Boolean(g.nativeSuccess), "dx", Math.round(g.dx));
      finish(g);
    }
  }

  // The events cross both the main window and this document: listen on both, handle each event once.
  const once = handler => event => {
    if (!event.heronSeen) {
      event.heronSeen = true;
      handler(event);
    }
  };
  for (const target of new Set([window.top, window])) {
    heronListen(target, "MozSwipeGestureMayStart", once(onMayStart), true);
    heronListen(target, "MozSwipeGestureStart", once(onNativeStart), true);
    heronListen(target, "MozSwipeGestureUpdate", once(onUpdate), true);
    heronListen(target, "MozSwipeGesture", once(onSwipe), true);
    heronListen(target, "MozSwipeGestureEnd", once(onEnd), true);
  }

  // On stop: reset any gesture in progress and remove the notice. (An action already done can still be undone with Thunderbird's Edit > Undo.)
  heronOnStop(() => {
    if (gesture) {
      clearTimeout(gesture.timer);
      cancelAnimationFrame(gesture.frame);
      cleanup(gesture);
      gesture = null;
    }
    hideToast();
    style.remove();
    delete document.documentElement.dataset.heronSwipe;
  });
})();
