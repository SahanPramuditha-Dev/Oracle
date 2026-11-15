"""Read-only telemetry for the paired PC performance page."""
import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path

try:
    import psutil
except ImportError:
    psutil = None

_lock = threading.Lock()
_previous = None
_snapshot = None
_sampled = 0.0


def gpu_usage():
    if os.name != "nt":
        return None
    exe = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    script = (
        "$ErrorActionPreference='SilentlyContinue'; "
        "$rows = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue; "
        "if ($rows) { "
        "$rows | Where-Object Name -Match 'engtype_3D$' | "
        "Select-Object Name, UtilizationPercentage | ConvertTo-Json -Compress "
        "} else { 'null' }"
    )
    try:
        result = subprocess.run([str(exe), "-NoProfile", "-NonInteractive", "-Command", script],
                                capture_output=True, text=True, timeout=4,
                                creationflags=subprocess.CREATE_NO_WINDOW)
        stdout = (result.stdout or "").strip()
        if not stdout or stdout == "null":
            return None
        rows = json.loads(stdout)
        if isinstance(rows, dict):
            rows = [rows]
        engines = {}
        for row in rows or []:
            name_str = row.get("Name", "")
            engine = name_str.partition("_luid_")[2]
            if engine:
                pct = int(row.get("UtilizationPercentage", 0))
                engines[engine] = engines.get(engine, 0) + pct
        return min(100, max(engines.values())) if engines else None
    except Exception:
        return None


def performance_snapshot():
    global _previous, _snapshot, _sampled
    with _lock:
        now = time.monotonic()
        if _snapshot is not None and now - _sampled < 3:
            return _snapshot
        output = {}
        if psutil is not None:
            cpu_pct = psutil.cpu_percent(interval=None)
            output["cpuPercent"] = round(cpu_pct, 1)
            memory = psutil.virtual_memory()
            output["memory"] = {
                "used": memory.total - memory.available,
                "total": memory.total,
                "percent": round(memory.percent, 1)
            }
            counters = psutil.net_io_counters()
            if counters is not None:
                if _previous is not None:
                    stamp, rx, tx = _previous
                    elapsed = now - stamp
                    if 0 < elapsed <= 30 and counters.bytes_recv >= rx and counters.bytes_sent >= tx:
                        output["network"] = {
                            "down": round((counters.bytes_recv - rx) / elapsed),
                            "up": round((counters.bytes_sent - tx) / elapsed)
                        }
                _previous = (now, counters.bytes_recv, counters.bytes_sent)
        try:
            drive = Path(os.environ.get("SystemDrive", "C:") + "/") if os.name == "nt" else Path("/")
            disk = shutil.disk_usage(drive)
            output["storage"] = {"used": disk.used, "total": disk.total, "free": disk.free}
        except OSError:
            pass
        output["gpu3d"] = gpu_usage()
        _snapshot = output
        _sampled = time.monotonic()
        return output
