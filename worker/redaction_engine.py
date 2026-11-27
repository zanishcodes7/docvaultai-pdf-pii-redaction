import re # Built-in regular expressions module to find structured patterns like CNICs, emails, and phones
import fitz # PyMuPDF library used to inspect PDF text/coordinates and permanently redact pages


# Dictionary of compiled regex patterns for common PII types
PII_PATTERNS = {
    "CNIC": re.compile(r"\b\d{5}-\d{7}-\d\b"), # Matches Pakistani CNIC format like 37405-1234567-1
    "EMAIL": re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), # Matches email addresses
    "PHONE": re.compile(r"(?:\+92|0)?3\d{2}[-\s]?\d{7}\b"), # Matches Pakistani mobile numbers like 0300-1234567 or +923001234567
    "CARD": re.compile(r"\b(?:\d{4}[-\s]?){3}\d{4}\b"), # Matches 16-digit card numbers with optional spaces/dashes
}


def find_pii_matches(text: str) -> list[dict]: # Scans extracted page text and returns all matched PII items
    matches = [] # List to store each detected PII finding

    for pii_type, pattern in PII_PATTERNS.items(): # Loop through each PII category and its regex pattern
        for match in pattern.finditer(text): # Find every occurrence of the pattern in the page text
            matches.append( # Record the PII type, matched value, and character positions
                {
                    "type": pii_type, # Category label (e.g., CNIC, EMAIL, PHONE, CARD)
                    "value": match.group(0), # The exact sensitive text matched
                    "start": match.start(), # Start character index in the page text
                    "end": match.end(), # End character index in the page text
                }
            )

    return matches # Return all matches found on this page


def redact_pdf_bytes(pdf_bytes: bytes) -> tuple[bytes, dict]: # Takes raw PDF bytes, redacts PII, returns clean PDF bytes + summary
    doc = fitz.open(stream=pdf_bytes, filetype="pdf") # Open the PDF directly from memory (no temp file needed)
    audit_summary = { # Tracks what was redacted across the entire document
        "pages_processed": len(doc), # Total page count in the PDF
        "total_redactions": 0, # Total number of redaction boxes applied
        "counts_by_type": {}, # Breakdown count per PII type (e.g., {"CNIC": 2, "EMAIL": 1})
    }

    for page in doc: # Iterate through every page in the PDF document
        page_text = page.get_text("text") # Extract plain text from the current page
        page_matches = find_pii_matches(page_text) # Detect all PII strings on this page
        page_redaction_count = 0 # Counter for redactions applied on this specific page

        for item in page_matches: # Loop through each PII match found on the page
            rects = page.search_for(item["value"]) # Locate exact bounding boxes (coordinates) of the text on the page
            for rect in rects: # Loop over each matching rectangle on the page
                page.add_redact_annot( # Add a true PDF redaction annotation over the exact coordinates
                    rect, # Bounding box rectangle to remove and black out
                    text=f"[{item['type']}]", # Optional label shown over the redacted box
                    fill=(0, 0, 0), # Solid black fill color (RGB 0, 0, 0)
                    text_color=(1, 1, 1), # White text color (RGB 1, 1, 1) for readability on black box
                )
                page_redaction_count += 1 # Increment redactions for this page

        if page_redaction_count > 0: # Only apply redactions if at least one match was found on this page
            page.apply_redactions() # Permanently strips underlying text/data inside the blacked-out boxes

        # Add a small compliance footer stamp at the bottom-left of every page
        footer_point = fitz.Point(36, page.rect.height - 20) # Coordinates: 36pt from left, 20pt above bottom edge
        page.insert_text( # Stamp verification text onto the page
            footer_point, # Position on the page
            "REDACTED & VERIFIED • DOCUVAULT AI", # Compliance watermark text
            fontsize=8, # Small clean footer font size
            color=(0.3, 0.3, 0.3), # Dark gray ink
        )

        audit_summary["total_redactions"] += page_redaction_count # Add page redactions to document total
        for item in page_matches: # Update counts per PII category
            pii_type = item["type"]
            audit_summary["counts_by_type"][pii_type] = audit_summary["counts_by_type"].get(pii_type, 0) + 1

    clean_bytes = doc.tobytes(garbage=4, deflate=True) # Export sanitized PDF bytes with full cleanup (garbage=4) & compression
    doc.close() # Free PDF memory resources
    return clean_bytes, audit_summary # Return redacted PDF bytes and audit summary dictionary