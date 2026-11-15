"""Automated tests for Oracle Companion Telemetry Engine and Monitoring APIs."""
import os
import sys
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.companion_telemetry import (
    AlertEngine,
    HardwareCapabilities,
    NvmlAdapter,
    PerformanceHistoryStore,
    TelemetryEngine,
)


def test_cpu_discovery():
    cpu_meta = HardwareCapabilities.get_cpu_info()
    assert isinstance(cpu_meta["model"], str)
    assert len(cpu_meta["model"]) > 0
    assert cpu_meta["physicalCores"] >= 1
    assert cpu_meta["logicalCores"] >= cpu_meta["physicalCores"]
    assert cpu_meta["baseMhz"] > 0
    assert cpu_meta["maxMhz"] > 0


def test_system_bios():
    bios = HardwareCapabilities.get_system_bios()
    assert isinstance(bios["manufacturer"], str)
    assert isinstance(bios["product"], str)


def test_nvml_adapter_and_gpu_discovery():
    adapter = NvmlAdapter()
    gpus = adapter.query_gpus()
    # NVML should either return real GPU(s) or empty list if no NVIDIA driver
    assert isinstance(gpus, list)
    if gpus:
        gpu = gpus[0]
        assert gpu["vendor"] == "NVIDIA"
        assert gpu["type"] == "dedicated"
        assert gpu["vramTotalBytes"] > 0
        assert 0 <= gpu["usagePercent"] <= 100
        if gpu["temperatureC"] is not None:
            assert 10 <= gpu["temperatureC"] <= 120

    # Test GPU metadata merging (detecting integrated + dedicated)
    merged = HardwareCapabilities.get_gpus_metadata(gpus)
    assert len(merged) >= len(gpus)
    for g in merged:
        assert "name" in g
        assert "type" in g
        assert g["type"] in ("integrated", "dedicated")


def test_performance_history_store():
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_file = Path(tmp_dir) / "test_history.db"
        store = PerformanceHistoryStore(db_file)

        # Insert 10 samples
        for i in range(10):
            store.insert_sample(
                cpu=10.0 + i,
                ram=50.0 + i,
                gpu=5.0,
                net_down=1000.0 * i,
                net_up=500.0 * i,
                disk_read=2000.0,
                disk_write=1000.0,
                temp_gpu=55.0 + i,
            )

        points = store.query_history(window_seconds=60, max_points=10)
        assert len(points) == 10
        assert points[0]["cpu"] == 10.0
        assert points[-1]["cpu"] == 19.0
        assert points[-1]["netDown"] == 9000.0

        # Test downsampling
        sampled = store.query_history(window_seconds=60, max_points=5)
        assert len(sampled) <= 6

        # Test clear
        store.clear()
        assert len(store.query_history(window_seconds=60)) == 0


def test_alert_engine_hysteresis_and_cooldown():
    alerts = AlertEngine()
    alerts.settings["cpu_threshold"] = 90.0
    alerts.settings["sustained_duration"] = 2.0  # 2 seconds for test
    alerts.settings["cooldown_seconds"] = 10.0

    # 1. Condition starts, duration not yet met
    snap = {"cpu": {"usagePercent": 95.0}, "memory": {"usagePercent": 50.0}, "storage": {"volumes": []}}
    res = alerts.evaluate(snap)
    assert len(res) == 0  # Not sustained yet

    # 2. Simulate time passing for sustained duration
    alerts.condition_start["cpu_sustained"] = time.time() - 3.0
    res2 = alerts.evaluate(snap)
    assert len(res2) == 1
    alert_id = res2[0]["id"]
    assert res2[0]["category"] == "cpu"
    assert res2[0]["severity"] == "critical"

    # 3. Test alert acknowledgment
    alerts.acknowledge(alert_id)
    assert alerts.active_alerts["cpu_sustained"]["acknowledged"] is True

    # 4. Condition resolves
    snap_normal = {"cpu": {"usagePercent": 30.0}, "memory": {"usagePercent": 50.0}, "storage": {"volumes": []}}
    res3 = alerts.evaluate(snap_normal)
    assert len(res3) == 0


def test_process_enumeration():
    with tempfile.TemporaryDirectory() as tmp_dir:
        engine = TelemetryEngine(Path(tmp_dir))
        try:
            procs = engine.get_processes(sort_by="cpu", limit=15)
            assert isinstance(procs, list)
            assert len(procs) > 0
            p = procs[0]
            assert "pid" in p
            assert "name" in p
            assert "cpuPercent" in p
            assert "memoryMb" in p
            assert "isOracle" in p
            assert "isAi" in p
            # Check privacy: no cmdline, no env, no tokens
            assert "cmdline" not in p
            assert "environ" not in p
        finally:
            engine.stop()


def test_gateway_monitoring_routes():
    from app.companion_gateway import Gateway, Handler
    with tempfile.TemporaryDirectory() as tmp_dir:
        gateway = Gateway(Path(tmp_dir), Path(tmp_dir))
        token = gateway.issue()
        paired = gateway.pair(token, 'Test Phone')
        credential = paired['token']

        handler = MagicMock(spec=Handler)
        handler.server = MagicMock()
        handler.server.gateway = gateway
        handler.server.transport = 'lan'
        handler.headers = {'Authorization': f'Bearer {credential}'}
        handler.command = 'GET'

        # 1. Test /monitor/overview
        handler.path = '/companion/v1/monitor/overview'
        overview = Handler.route(handler)
        assert 'cpu' in overview
        assert 'memory' in overview
        assert 'gpus' in overview
        assert 'network' in overview
        assert 'storage' in overview

        # 2. Test /monitor/processes
        handler.path = '/companion/v1/monitor/processes?sort=cpu&limit=5'
        procs = Handler.route(handler)
        assert 'processes' in procs
        assert len(procs['processes']) <= 5

        # 3. Test /monitor/hardware
        handler.path = '/companion/v1/monitor/hardware'
        hw = Handler.route(handler)
        assert 'cpu' in hw
        assert 'bios' in hw
        assert 'gpus' in hw

        # 4. Test /device/performance backward compatibility
        handler.path = '/companion/v1/device/performance'
        perf = Handler.route(handler)
        assert 'memory' in perf
        assert 'storage' in perf
        assert 'gpu3d' in perf
