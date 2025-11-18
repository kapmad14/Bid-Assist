# test_login.py
import requests
SUPABASE_URL = "https://mczecifjqmhbgjkxqsna.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1jemVjaWZqcW1oYmdqa3hxc25hIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjE5MTAyMzksImV4cCI6MjA3NzQ4NjIzOX0.SVAGJIKBUqjwgnWrWOv4RtvCbYCgKYfEbWZwBwQqJxA"
url = SUPABASE_URL + "/auth/v1/token?grant_type=password"
headers = {"apikey": ANON_KEY, "Content-Type": "application/x-www-form-urlencoded"}
data = {"email": "dev+tester@example.com", "password": "TempPass123!"}

r = requests.post(url, headers=headers, data=data, timeout=15)
print("STATUS:", r.status_code)
try:
    print("JSON:", r.json())
except Exception:
    print("TEXT:", r.text)
print("REQ HEADERS:", r.request.headers)
print("REQ BODY (raw):", r.request.body)
