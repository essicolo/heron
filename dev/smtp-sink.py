"""Fake SMTP server for tests: accepts everything, saves each received message.

Usage: python3 -I dev/smtp-sink.py [port] [folder]   (default: 2525, /tmp/heron-smtp)
Each received message is written to <folder>/<n>.eml. Listens on 127.0.0.1 only.
"""

import pathlib
import socket
import sys
import threading

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 2525
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "/tmp/heron-smtp")
OUT.mkdir(parents=True, exist_ok=True)
counter = len(list(OUT.glob("*.eml")))
lock = threading.Lock()


def handle(conn):
    global counter
    with conn, conn.makefile("rb") as rfile:
        send = lambda line: conn.sendall(line.encode() + b"\r\n")
        send("220 heron-test ESMTP")
        while True:
            line = rfile.readline()
            if not line:
                return
            command = line.decode(errors="replace").strip().upper()
            if command.startswith(("EHLO", "HELO")):
                send("250 heron-test")
            elif command.startswith(("MAIL", "RCPT", "RSET", "NOOP")):
                send("250 OK")
            elif command == "DATA":
                send("354 Go ahead")
                data = []
                while True:
                    chunk = rfile.readline()
                    if not chunk or chunk == b".\r\n":
                        break
                    data.append(chunk[1:] if chunk.startswith(b"..") else chunk)
                with lock:
                    counter += 1
                    (OUT / f"{counter}.eml").write_bytes(b"".join(data))
                send("250 Queued")
            elif command == "QUIT":
                send("221 Bye")
                return
            else:
                send("502 Not implemented")


server = socket.create_server(("127.0.0.1", PORT))
print(f"Fake SMTP on 127.0.0.1:{PORT}, saving to {OUT}", flush=True)
while True:
    connection, _ = server.accept()
    threading.Thread(target=handle, args=(connection,), daemon=True).start()
