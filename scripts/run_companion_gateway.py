"""Standalone Oracle Companion Gateway Runner.

Runs the Oracle Companion TLS gateway as a persistent background daemon on Windows,
listening on both Local Wi-Fi / LAN and Tailscale interfaces.
Allows Android Companion to connect and remotely start/stop Oracle Central
even when Oracle backend and frontend are offline.
"""
import hashlib
import ipaddress
import logging
import os
from pathlib import Path
import ssl
import sys
import threading
import time

# Ensure backend directory is in sys.path
ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = ROOT / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.companion_gateway import Gateway, Handler, ThreadingHTTPServer, certificate
from app.companion_settings import detect_adapters, LAN_NETWORKS, TAILSCALE_NETWORK

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("CompanionDaemon")


class StandaloneGatewayManager:
    def __init__(self):
        self.root = ROOT
        self.state = Path(os.environ.get("LOCALAPPDATA", str(self.root / "data"))) / "OracleCompanion"
        self.state.mkdir(parents=True, exist_ok=True)
        self.gateway = Gateway(self.state, self.root)
        self.gateway.recover()
        self.servers = {}
        self.lock = threading.Lock()

    def get_remote_address(self):
        with self.lock:
            for s in self.servers.values():
                if getattr(s, "transport", "") == "tailscale":
                    return s.server_address[0]
        return ""

    def start_listener(self, address: str, remote: bool = False):
        with self.lock:
            if address in self.servers:
                return
            cert, key = certificate(self.state)
            pin = hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(cert, key)

            server = ThreadingHTTPServer((address, 8443), Handler)
            server.socket = context.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
            server.gateway = self.gateway
            server.pin = pin
            server.remote_address = self.get_remote_address
            server.transport = "tailscale" if remote else "lan"

            t = threading.Thread(target=server.serve_forever, daemon=True)
            t.start()
            self.servers[address] = server
            transport_type = "Tailscale" if remote else "Local LAN"
            logger.info("Oracle Companion Gateway listening on %s (https://%s:8443) [%s]", address, address, transport_type)

    def refresh_listeners(self):
        lan_adapters = detect_adapters(tailscale=False) or []
        ts_adapters = detect_adapters(tailscale=True) or []

        addresses_to_save = []
        if lan_adapters:
            preferred = next((a for a in lan_adapters if a.get("wifi")), lan_adapters[0])
            addr = preferred["address"]
            self.start_listener(addr, remote=False)
            addresses_to_save.append(addr)

        if ts_adapters:
            ts_addr = ts_adapters[0]["address"]
            self.start_listener(ts_addr, remote=True)
            addresses_to_save.append(ts_addr)

        if addresses_to_save:
            (self.state / "listener-address").write_text("\n".join(addresses_to_save), encoding="ascii")

    def run(self):
        logger.info("Starting Standalone Companion Gateway Daemon (State: %s)", self.state)
        self.refresh_listeners()
        try:
            while True:
                time.sleep(10)
                self.refresh_listeners()
        except KeyboardInterrupt:
            logger.info("Stopping Companion Gateway Daemon...")
            with self.lock:
                for s in self.servers.values():
                    s.shutdown()
                    s.server_close()


if __name__ == "__main__":
    manager = StandaloneGatewayManager()
    manager.run()
