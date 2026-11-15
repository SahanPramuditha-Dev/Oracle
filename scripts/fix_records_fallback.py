with open('backend/app/main.py', 'r', encoding='utf-8') as f:
    c = f.read()

target = "records_instance = Records.from_env()"
replacement = """try:
    records_instance = Records.from_env()
except Exception:
    records_instance = None"""

c = c.replace(target, replacement)

with open('backend/app/main.py', 'w', encoding='utf-8') as f:
    f.write(c)

print('Updated records_instance with try-except fallback')
