# DocvaultAI — Automated PDF PII Redaction & Cloud Pipeline

DocvaultAI is a data engineering and document privacy workflow that automatically detects, masks, and audits Personally Identifiable Information (PII) inside PDF documents. It features a three-stage web studio (`Upload` → `Process & Mask` → `Final Output`) backed by Python, Flask, PyMuPDF, and local AWS S3/SQS emulation via Floci and Docker.

## Key Features
* **Automated PII Detection & Redaction:** Permanently redacts email addresses, phone numbers, CNIC/national IDs, credit card/IBAN numbers, and custom user-defined keywords using `PyMuPDF` (`fitz`).
* **3-Stage Interactive Workflow Studio:** Side-by-side preview of the original input PDF and final redacted output PDF, paired with entity breakdown counts and page-level audit logs.
* **Cloud-Emulated Pipeline (S3 + SQS):** Integrates with local AWS emulation (`Floci` via Docker) to store raw and redacted PDFs in S3 buckets and dispatch asynchronous processing jobs to SQS—with automatic local fallback when offline.
* **Configurable Redaction Rules & Vault History:** Synced rule toggles across Studio and Rules tabs, downloadable original/redacted PDFs, and an on-demand audit history log.

## Tech Stack
* **Backend & PDF Engine:** Python, Flask, PyMuPDF (`fitz`), Boto3, python-dotenv
* **Cloud & Infrastructure:** Docker, Docker Compose, Floci (Local AWS S3 & SQS emulation), PostgreSQL (`psycopg2-binary`)
* **Frontend:** HTML5, CSS3 (dual-theme UI), Vanilla JavaScript

## Project Structure
```text
DocvaultAI/
├── app.py                     # Flask application, redaction engine & S3/SQS routes
├── templates/
│   └── dashboard.html         # 3-stage Studio, Rules, Vault History & Pipeline UI
├── static/
│   ├── css/dashboard.css      # Theme styling and responsive layout
│   └── js/dashboard.js        # Client state, async uploads & preview controls
├── worker/
│   ├── consumer.py            # SQS background worker consumer
│   ├── db.py                  # Database persistence layer
│   └── redaction_engine.py    # Modular redaction logic
├── scripts/
│   └── init_aws.py            # S3 bucket & SQS queue initialization script
├── docker-compose.yml         # Local Floci & service orchestration
└── requirements.txt           # Python dependencies