#!/usr/bin/env python3
"""Seed the NYC TLC Yellow Taxi 20k-row sample through the standard upload pipeline.

Usage:
    python scripts/seed_nyc_taxi.py [--api http://localhost:8000] [--user admin] [--password admin]

The script:
  1. Downloads the Jan 2024 Yellow Taxi Parquet file (~48 MB) to a temp location.
  2. Authenticates with the DataBrief API.
  3. Creates a dataset record.
  4. Uploads the file — the backend pipeline caps ingestion at SAMPLE_ROW_CAP (default 20 000).
  5. Polls progress until 'ready' or 'failed'.

This deliberately runs through the same pipeline as a real user upload (no special-casing).
"""
import argparse
import sys
import time
import tempfile
import os
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Install requests: pip install requests")

PARQUET_URL = "https://d37ci6vzurychx.cloudfront.net/trip-data/yellow_tripdata_2024-01.parquet"
DATASET_NAME = "nyc_yellow_taxi_sample_20k"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--api", default="http://localhost:8000", help="DataBrief API base URL")
    p.add_argument("--user", default="admin")
    p.add_argument("--password", default="admin")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    base = args.api.rstrip("/")

    # 1. Health check
    print(f"Connecting to {base} …")
    try:
        r = requests.get(f"{base}/health", timeout=5)
        r.raise_for_status()
    except Exception as e:
        sys.exit(f"Cannot reach API at {base}: {e}\nMake sure the backend is running.")

    # 2. Login
    print("Authenticating …")
    r = requests.post(f"{base}/auth/login", json={"username": args.user, "password": args.password})
    if r.status_code != 200:
        sys.exit(f"Login failed ({r.status_code}): {r.text}")
    token = r.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # 3. Download Parquet file
    tmp_dir = Path(tempfile.mkdtemp(prefix="databrief_seed_"))
    parquet_path = tmp_dir / "yellow_tripdata_2024-01.parquet"

    if parquet_path.exists():
        print(f"Reusing cached file at {parquet_path}")
    else:
        print(f"Downloading {PARQUET_URL} …")
        r = requests.get(PARQUET_URL, stream=True, timeout=300)
        r.raise_for_status()
        total = int(r.headers.get("content-length", 0))
        downloaded = 0
        with open(parquet_path, "wb") as f:
            for chunk in r.iter_content(65536):
                f.write(chunk)
                downloaded += len(chunk)
                if total:
                    pct = downloaded / total * 100
                    print(f"\r  {pct:.0f}%  ({downloaded/1024/1024:.1f} MB)", end="", flush=True)
        print(f"\r  Downloaded {downloaded/1024/1024:.1f} MB to {parquet_path}")

    # 4. Create dataset record
    print("Creating dataset record …")
    r = requests.post(
        f"{base}/datasets",
        json={
            "name": DATASET_NAME,
            "original_filename": "yellow_tripdata_2024-01.parquet",
            "file_type": "parquet",
        },
        headers=headers,
    )
    if r.status_code != 201:
        sys.exit(f"Failed to create dataset ({r.status_code}): {r.text}")
    dataset_id = r.json()["dataset_id"]
    print(f"  dataset_id: {dataset_id}")

    # 5. Upload file
    print("Uploading file to backend (pipeline will cap at SAMPLE_ROW_CAP rows) …")
    file_size = parquet_path.stat().st_size
    print(f"  File size: {file_size/1024/1024:.1f} MB")
    with open(parquet_path, "rb") as f:
        r = requests.post(
            f"{base}/datasets/{dataset_id}/upload",
            files={"file": ("yellow_tripdata_2024-01.parquet", f, "application/octet-stream")},
            headers=headers,
            timeout=600,
        )
    if r.status_code != 200:
        sys.exit(f"Upload failed ({r.status_code}): {r.text}")
    print("  Upload accepted — background pipeline started")

    # 6. Poll progress
    print("Polling progress …")
    last_stage = ""
    for _ in range(600):  # up to 10 minutes
        time.sleep(1)
        r = requests.get(f"{base}/datasets/{dataset_id}/progress", headers=headers, timeout=10)
        if r.status_code != 200:
            print(f"  Progress poll error: {r.status_code}")
            continue
        p = r.json()
        stage = p.get("stage", "")
        pct = p.get("percent", 0)
        msg = p.get("message", "")

        if stage != last_stage or int(pct) % 10 == 0:
            print(f"  [{stage:12s}] {pct:5.1f}%  {msg}")
            last_stage = stage

        if stage == "done":
            print("\nSeeding complete!")
            break
        if stage == "failed":
            print(f"\nPipeline failed: {msg}")
            sys.exit(1)
    else:
        print("\nTimed out waiting for pipeline to finish")
        sys.exit(1)

    # 7. Final summary
    r = requests.get(f"{base}/datasets/{dataset_id}", headers=headers)
    if r.status_code == 200:
        ds = r.json()
        print(f"\nDataset summary:")
        print(f"  Name:         {ds['name']}")
        print(f"  Rows:         {ds['row_count']:,}")
        print(f"  Columns:      {ds['column_count']}")
        print(f"  Quality:      {ds['quality_score']:.1f}/100")
        print(f"  Status:       {ds['status']}")
        print(f"  Table:        databrief.{ds['clickhouse_table']}")

    # Temp file cleanup
    try:
        parquet_path.unlink()
        tmp_dir.rmdir()
    except Exception:
        pass


if __name__ == "__main__":
    main()
