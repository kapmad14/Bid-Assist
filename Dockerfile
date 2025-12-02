# Dockerfile — Playwright base with pinned v1.56.0 and permanent browser install
FROM mcr.microsoft.com/playwright/python:v1.55.0-jammy

ENV PYTHONUNBUFFERED=1
WORKDIR /app

# copy requirements early for caching
COPY requirements.txt /app/requirements.txt

# install python deps
RUN pip install --no-cache-dir -r /app/requirements.txt

# ensure playwright browsers are installed into the image (permanent)
RUN python -m playwright install --with-deps

# copy project files
COPY . /app

# create expected runtime dirs
RUN mkdir -p /app/data /app/logs /app/data/db /app/data/pdfs

# make run scripts executable (if you place scripts under /app/docker)
RUN chmod +x /app/docker/*.sh || true

# default command (kept as bash so docker-compose can override)
CMD ["bash"]