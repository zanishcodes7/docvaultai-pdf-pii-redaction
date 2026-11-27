import json # Converts Python dictionaries into JSON strings for PostgreSQL JSONB columns
import os # Reads environment variables like DATABASE_URL
import psycopg2 # PostgreSQL adapter for Python
from dotenv import load_dotenv # Loads variables from .env

load_dotenv() # Load .env values into the environment

DATABASE_URL = os.getenv( # Read DB connection string or use default local Docker Postgres URL
    "DATABASE_URL",
    "postgresql://docuvault:docuvault_pass@localhost:5433/docuvault_db",
)


def get_connection(): # Opens and returns a new connection to PostgreSQL
    return psycopg2.connect(DATABASE_URL) # Connect using DATABASE_URL


def init_db(): # Creates the audit_logs table if it does not exist yet
    create_table_sql = """
    CREATE TABLE IF NOT EXISTS audit_logs (
        id SERIAL PRIMARY KEY,
        object_key TEXT NOT NULL,
        raw_bucket TEXT NOT NULL,
        clean_bucket TEXT NOT NULL,
        status TEXT NOT NULL,
        pages_processed INTEGER DEFAULT 0,
        total_redactions INTEGER DEFAULT 0,
        counts_by_type JSONB DEFAULT '{}'::jsonb,
        error_message TEXT,
        processed_at TIMESTAMPTZ DEFAULT NOW()
    );
    """ # SQL statement defining columns for tracking every redaction job and its outcome
    with get_connection() as conn: # Open connection and auto-commit on clean exit
        with conn.cursor() as cur: # Create a cursor to execute SQL commands
            cur.execute(create_table_sql) # Run the table-creation SQL


def log_audit_event( # Inserts one audit record into audit_logs
    object_key: str,
    raw_bucket: str,
    clean_bucket: str,
    status: str,
    pages_processed: int = 0,
    total_redactions: int = 0,
    counts_by_type: dict | None = None,
    error_message: str | None = None,
):
    insert_sql = """
    INSERT INTO audit_logs (
        object_key, raw_bucket, clean_bucket, status,
        pages_processed, total_redactions, counts_by_type, error_message
    )
    VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s);
    """ # Parameterized SQL insert (%s placeholders prevent SQL injection)
    payload_json = json.dumps(counts_by_type or {}) # Serialize PII counts dictionary to JSON string
    with get_connection() as conn: # Open DB connection
        with conn.cursor() as cur: # Create cursor
            cur.execute( # Execute parameterized insert
                insert_sql,
                (
                    object_key,
                    raw_bucket,
                    clean_bucket,
                    status,
                    pages_processed,
                    total_redactions,
                    payload_json,
                    error_message,
                ),
            )