"""Drives a headless Thunderbird through Marionette and captures the UI.

Usage:
  python3 -I dev/shoot.py screenshot OUTPUT.png [width height]
  python3 -I dev/shoot.py snapshot WINDOW_TYPE OUTPUT.png   (e.g. msgcompose)
  python3 -I dev/shoot.py key escape|enter|<character>
  python3 -I dev/shoot.py dblclick X Y
  python3 -I dev/shoot.py element CSS_SELECTOR OUTPUT.png
  python3 -I dev/shoot.py eval "JS code run in the main window"

The test Thunderbird must run with --marionette (see dev/preview.sh).
"""

import base64
import json
import socket
import sys
import time

PORT = 2829


class Marionette:
    def __init__(self, port=PORT, timeout=60):
        deadline = time.time() + timeout
        while True:
            try:
                self.sock = socket.create_connection(("127.0.0.1", port), timeout=240)
                break
            except OSError:
                if time.time() > deadline:
                    raise
                time.sleep(0.5)
        self.buf = b""
        self.msg_id = 0
        self._read() # greeting message

    def _read(self):
        while b":" not in self.buf:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("Marionette closed the connection")
            self.buf += chunk
        length, rest = self.buf.split(b":", 1)
        length = int(length)
        while len(rest) < length:
            rest += self.sock.recv(1 << 20)
        self.buf = rest[length:]
        return json.loads(rest[:length])

    def send(self, name, params=None):
        self.msg_id += 1
        data = json.dumps([0, self.msg_id, name, params or {}]).encode()
        self.sock.sendall(str(len(data)).encode() + b":" + data)
        while True:
            reply = self._read()
            if reply[0] == 1 and reply[1] == self.msg_id:
                if reply[2]:
                    raise RuntimeError(reply[2])
                return reply[3]


def connect():
    m = Marionette()
    m.send("WebDriver:NewSession", {"capabilities": {}})
    m.send("Marionette:SetContext", {"value": "chrome"})
    m.send("WebDriver:SetTimeouts", {"script": 180000})
    return m


def main():
    m = connect()
    cmd = sys.argv[1]
    if cmd == "screenshot":
        out = sys.argv[2]
        if len(sys.argv) > 4:
            m.send("WebDriver:SetWindowRect",
                   {"x": 0, "y": 0, "width": int(sys.argv[3]), "height": int(sys.argv[4])})
            time.sleep(1)
        png = m.send("WebDriver:TakeScreenshot", {"full": False})["value"]
        with open(out, "wb") as f:
            f.write(base64.b64decode(png))
        print(out)
    elif cmd == "snapshot":
        # Captures another window: snapshot WINDOW_TYPE OUTPUT.png (e.g. msgcompose)
        script = """return (async () => {
          const win = Services.wm.getMostRecentWindow(arguments[0]);
          if (!win) { return null; }
          const snap = await win.browsingContext.currentWindowGlobal.drawSnapshot(null, 1, "white");
          const canvas = document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
          canvas.width = snap.width; canvas.height = snap.height;
          canvas.getContext("2d").drawImage(snap, 0, 0);
          return canvas.toDataURL("image/png");
        })();"""
        res = m.send("WebDriver:ExecuteScript", {"script": script, "args": [sys.argv[2]]})["value"]
        if not res:
            raise SystemExit(f"No window of type {sys.argv[2]}")
        with open(sys.argv[3], "wb") as f:
            f.write(base64.b64decode(res.split(",", 1)[1]))
        print(sys.argv[3])
    elif cmd == "key":
        # Real keystroke (e.g. key escape). WebDriver codes: escape = \ue00c, enter = \ue007.
        value = {"escape": "\ue00c", "enter": "\ue007"}.get(sys.argv[2], sys.argv[2])
        m.send("WebDriver:PerformActions", {"actions": [{"type": "key", "id": "keyboard", "actions": [
            {"type": "keyDown", "value": value}, {"type": "keyUp", "value": value}]}]})
        m.send("WebDriver:ReleaseActions")
        print("ok")
    elif cmd == "dblclick":
        # Real mouse double-click at coordinates X Y of the main window.
        x, y = int(float(sys.argv[2])), int(float(sys.argv[3]))
        click = [{"type": "pointerDown", "button": 0}, {"type": "pointerUp", "button": 0}]
        m.send("WebDriver:PerformActions", {"actions": [{"type": "pointer", "id": "mouse",
            "parameters": {"pointerType": "mouse"},
            "actions": [{"type": "pointerMove", "x": x, "y": y, "origin": "viewport"}] + click + click}]})
        m.send("WebDriver:ReleaseActions")
        print("ok")
    elif cmd == "element":
        # Captures a single element of the main window: element CSS_SELECTOR OUTPUT.png
        el = m.send("WebDriver:FindElement", {"using": "css selector", "value": sys.argv[2]})["value"]
        png = m.send("WebDriver:TakeScreenshot", {"id": list(el.values())[0], "full": False})["value"]
        with open(sys.argv[3], "wb") as f:
            f.write(base64.b64decode(png))
        print(sys.argv[3])
    elif cmd == "eval":
        script = "return (async () => {" + sys.argv[2] + "})();"
        res = m.send("WebDriver:ExecuteScript", {"script": script, "args": []})
        print(json.dumps(res.get("value"), indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
