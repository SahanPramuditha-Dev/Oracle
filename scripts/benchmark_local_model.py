"""Phase 0 local inference smoke test using only the Python standard library."""
import argparse
import json
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def request(path, payload=None):
    data = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        "http://127.0.0.1:11434" + path,
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=180) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", default="qwen2.5:1.5b")
    args = parser.parse_args()
    metadata = request("/api/show", {"model": args.model})
    result = {
        "recorded_at_utc": datetime.now(timezone.utc).isoformat(),
        "runtime_version": request("/api/version").get("version"),
        "model": args.model,
        "details": metadata.get("details"),
        "prompt": "Reply with one short sentence explaining what a personal assistant does.",
        "runs": [],
    }
    for label in ("first_request", "second_request"):
        start = time.perf_counter()
        reply = request("/api/generate", {
            "model": args.model,
            "prompt": result["prompt"],
            "stream": False,
            "keep_alive": "5m",
            "options": {"temperature": 0, "num_ctx": 2048, "num_predict": 64},
        })
        elapsed = round(time.perf_counter() - start, 3)
        if not reply.get("done") or not reply.get("response", "").strip():
            raise RuntimeError("Model did not return a completed nonempty response")
        count, duration = reply.get("eval_count", 0), reply.get("eval_duration", 0)
        run = {
            "label": label,
            "elapsed_seconds": elapsed,
            "response": reply["response"].strip(),
            "load_seconds": round(reply.get("load_duration", 0) / 1e9, 3),
            "generated_tokens": count,
            "tokens_per_second": round(count / (duration / 1e9), 2) if duration else None,
        }
        result["runs"].append(run)
        print(json.dumps(run))
    result["loaded_models_after_runs"] = request("/api/ps").get("models", [])
    output = Path(__file__).resolve().parents[1] / "data/readiness/local_model_benchmark.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print("Saved:", output)


if __name__ == "__main__":
    main()
