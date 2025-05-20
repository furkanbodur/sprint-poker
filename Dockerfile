# Use official Python slim image test
FROM python:3.11-slim

# Ensure logs print instantly
ENV PYTHONUNBUFFERED=1

# Create working directory
WORKDIR /app

# Copy only requirements.txt first (to leverage Docker cache)
COPY requirements.txt ./

# Install build-essential, install Python deps, then remove build-essential
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential \
    && rm -rf /var/lib/apt/lists/*

# Now copy the rest of your app code
COPY . .

# Expose the port (optional/documentation)
EXPOSE 5000

# Run your app with eventlet
CMD ["python", "app.py"]
