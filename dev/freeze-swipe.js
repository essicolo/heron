// Freezes a card mid-swipe, with the same structure as start()/render() in swipe.js.
// Replace ROW (row index) and DX (offset in px, positive = card to the left).
const a = window.gTabmail.currentAbout3Pane;
const doc = a.document;
const row = [...doc.querySelectorAll("#threadTree tr.card-layout")][ROW];
const cell = row.querySelector("td");
const card = cell.querySelector(".card-container");
const left = (DX) > 0;
const band = doc.createElement("div");
band.className = "heron-band";
band.dataset.side = left ? "left" : "right";
band.style.background = left ? "#e5484d" : "#30a46c";
band.style.setProperty("--heron-icon", left ? "var(--icon-trash)" : "var(--icon-archive)");
band.style.opacity = "1";
band.toggleAttribute("data-armed", true);
const label = doc.createElement("span");
label.className = "heron-label";
const icon = doc.createElement("span");
icon.className = "heron-icon";
const text = doc.createElement("span");
text.textContent = left ? "Delete" : "Archive";
label.append(icon, text);
band.append(label);
cell.prepend(band);
cell.dataset.heronSwipe = "1";
card.style.transform = `translate3d(${-(DX)}px, 0, 0)`;
return { row: row.querySelector(".sender")?.textContent };
