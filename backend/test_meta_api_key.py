
import os
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI, APIStatusError, APIConnectionError

# Load configuration from backend/.env
env_path = Path(__file__).resolve().parent / ".env"
load_dotenv(env_path, override=True)

api_key = os.getenv("MODEL_API_KEY", "").strip()
base_url = os.getenv("META_API_BASE_URL", "https://api.meta.ai/v1")
model = os.getenv("META_MODEL", "muse-spark-1.3")

if not api_key or api_key == "your_actual_meta_model_api_key":
    print("ERROR: Please configure a real MODEL_API_KEY in backend/.env")
    raise SystemExit(1)

print("Testing Meta Model API...")
print("Model:", model)
print("Base URL:", base_url)

# Display API key for verification
SHOW_FULL_API_KEY = False

print("\nAPI Key Information:")
print("Key length:", len(api_key))

if SHOW_FULL_API_KEY:
    print("API Key:", api_key)
else:
    masked_key = (
        api_key[:6] + "*" * max(0, len(api_key) - 10) + api_key[-4:]
        if len(api_key) > 10
        else "*" * len(api_key)
    )
    print("API Key (masked):", masked_key)

try:
    client = OpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=20.0,
        max_retries=0,
    )

    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "user", "content": "Reply with exactly: API connection successful"}
        ],
        max_tokens=30,
    )

    print("\nSUCCESS: API key accepted!")
    print("Model response:", response.choices[0].message.content)

except APIStatusError as e:
    print("\nFAILED: Meta API returned an error.")
    print("HTTP status:", e.status_code)
    if e.status_code == 401:
        print("Reason: Invalid or unauthorized API key.")
    elif e.status_code == 403:
        print("Reason: Access or permission denied.")
    else:
        print("Check model access, request format, and account status.")

except APIConnectionError:
    print("\nFAILED: Could not connect to the Meta API.")

except Exception as e:
    print("\nFAILED:", type(e).__name__)
