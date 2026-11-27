# DocvaultAI Showcasing 


https://github.com/user-attachments/assets/db4c32f6-ded0-4645-9491-0d5c6ebf4f2d


# DocvaultAI

DocvaultAI is a web studio and data pipeline for redacting sensitive information from PDFs before files are shared, stored, or pushed into downstream workflows.

When teams work with everyday documents—invoices, onboarding forms, financial records, client files, or reports—sensitive details often slip through. This project gives you a place to stage a PDF, pick which categories to mask, add custom words if needed, inspect the original and redacted versions side by side, and keep track of what happened.

## What It Does

* **PII & Custom Term Redaction:** Uses Python and PyMuPDF (`fitz`) to find and permanently mask sensitive fields across PDF pages—including emails, phone numbers, CNIC/national IDs, card/IBAN numbers, and custom comma-separated terms you type in.
* **Side-by-Side Review:** Lets you compare the raw input PDF right next to the redacted output PDF, see entity breakdown counts, check page count and execution time, and download the result.
* **Multi-Page Studio Interface:** Splits the workflow into **Home**, **Upload**, **Process**, **Rules**, **Audit Log**, and **Pipeline** views, complete with light and dark modes.
* **Local AWS Emulation + Fallback:** Works with Dockerized **Floci** (`localhost:4566`) for local S3/SQS emulation and **PostgreSQL**, while still letting you test and preview locally if Floci is offline.

## Project Layout

* `app.py` / `templates/` / `static/`: Flask web app, UI templates, styles, and client-side interactions.
* `worker/redaction_engine.py`: Core PDF inspection and redaction logic.
* `worker/consumer.py`: Queue/event consumer logic for pipeline processing.
* `worker/db.py`: Database helpers for persistence and logging.
* `scripts/init_aws.py`: Setup/initialization script for local S3 buckets and SQS queues.
* `docker-compose.yml`: Local service definitions for PostgreSQL and Floci.

## Running It Locally

### 1. Start Supporting Services (Optional / When Testing Pipeline Mode)
Make sure Docker Desktop is running, then start your stack:

```powershell
docker compose up -d

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
