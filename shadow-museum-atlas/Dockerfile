FROM node:20-bookworm-slim

# Install Python and dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Setup Python Virtual Environment and install SpaCy
RUN python3 -m venv /app/venv
ENV PATH="/app/venv/bin:$PATH"
RUN pip3 install --no-cache-dir torch torchvision --extra-index-url https://download.pytorch.org/whl/cpu
RUN pip3 install --no-cache-dir spacy pypdf sentence-transformers psycopg2-binary pillow requests
RUN python3 -m spacy download de_core_news_sm

# Pre-download HuggingFace Models so they are baked into the image
RUN python3 -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"
RUN python3 -c "from transformers import pipeline; pipeline('zero-shot-classification', model='MoritzLaurer/mDeBERTa-v3-base-mnli-xnli')"

# Install Node dependencies
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Build frontend
RUN npm run build

# Expose port
EXPOSE 8088

# Start the server
CMD ["node", "server.js"]
