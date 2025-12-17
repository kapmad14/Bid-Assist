FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy service code into container
COPY . .

# Expose the port FastAPI will run on
EXPOSE 5001

# Start FastAPI server
CMD ["uvicorn", "extractor_service:app", "--host", "0.0.0.0", "--port", "5001"]
