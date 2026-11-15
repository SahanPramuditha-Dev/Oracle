"""Authenticated Oracle Central controls for the Android Companion gateway."""
import base64
import hashlib
import ipaddress
import json
import logging
import os
import ssl
import subprocess
import threading
from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .companion_gateway import Gateway, Handler, ThreadingHTTPServer, TTL, certificate, digest
from .geo import TripShareRequest


LAN_NETWORKS = tuple(ipaddress.ip_network(net) for net in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"))
TAILSCALE_NETWORK = ipaddress.ip_network("100.64.0.0/10")
WINDOWS_ADAPTERS = """
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$ErrorActionPreference = 'Stop'
$adapters = @(foreach ($adapter in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    if ($adapter.OperationalStatus -ne 'Up') { continue }
    $properties = $adapter.GetIPProperties()
    foreach ($ip in $properties.UnicastAddresses) {
        if ($ip.Address.AddressFamily -ne 'InterNetwork') { continue }
        [pscustomobject]@{
            name = $adapter.Name
            address = $ip.Address.ToString()
            wifi = ($adapter.NetworkInterfaceType -eq 'Wireless80211')
            gateway = [bool]($properties.GatewayAddresses | Where-Object {
                $_.Address.AddressFamily -eq 'InterNetwork' -and $_.Address.ToString() -ne '0.0.0.0'
            })
        }
    }
})
ConvertTo-Json -InputObject $adapters -Compress
"""


def detect_adapters(*, tailscale=False):
    if os.name != "nt":
        return None
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", WINDOWS_ADAPTERS],
            capture_output=True, encoding="utf-8", timeout=5, check=True,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        adapters = [
            adapter for adapter in json.loads(result.stdout)
            if (
                (adapter["name"].casefold() == "tailscale"
                 and ipaddress.IPv4Address(adapter["address"]) in TAILSCALE_NETWORK)
                if tailscale else
                any(ipaddress.IPv4Address(adapter["address"]) in net for net in LAN_NETWORKS)
            )
        ]
    except (OSError, subprocess.SubprocessError, ValueError):
        return None
    return sorted(adapters, key=lambda adapter: (not adapter["wifi"], not adapter["gateway"], adapter["name"], adapter["address"]))


class PairingRequest(BaseModel):
    address: ipaddress.IPv4Address | None = None
    remote_address: ipaddress.IPv4Address | None = None


class RemoteSettingsRequest(BaseModel):
    automatic: bool


class CompanionTripRequest(TripShareRequest):
    destination_name: str = Field(min_length=1, max_length=200)


class CompanionSettings:
    def __init__(self):
        self.lock = threading.Lock()
        self.server = None
        self.remote_server = None
        self.gateway = None
        self.root = Path(__file__).resolve().parents[2]
        self.state = Path(os.environ.get("LOCALAPPDATA", str(self.root / "data"))) / "OracleCompanion"

        self.auto_tailscale = False
        self.stop_monitor = threading.Event()
        self.monitor = None

    def restore(self):
        self.auto_tailscale = (self.state / "tailscale-auto").is_file()
        try:
            self.restore_listeners()
        finally:
            self.stop_monitor.clear()
            self.monitor = threading.Thread(target=self.watch_tailscale, daemon=True)
            self.monitor.start()

    def restore_listeners(self):
        try:
            addresses = (self.state / "listener-address").read_text().splitlines()
        except FileNotFoundError:
            return
        with self.lock:
            for index, value in enumerate(addresses[:2]):
                if index == 1 and self.auto_tailscale:
                    continue
                try:
                    address = ipaddress.IPv4Address(value)
                    networks = (TAILSCALE_NETWORK,) if index == 1 else LAN_NETWORKS
                    if any(address in net for net in networks):
                        self.start_listener(str(address), remote=index == 1)
                except (OSError, ValueError, ImportError):
                    logging.getLogger(__name__).warning("Companion listener could not be restored.", exc_info=True)

    def watch_tailscale(self):
        while not self.stop_monitor.is_set():
            self.refresh_tailscale()
            self.stop_monitor.wait(5)

    def refresh_tailscale(self):
        if not self.auto_tailscale:
            return
        adapters = detect_adapters(tailscale=True)
        if adapters is None:
            return
        with self.lock:
            if not self.auto_tailscale or self.stop_monitor.is_set():
                return
            address = adapters[0]["address"] if adapters else ""
            if self.remote_address() != address:
                self.stop_listener("remote_server")
            if address and (self.server or (self.state / "companion.db").is_file()):
                try:
                    self.start_listener(address, remote=True)
                except (OSError, ImportError, ValueError):
                    logging.getLogger(__name__).warning(
                        "Could not start automatic Companion Tailscale listener.", exc_info=True
                    )

    def configure_remote(self, request: RemoteSettingsRequest):
        with self.lock:
            marker = self.state / "tailscale-auto"
            try:
                if request.automatic:
                    self.state.mkdir(parents=True, exist_ok=True)
                    marker.touch()
                else:
                    config = self.state / "listener-address"
                    if config.is_file():
                        address = config.read_text().splitlines()[:1]
                        pending = config.with_suffix(".tmp")
                        pending.write_text("\n".join(address), encoding="ascii")
                        pending.replace(config)
                    marker.unlink(missing_ok=True)
                    self.stop_listener("remote_server")
                self.auto_tailscale = request.automatic
            except OSError as error:
                raise HTTPException(503, "Could not save Companion remote settings.") from error
        self.refresh_tailscale()
        return {"autoTailscale": self.auto_tailscale, "remoteAddress": self.remote_address()}

    def close(self):
        self.stop_monitor.set()
        if self.monitor is not None:
            self.monitor.join()
        with self.lock:
            self.stop_listener("remote_server")
            self.stop_listener("server")

    def stop_listener(self, slot):
        server = getattr(self, slot)
        if server is not None:
            server.shutdown()
            server.server_close()
            setattr(self, slot, None)

    def remote_address(self):
        server = self.remote_server
        return server.server_address[0] if server else ""

    def network(self, pairing_id: str | None = None):
        adapters = detect_adapters()
        preferred = next((adapter for adapter in adapters or [] if adapter["wifi"]), None)
        with self.lock:
            label = self.gateway.paired_label(pairing_id) if self.gateway and pairing_id else None
            remote = self.remote_address()
            automatic = self.auto_tailscale
        return {"adapters": adapters, "preferred": preferred, "pairedLabel": label, "remoteAddress": remote, "autoTailscale": automatic}

    def start_listener(self, address: str, *, remote=False):
        slot = "remote_server" if remote else "server"
        previous = getattr(self, slot)
        if previous is None or previous.server_address[0] != address:
            gateway = self.gateway or Gateway(self.state, self.root)
            cert, key = certificate(self.state)
            pin = hashlib.sha256(ssl.PEM_cert_to_DER_cert(cert.read_text())).hexdigest()
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(cert, key)
            server = ThreadingHTTPServer((address, 8443), Handler)
            try:
                server.socket = context.wrap_socket(server.socket, server_side=True,
                                                    do_handshake_on_connect=False)
                server.gateway = gateway
                server.pin = pin
                server.remote_address = self.remote_address
                server.transport = "tailscale" if remote else "lan"
                if self.gateway is None:
                    gateway.recover()
                threading.Thread(target=server.serve_forever, daemon=True).start()
            except Exception:
                server.server_close()
                raise
            self.stop_listener(slot)
            setattr(self, slot, server)
            self.gateway = gateway

    def issue(self, request: PairingRequest):
        if request.address is None:
            preferred = self.network()["preferred"]
            if preferred is None:
                raise HTTPException(400, "Connect this PC to Wi-Fi or choose an address under Advanced.")
            address = preferred["address"]
        elif any(request.address in net for net in LAN_NETWORKS):
            address = str(request.address)
        else:
            raise HTTPException(400, "Enter the private IPv4 address of this PC's Wi-Fi adapter.")
        remote = request.remote_address
        if remote is not None and remote not in TAILSCALE_NETWORK:
            raise HTTPException(400, "Enter the PC's Tailscale IPv4 address.")
        try:
            import qrcode
            from qrcode.image.svg import SvgPathImage
            with self.lock:
                self.start_listener(address)
                if not self.auto_tailscale and "remote_address" in request.model_fields_set:
                    if remote is None:
                        self.stop_listener("remote_server")
                    else:
                        self.start_listener(str(remote), remote=True)
                remote_host = self.remote_address()
                config = self.state / "listener-address"
                pending = config.with_suffix(".tmp")
                pending.write_text("\n".join(filter(None, (address, "" if self.auto_tailscale else remote_host))), encoding="ascii")
                pending.replace(config)
                gateway = self.server.gateway
                code = gateway.issue()
                payload = json.dumps({"v": 1, "host": address, "port": 8443,
                                      "pin": self.server.pin, "pc": gateway.name,
                                      "code": code, "remoteHost": remote_host}, separators=(",", ":"))
                image = qrcode.make(payload, image_factory=SvgPathImage).to_string()
                return {"image": base64.b64encode(image).decode(), "expiresIn": TTL,
                        "address": address, "pairingId": digest(code)}
        except ImportError as error:
            raise HTTPException(503, "Install the Companion Python requirements in the Oracle backend environment.") from error
        except OSError as error:
            raise HTTPException(503, "Could not start the Companion listener. Check the selected network addresses and port 8443.") from error

    def device_store(self):
        with self.lock:
            if self.gateway is None and (self.state / "companion.db").is_file():
                self.gateway = Gateway(self.state, self.root)
                self.gateway.recover()
            return self.gateway

    def devices(self):
        gateway = self.device_store()
        return {"devices": gateway.devices() if gateway else []}

    def revoke(self, device_id: UUID):
        gateway = self.device_store()
        if not gateway or not gateway.revoke(str(device_id)):
            raise HTTPException(404, "This phone is no longer paired.")
        return {"revoked": True}

    def router(self):
        router = APIRouter(prefix="/api/v1/companion")
        router.add_api_route("/network", self.network, methods=["GET"])
        router.add_api_route("/remote", self.configure_remote, methods=["POST"])
        router.add_api_route("/pairing", self.issue, methods=["POST"])
        router.add_api_route("/devices", self.devices, methods=["GET"])
        router.add_api_route("/devices/{device_id}", self.revoke, methods=["DELETE"])
        router.add_api_route("/devices/{device_id}/trip", self.queue_trip, methods=["POST"])
        return router

    def queue_trip(self, device_id: UUID, trip: CompanionTripRequest):
        gateway = self.device_store()
        if not gateway or not gateway.queue_trip(str(device_id), trip.destination_name, trip.maps_url()):
            raise HTTPException(404, "This phone is no longer paired.")
        return {"queued": True}
