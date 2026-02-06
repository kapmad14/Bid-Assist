import boto3
import os

def get_r2_client():
    return boto3.client(
        "s3",
        endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        region_name="auto",
    )

def upload_pdf_r2(key: str, data: bytes) -> str:
    s3 = get_r2_client()
    s3.put_object(
        Bucket=os.environ["R2_BUCKET"],
        Key=key,
        Body=data,
        ContentType="application/pdf"
    )
    return f"{os.environ['R2_PUBLIC_BASE']}/{key}"
