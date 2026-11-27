import importlib.util
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
import boto3
from botocore.config import Config
from dotenv import load_dotenv
from flask import Flask, Response, jsonify, render_template, request
import fitz

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

app = Flask(__name__)

AWS_ENDPOINT = os.getenv("AWS_ENDPOINT_URL", os.getenv("FLOCI_ENDPOINT", "http://localhost:4566"))
AWS_REGION = os.getenv("AWS_DEFAULT_REGION", os.getenv("AWS_REGION", "us-east-1"))
RAW_BUCKET = os.getenv("RAW_BUCKET", os.getenv("S3_RAW_BUCKET", "docvault-raw"))
REDACTED_BUCKET = os.getenv("REDACTED_BUCKET", os.getenv("S3_REDACTED_BUCKET", "docvault-redacted"))
SQS_QUEUE_URL = os.getenv("SQS_QUEUE_URL", "")
SQS_QUEUE_NAME = os.getenv("SQS_QUEUE_NAME", "docvault-queue")

TMP_RAW = os.path.join(BASE_DIR, "vault_tmp", "raw")
TMP_REDACTED = os.path.join(BASE_DIR, "vault_tmp", "redacted")
JOBS_FILE = os.path.join(BASE_DIR, "vault_tmp", "jobs.json")
os.makedirs(TMP_RAW, exist_ok=True)
os.makedirs(TMP_REDACTED, exist_ok=True)


def load_redaction_engine():
    engine_path = os.path.join(BASE_DIR, "worker", "redaction_engine.py")
    if os.path.exists(engine_path):
        spec = importlib.util.spec_from_file_location("worker.redaction_engine", engine_path)
        mod = importlib.util.module_from_spec(spec)
        try:
            spec.loader.exec_module(mod)
            return mod
        except Exception:
            pass
    return None


ENGINE_MOD = load_redaction_engine()


def py_redact_with_audit(pdf_bytes: bytes, enabled_rules: dict | None = None, custom_terms: list[str] | None = None):
    start = time.perf_counter()
    if enabled_rules is None:
        enabled_rules = {"emails": True, "phones": True, "ids": True, "cards": True}

    patterns = {
        "emails": ("Email", re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[REDACTED EMAIL]"),
        "phones": ("Phone", re.compile(r"(?:\+?\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,4}[\s.-]?\d{4}\b"), "[REDACTED PHONE]"),
        "ids": ("ID / CNIC", re.compile(r"\b(?:\d{5}-\d{7}-\d|\d{3}-\d{2}-\d{4}|\d{13})\b"), "[REDACTED ID]"),
        "cards": ("Card / IBAN", re.compile(r"\b(?:PK\d{2}[A-Z]{4}\d{16}|(?:\d{4}[\s-]?){3}\d{4})\b"), "[REDACTED CARD]"),
    }

    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    counts = {"emails": 0, "phones": 0, "ids": 0, "cards": 0, "custom": 0}
    findings = []

    for pno, page in enumerate(doc):
        txt = page.get_text("text")
        for key, (label, rx, tag) in patterns.items():
            if not enabled_rules.get(key, True):
                continue
            for match in sorted(set(rx.findall(txt))):
                m = match.strip()
                if len(m) < 5:
                    continue
                for rect in page.search_for(m):
                    page.add_redact_annot(rect, text=tag, fill=(0.07, 0.08, 0.09), text_color=(0.71, 1.0, 0.22), fontsize=7)
                    counts[key] += 1
                    findings.append({"page": pno + 1, "type": label, "sample": m[:3] + "***"})

        for term in (custom_terms or []):
            t = term.strip()
            if not t:
                continue
            for rect in page.search_for(t):
                page.add_redact_annot(rect, text="[REDACTED]", fill=(0.07, 0.08, 0.09), text_color=(0.71, 1.0, 0.22), fontsize=7)
                counts["custom"] += 1
                findings.append({"page": pno + 1, "type": "Custom", "sample": t[:2] + "***"})

        page.apply_redactions()

    out_pdf = doc.tobytes(garbage=4, deflate=True)
    pages = len(doc)
    doc.close()

    total_redacted = sum(counts.values())
    latency_ms = max(1.0, round((time.perf_counter() - start) * 1000, 1))
    return out_pdf, {
        "pages": pages,
        "total_redacted": total_redacted,
        "breakdown": counts,
        "findings": findings[:60],
        "latency_ms": latency_ms,
    }


def redact_pdf(pdf_bytes: bytes, enabled_rules: dict | None = None, custom_terms: list[str] | None = None):
    if ENGINE_MOD is not None and not custom_terms and enabled_rules == {"emails": True, "phones": True, "ids": True, "cards": True}:
        for fn_name in ("redact_pdf_bytes", "redact_document", "process_pdf_bytes", "redact_pdf"):
            fn = getattr(ENGINE_MOD, fn_name, None)
            if callable(fn):
                try:
                    res = fn(pdf_bytes)
                    if isinstance(res, tuple) and len(res) == 2 and isinstance(res[1], dict):
                        out_b, aud = res[0], dict(res[1])
                        if aud.get("total_redacted", 0) > 0:
                            aud.setdefault("pages", 1)
                            aud.setdefault("latency_ms", 12.0)
                            aud.setdefault("breakdown", {"emails": 0, "phones": 0, "ids": 0, "cards": 0, "custom": 0})
                            aud.setdefault("findings", [])
                            return bytes(out_b), aud
                except Exception:
                    break
    return py_redact_with_audit(pdf_bytes, enabled_rules=enabled_rules, custom_terms=custom_terms)


def aws_clients():
    cfg = Config(connect_timeout=1, read_timeout=2, retries={"max_attempts": 1})
    s3 = boto3.client(
        "s3",
        endpoint_url=AWS_ENDPOINT,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
        region_name=AWS_REGION,
        config=cfg,
    )
    sqs = boto3.client(
        "sqs",
        endpoint_url=AWS_ENDPOINT,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
        region_name=AWS_REGION,
        config=cfg,
    )
    return s3, sqs


def inspect_pipeline():
    try:
        s3, sqs = aws_clients()
        buckets = [b["Name"] for b in s3.list_buckets().get("Buckets", [])]
        q_url = SQS_QUEUE_URL or sqs.get_queue_url(QueueName=SQS_QUEUE_NAME)["QueueUrl"]
        attrs = sqs.get_queue_attributes(QueueUrl=q_url, AttributeNames=["ApproximateNumberOfMessages"])
        depth = int(attrs.get("Attributes", {}).get("ApproximateNumberOfMessages", 0))
        return {
            "online": True,
            "endpoint": AWS_ENDPOINT,
            "buckets": buckets,
            "queue_url": q_url,
            "queue_depth": depth,
        }
    except Exception as exc:
        return {
            "online": False,
            "endpoint": AWS_ENDPOINT,
            "buckets": [],
            "queue_depth": 0,
            "error": str(exc),
        }


def read_jobs():
    if not os.path.exists(JOBS_FILE):
        return []
    try:
        with open(JOBS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def write_jobs(jobs):
    with open(JOBS_FILE, "w", encoding="utf-8") as f:
        json.dump(jobs, f, indent=2)


@app.route("/")
@app.route("/studio")
@app.route("/vault")
@app.route("/rules")
@app.route("/pipeline")
def dashboard():
    return render_template("dashboard.html")


@app.route("/api/overview")
def api_overview():
    pipe = inspect_pipeline()
    jobs = read_jobs()
    total_docs = len(jobs)
    total_masked = sum(int(j.get("audit", {}).get("total_redacted", 0) or 0) for j in jobs)
    avg_ms = round(sum(float(j.get("audit", {}).get("latency_ms", 0) or 0) for j in jobs) / total_docs, 1) if total_docs else 0
    return jsonify({
        "pipeline": pipe,
        "worker_files": ["worker/consumer.py", "worker/db.py", "worker/redaction_engine.py", "scripts/init_aws.py"],
        "metrics": {
            "total_docs": total_docs,
            "total_masked": total_masked,
            "avg_latency_ms": avg_ms,
        },
        "jobs": jobs,
    })


@app.route("/api/clear", methods=["POST"])
def api_clear():
    write_jobs([])
    return jsonify({"ok": True})


@app.route("/api/process", methods=["POST"])
def api_process():
    if "file" not in request.files:
        return jsonify({"error": "No file uploaded"}), 400
    upload = request.files["file"]
    if not upload.filename.lower().endswith(".pdf"):
        return jsonify({"error": "Please upload a PDF file"}), 400

    raw_bytes = upload.read()
    job_id = uuid.uuid4().hex[:8]
    clean_name = os.path.basename(upload.filename)
    key = f"{job_id}_{clean_name}"

    try:
        rules = json.loads(request.form.get("rules", "{}"))
    except Exception:
        rules = None
    custom_terms = [x.strip() for x in request.form.get("custom_terms", "").split(",") if x.strip()]

    with open(os.path.join(TMP_RAW, key), "wb") as f:
        f.write(raw_bytes)

    pipe = inspect_pipeline()
    mode = "local-preview"
    if pipe["online"]:
        try:
            s3, sqs = aws_clients()
            if RAW_BUCKET in pipe["buckets"]:
                s3.put_object(Bucket=RAW_BUCKET, Key=key, Body=raw_bytes, ContentType="application/pdf")
            sqs.send_message(
                QueueUrl=pipe["queue_url"],
                MessageBody=json.dumps({"job_id": job_id, "bucket": RAW_BUCKET, "key": key}),
            )
            mode = "floci-s3+sqs"
        except Exception:
            mode = "local-preview"

    redacted_bytes, audit = redact_pdf(raw_bytes, enabled_rules=rules, custom_terms=custom_terms)

    with open(os.path.join(TMP_REDACTED, key), "wb") as f:
        f.write(redacted_bytes)

    if pipe["online"] and REDACTED_BUCKET in pipe["buckets"]:
        try:
            s3, _ = aws_clients()
            s3.put_object(Bucket=REDACTED_BUCKET, Key=key, Body=redacted_bytes, ContentType="application/pdf")
        except Exception:
            pass

    record = {
        "job_id": job_id,
        "filename": clean_name,
        "key": key,
        "mode": mode,
        "size_kb": round(len(raw_bytes) / 1024, 1),
        "timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "audit": audit,
    }
    jobs = read_jobs()
    jobs.insert(0, record)
    write_jobs(jobs)
    return jsonify(record)


@app.route("/api/file/<stage>/<key>")
def api_file(stage, key):
    safe = os.path.basename(key)
    folder = TMP_RAW if stage == "raw" else TMP_REDACTED
    fpath = os.path.join(folder, safe)
    if not os.path.exists(fpath):
        return jsonify({"error": "File not found"}), 404
    with open(fpath, "rb") as f:
        content = f.read()
    resp = Response(content, mimetype="application/pdf")
    if request.args.get("dl") == "1":
        resp.headers["Content-Disposition"] = f'attachment; filename="{stage}_{safe}"'
    return resp


if __name__ == "__main__":
    app.run(debug=True, port=5050)