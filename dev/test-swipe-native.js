// Native swipe tracking (MozSwipeGesture* events, as sent by the system on macOS): the card holds during a pause, and the release decides.
const a = window.gTabmail.currentAbout3Pane;
Services.prefs.setBoolPref("heron.swipe.native", true); // on by default, set explicitly in case an earlier test turned it off
const wu = a.windowUtils, topWu = window.windowUtils;
const wait = ms => new Promise(r => setTimeout(r, ms));
const offset = a.frameElement?.getBoundingClientRect() ?? gTabmail.currentTabInfo.chromeBrowser.getBoundingClientRect();
a.threadTree.scrollToIndex(0);
await wait(300);
const count = () => a.gDBView.rowCount;
const row = a.threadTree.getRowAtIndex(3);
const r = row.getBoundingClientRect();
const [x, y] = [r.left + r.width / 2, r.top + r.height / 2];
const shown = () => Math.round(Math.abs(parseFloat(/translate3d\((-?[\d.]+)px/.exec(row.querySelector(".card-container").style.transform)?.[1] ?? "0")));
const gesture = (type, delta = 0, direction = 0) => topWu.sendSimpleGestureEvent(type, offset.left + x, offset.top + y, direction, delta, 0, 0);
const frame = () => new Promise(res => a.requestAnimationFrame(res));

async function swipe(steps, success, { wheelFirst = true } = {}) {
  const before = count();
  if (wheelFirst) {
    wu.sendWheelEvent(x, y, 4, 0, 0, 0, 0, 0, 0, 0);
    await frame();
  }
  const accepted = !gesture("MozSwipeGestureMayStart", 0, 0);
  if (steps === "giveUp") {
    // The system accepted but never starts tracking: wheel events keep coming, and the gesture must end normally.
    for (let i = 0; i < 40; i++) {
      wu.sendWheelEvent(x, y, 5, 0, 0, 0, 0, 0, 0, 0);
      await frame();
    }
    await wait(1500);
    const acted = count() < before;
    if (acted) {
      a.document.querySelector("#heron-toast button")?.click();
      await wait(1500);
    }
    await wait(500);
    return { accepted, acted, stuck: Boolean(row.querySelector(".heron-band")) };
  }
  gesture("MozSwipeGestureStart");
  const out = { accepted };
  for (const [delta, pause] of steps) {
    gesture("MozSwipeGestureUpdate", delta);
    await frame();
    if (pause) {
      const at = shown();
      await wait(pause);
      out.heldDuringPause = { before: at, after: shown() };
    }
  }
  out.beforeRelease = shown();
  if (success) {
    gesture("MozSwipeGesture", 0, 4);
  }
  gesture("MozSwipeGestureEnd");
  await wait(900);
  out.acted = count() < before;
  out.afterRelease = shown();
  if (out.acted) {
    a.document.querySelector("#heron-toast button")?.click();
    await wait(1500);
  }
  await wait(500);
  return out;
}

return {
  pauseThenSuccess: await swipe([[-0.05], [-0.1], [-0.15, 1000], [-0.25], [-0.35]], true),
  pauseThenCancel: await swipe([[-0.05], [-0.1, 1000], [-0.05], [0]], false),
  // As on a real touchpad: the system offers to track the gesture before any wheel event reached heron.
  systemFirst: await swipe([[-0.05], [-0.15, 1000], [-0.3]], true, { wheelFirst: false }),
  systemGivesUp: await swipe("giveUp", false),
  // Released armed (past heron's threshold) without the system's own success: heron acts anyway.
  armedWithoutSystemSuccess: await swipe([[-0.1], [-0.2], [-0.3]], false),
};
