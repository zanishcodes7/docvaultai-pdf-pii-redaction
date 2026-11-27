import json # Parses SQS message bodies and S3 event payloads
import os # Reads environment variables
import time # Used for sleep/retry intervals when polling or waiting for services
from urllib.parse import unquote_plus # Decodes URL-encoded S3 object keys (such as spaces in filenames)
import boto3 # AWS SDK client for S3 and SQS
from dotenv import load_dotenv # Loads .env values
from worker.db import init_db, log_audit_event # Database helpers for audit logging
from worker.redaction_engine import redact_pdf_bytes # Core PDF redaction function from Phase 2

load_dotenv() # Load .env variables

ENDPOINT_URL = os.getenv("AWS_ENDPOINT_URL", "http://localhost:4566") # Local emulator endpoint
REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1") # AWS region name
RAW_BUCKET = os.getenv("RAW_BUCKET_NAME", "docuvault-raw-uploads") # Source S3 bucket
CLEAN_BUCKET = os.getenv("CLEAN_BUCKET_NAME", "docuvault-clean-redacted") # Destination S3 bucket
QUEUE_NAME = os.getenv("SQS_QUEUE_NAME", "docuvault-redaction-queue") # SQS job queue name

s3 = boto3.client( # Create S3 client pointed at local emulator
    "s3",
    endpoint_url=ENDPOINT_URL,
    region_name=REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
)

sqs = boto3.client( # Create SQS client pointed at local emulator
    "sqs",
    endpoint_url=ENDPOINT_URL,
    region_name=REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"),
)


def extract_s3_records(message_body: str) -> list[tuple[str, str]]: # Extracts (bucket, key) pairs from an SQS message
    data = json.loads(message_body) # Parse JSON string from SQS message Body
    records = [] # Holds (bucket_name, object_key) tuples

    # Standard S3 event notification format has a "Records" list
    if isinstance(data, dict) and "Records" in data:
        for rec in data["Records"]: # Loop through each S3 event record
            bucket = rec.get("s3", {}).get("bucket", {}).get("name", RAW_BUCKET) # Get bucket name
            raw_key = rec.get("s3", {}).get("object", {}).get("key") # Get object key
            if raw_key:
                records.append((bucket, unquote_plus(raw_key))) # Decode and store (bucket, key)
    # Fallback if a custom message directly passes {"bucket": "...", "key": "..."}
    elif isinstance(data, dict) and "key" in data:
        records.append((data.get("bucket", RAW_BUCKET), unquote_plus(data["key"])))

    return records # Return all extracted file targets


def process_single_file(bucket: str, key: str): # Downloads, redacts, uploads, and logs one PDF
    print(f"[JOB] Processing s3://{bucket}/{key}") # Log start of job
    try:
        obj = s3.get_object(Bucket=bucket, Key=key) # Fetch object from S3
        raw_bytes = obj["Body"].read() # Read raw PDF bytes into memory

        clean_bytes, summary = redact_pdf_bytes(raw_bytes) # Run PII detection & redaction engine

        s3.put_object( # Upload redacted PDF to clean bucket under the same key
            Bucket=CLEAN_BUCKET,
            Key=key,
            Body=clean_bytes,
            ContentType="application/pdf",
        )

        log_audit_event( # Write successful audit row to PostgreSQL
            object_key=key,
            raw_bucket=bucket,
            clean_bucket=CLEAN_BUCKET,
            status="REDACTED",
            pages_processed=summary["pages_processed"],
            total_redactions=summary["total_redactions"],
            counts_by_type=summary["counts_by_type"],
        )
        print(f"[DONE] Uploaded clean PDF to s3://{CLEAN_BUCKET}/{key} | {summary}") # Log success
    except Exception as exc: # Catch processing or S3/DB errors so the worker keeps running
        log_audit_event( # Record failure in PostgreSQL audit log
            object_key=key,
            raw_bucket=bucket,
            clean_bucket=CLEAN_BUCKET,
            status="FAILED",
            error_message=str(exc),
        )
        print(f"[ERROR] Failed processing s3://{bucket}/{key}: {exc}") # Log failure details


def run_worker(): # Continuously polls SQS for new document jobs
    init_db() # Ensure PostgreSQL audit_logs table exists before starting loop
    queue_url = sqs.get_queue_url(QueueName=QUEUE_NAME)["QueueUrl"] # Look up SQS queue URL
    print(f"[WORKER] Listening on queue '{QUEUE_NAME}' ({queue_url})...") # Startup banner

    while True: # Keep polling indefinitely until stopped with Ctrl+C
        resp = sqs.receive_message( # Long-poll SQS for up to 5 messages at a time
            QueueUrl=queue_url,
            MaxNumberOfMessages=5,
            WaitTimeSeconds=5,
        )
        messages = resp.get("Messages", []) # Extract list of messages (empty if none arrived)

        for msg in messages: # Process each received SQS message
            body = msg.get("Body", "{}") # Read message body JSON
            receipt_handle = msg["ReceiptHandle"] # Unique handle needed to delete this message from SQS
            targets = extract_s3_records(body) # Extract (bucket, key) pairs from message

            for bucket, key in targets: # Handle each file referenced in the event
                process_single_file(bucket, key) # Run redaction pipeline for this file

            sqs.delete_message( # Delete message from queue so it won't be re-processed
                QueueUrl=queue_url,
                ReceiptHandle=receipt_handle,
            )

        if not messages: # Brief pause if no messages were returned
            time.sleep(1)


if __name__ == "__main__": # Run worker loop only when executed directly
    run_worker() # Start polling SQS