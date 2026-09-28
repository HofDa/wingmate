#!/usr/bin/env python3
"""Serve the app over HTTPS on the local network so a smartphone can use the
camera (browsers only allow getUserMedia on secure origins).

  python3 scripts/serve-https.py [--port 8443]

Creates a self-signed certificate in .cert/ on first run (needs `openssl`)
covering localhost and this machine's LAN address. The phone will warn about
the certificate once; accept it for this address. Everything stays local.
"""
import argparse, functools, http.server, ipaddress, os, socket, ssl, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CERT_DIR = os.path.join(ROOT, ".cert")


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("192.0.2.1", 80))  # TEST-NET address; no packet is sent
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_cert(ip):
    cert, key = os.path.join(CERT_DIR, "cert.pem"), os.path.join(CERT_DIR, "key.pem")
    stamp = os.path.join(CERT_DIR, "ip.txt")
    if os.path.exists(cert) and os.path.exists(stamp) and open(stamp).read().strip() == ip:
        return cert, key
    os.makedirs(CERT_DIR, exist_ok=True)
    ipaddress.ip_address(ip)
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "825",
         "-keyout", key, "-out", cert, "-subj", "/CN=wingmate-local",
         "-addext", f"subjectAltName=DNS:localhost,IP:127.0.0.1,IP:{ip}"],
        check=True, capture_output=True)
    open(stamp, "w").write(ip)
    return cert, key


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8443)
    args = parser.parse_args()
    ip = lan_ip()
    try:
        cert, key = ensure_cert(ip)
    except (OSError, subprocess.CalledProcessError) as e:
        sys.exit(f"Zertifikat konnte nicht erzeugt werden (openssl installiert?): {e}")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(cert, key)
    class Handler(http.server.SimpleHTTPRequestHandler):
        extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                          ".webmanifest": "application/manifest+json", ".js": "text/javascript"}

    handler = functools.partial(Handler, directory=ROOT)
    server = http.server.ThreadingHTTPServer(("0.0.0.0", args.port), handler)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    print(f"Wingmate über HTTPS:\n  Smartphone (gleiches WLAN): https://{ip}:{args.port}\n  Dieser Rechner:            https://localhost:{args.port}")
    print("Zertifikatswarnung einmalig bestätigen. Beenden mit Strg+C.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
