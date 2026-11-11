"""Serve the local prototype and send tender notices through configured SMTP."""
import json
import os
import smtplib
import ssl
import sqlite3
from pathlib import Path
from email.message import EmailMessage
from email.utils import parseaddr
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


QUEUE = Path(__file__).resolve().parent.parent / "winglobal-approved-offers.sqlite3"


class PortalHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def do_GET(self):
        if self.path == "/submission-status":
            with sqlite3.connect(QUEUE) as db:
                statuses = dict(db.execute("SELECT key, status FROM submission_status"))
            data = json.dumps(statuses).encode()
            self.send_response(200)
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(data)
            return
        if self.path != "/approved-offers":
            return super().do_GET()
        if self.headers.get("Origin") != "http://127.0.0.1:8000":
            self.send_error(403)
            return
        with sqlite3.connect(QUEUE) as db:
            rows = db.execute("SELECT payload FROM offers").fetchall()
        data = ("[" + ",".join(row[0] for row in rows) + "]").encode()
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "http://127.0.0.1:8000")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def store_offer(self):
        if self.headers.get("Origin") != "http://127.0.0.1:8091":
            self.send_error(403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 64000:
                raise ValueError
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or any(
                not isinstance(payload.get(key), str) or not payload[key].strip()
                for key in ("key", "itemName", "tenderName")
            ):
                raise ValueError
            with sqlite3.connect(QUEUE) as db:
                db.execute("INSERT OR IGNORE INTO offers VALUES (?, ?)",
                           (payload["key"], json.dumps(payload)))
        except (ValueError, TypeError):
            self.reply("Invalid approved offer.", 400)
            return
        except sqlite3.Error:
            self.reply("Could not save approved offer.", 503)
            return
        self.reply("Approved offer queued.", 200)

    def store_submission_status(self):
        origin = "http://127.0.0.1:8000"
        if self.headers.get("Origin") != origin:
            self.send_error(403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 64000:
                raise ValueError
            updates = json.loads(self.rfile.read(length))
            if not isinstance(updates, dict) or any(
                not isinstance(status, str) or len(status) > 250
                for status in updates.values()
            ):
                raise ValueError
            with sqlite3.connect(QUEUE) as db:
                db.executemany(
                    "INSERT OR REPLACE INTO submission_status SELECT key, ? FROM offers WHERE key = ?",
                    [(status, key) for key, status in updates.items()],
                )
        except (ValueError, TypeError):
            self.send_error(400)
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", origin)
        self.end_headers()

    def do_POST(self):
        if self.path == "/submission-status":
            return self.store_submission_status()
        if self.path == "/approved-offers":
            return self.store_offer()
        if self.path != "/tender-email":
            self.send_error(404)
            return
        if self.headers.get("Origin") != "http://127.0.0.1:8091":
            self.send_error(403)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 64000:
                raise ValueError
            payload = json.loads(self.rfile.read(length))
            recipients = list(dict.fromkeys(payload["recipients"]))
            subject = " ".join(payload["subject"].splitlines())
            body = payload["body"]
            if not isinstance(body, str) or not recipients or any(
                not isinstance(address, str) or parseaddr(address)[1] != address
                or "@" not in address or any(char.isspace() for char in address)
                for address in recipients
            ):
                raise ValueError
        except (ValueError, TypeError, KeyError, AttributeError):
            self.reply("Inbox notices saved. The email request contained invalid details.", 400)
            return
        host = os.getenv("WINERY_SMTP_HOST")
        sender = os.getenv("WINERY_SMTP_FROM")
        if not host or not sender:
            self.reply("Inbox notices saved. Configure SMTP to send email.", 503)
            return
        sent = 0
        for address in recipients:
            try:
                message = EmailMessage()
                message["From"] = sender
                message["To"] = address
                message["Subject"] = subject
                message.set_content(body)
                with smtplib.SMTP(host, int(os.getenv("WINERY_SMTP_PORT", "587")), timeout=10) as smtp:
                    smtp.starttls(context=ssl.create_default_context())
                    if os.getenv("WINERY_SMTP_USER"):
                        smtp.login(os.environ["WINERY_SMTP_USER"], os.environ["WINERY_SMTP_PASSWORD"])
                    smtp.send_message(message)
                sent += 1
            except (OSError, ValueError, KeyError, smtplib.SMTPException):
                continue
        self.reply(f"Inbox notices saved. Email accepted for {sent} of {len(recipients)} recipient(s).",
                   200 if sent == len(recipients) else 502)

    def reply(self, message, status):
        data = json.dumps({"message": message}).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    with sqlite3.connect(QUEUE) as db:
        db.execute("CREATE TABLE IF NOT EXISTS offers (key TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        db.execute("CREATE TABLE IF NOT EXISTS submission_status (key TEXT PRIMARY KEY, status TEXT NOT NULL)")
    ThreadingHTTPServer(("127.0.0.1", 8091), PortalHandler).serve_forever()
