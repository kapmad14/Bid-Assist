# create_dev_user.py
from supabase import create_client
import os

SUPABASE_URL = "https://mczecifjqmhbgjkxqsna.supabase.co"
SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jemVjaWZqcW1oYmdqa3hxc25hIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTkxMDIzOSwiZXhwIjoyMDc3NDg2MjM5fQ.rWc3WerBLYShlzYmZwlEaru-pEbx9atGJGbqhK2YXyI"   # run this locally only

supabase = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)

email = "dev+tester@example.com"
password = "TempPass123!"

resp = supabase.auth.admin.create_user({
    "email": email,
    "password": password,
    "email_confirm": True
})
print(resp)
