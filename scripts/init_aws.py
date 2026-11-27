import json # Built-in module to convert Python dictionaries into JSON strings for AWS policies
import os # Built-in module to read environment variables
import boto3 # AWS SDK used to create buckets, queues, and event rules
from dotenv import load_dotenv # Helper to read key=value pairs from your .env file

load_dotenv() # Actually loads the .env file into memory right now

ENDPOINT_URL = os.getenv("AWS_ENDPOINT_URL", "http://localhost:4566") # Read endpoint or fallback to localhost:4566
REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1") # Read AWS region or fallback to us-east-1
RAW_BUCKET = os.getenv("RAW_BUCKET_NAME", "docuvault-raw-uploads") # Name for raw upload bucket
CLEAN_BUCKET = os.getenv("CLEAN_BUCKET_NAME", "docuvault-clean-redacted") # Name for redacted output bucket
QUEUE_NAME = os.getenv("SQS_QUEUE_NAME", "docuvault-redaction-queue") # Name for SQS queue

s3 = boto3.client( # Create an S3 client object to send S3 API commands
    "s3", # Service name: Amazon S3
    endpoint_url=ENDPOINT_URL, # Send requests to LocalStack instead of real AWS
    region_name=REGION, # Set region
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"), # Supply access key
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"), # Supply secret key
)

sqs = boto3.client( # Create an SQS client object to send SQS API commands
    "sqs", # Service name: Amazon SQS
    endpoint_url=ENDPOINT_URL, # Send requests to LocalStack instead of real AWS
    region_name=REGION, # Set region
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID", "test"), # Supply access key
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY", "test"), # Supply secret key
)


def setup_infrastructure(): # Main function that provisions all Phase 1 cloud resources
    # 1. Create Raw & Clean S3 Buckets
    for bucket in [RAW_BUCKET, CLEAN_BUCKET]: # Loop through both bucket names
        s3.create_bucket(Bucket=bucket) # Create the bucket in LocalStack
        print(f"[OK] S3 bucket created: {bucket}") # Print confirmation message

    # 2. Configure CORS on Raw Bucket so browser pre-signed uploads work
    s3.put_bucket_cors( # Apply Cross-Origin Resource Sharing rules to the raw bucket
        Bucket=RAW_BUCKET, # Target the raw uploads bucket
        CORSConfiguration={ # CORS rule definition
            "CORSRules": [ # List of allowed browser rules
                {
                    "AllowedHeaders": ["*"], # Allow any HTTP request headers
                    "AllowedMethods": ["GET", "PUT", "POST"], # Allow reading and uploading files
                    "AllowedOrigins": ["*"], # Allow requests from any local origin during dev
                    "ExposeHeaders": ["ETag"], # Expose ETag header back to the uploader
                }
            ]
        },
    )

    # 3. Create SQS Queue and get its ARN
    queue_resp = sqs.create_queue(QueueName=QUEUE_NAME) # Create the SQS queue and get response dict
    queue_url = queue_resp["QueueUrl"] # Extract the queue URL (used for sending/receiving messages)
    attrs = sqs.get_queue_attributes(QueueUrl=queue_url, AttributeNames=["QueueArn"]) # Fetch queue attributes
    queue_arn = attrs["Attributes"]["QueueArn"] # Extract the QueueArn (unique AWS resource ID)
    print(f"[OK] SQS queue created: {QUEUE_NAME} ({queue_arn})") # Print confirmation with ARN

    # 4. Allow S3 to publish event notifications to SQS
    policy = { # IAM-style resource policy granting S3 permission to push messages to SQS
        "Version": "2012-10-17", # Standard AWS policy language version
        "Statement": [ # List of permission rules
            {
                "Effect": "Allow", # Explicitly allow the action below
                "Principal": {"Service": "s3.amazonaws.com"}, # Allow the S3 service to use this rule
                "Action": "sqs:SendMessage", # Only allow sending messages to the queue (least privilege)
                "Resource": queue_arn, # Target only this specific SQS queue
                "Condition": {"ArnLike": {"aws:SourceArn": f"arn:aws:s3:::{RAW_BUCKET}"}}, # Only from our raw bucket
            }
        ],
    }
    sqs.set_queue_attributes( # Attach the access policy to the SQS queue
        QueueUrl=queue_url, Attributes={"Policy": json.dumps(policy)} # Convert dict to JSON string for AWS
    )

    # 5. Wire S3 ObjectCreated event -> SQS Queue
    s3.put_bucket_notification_configuration( # Configure S3 event notifications on the raw bucket
        Bucket=RAW_BUCKET, # Watch for events inside docuvault-raw-uploads
        NotificationConfiguration={ # Event routing rules
            "QueueConfigurations": [ # Send matching events to an SQS queue
                {
                    "QueueArn": queue_arn, # Destination SQS queue ARN
                    "Events": ["s3:ObjectCreated:*"], # Trigger whenever any file is uploaded/created in S3
                }
            ]
        },
    )
    print(f"[OK] S3 -> SQS event trigger wired on '{RAW_BUCKET}'") # Final success message


if __name__ == "__main__": # Run setup_infrastructure() only when this file is executed directly
    setup_infrastructure() # Execute the setup function