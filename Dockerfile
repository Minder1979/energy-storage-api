FROM node:20-alpine

WORKDIR /app

# Install dependencies first (layer cache optimization)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY . .

# Create data dir
RUN mkdir -p data

# Railway sets PORT env var automatically
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE $PORT

# Cron: run scraper every day at 6am UTC (2pm Beijing time)
RUN apk add --no-cache dcron
RUN echo "0 6 * * * node /app/scrapers/run.js >> /var/log/cron.log 2>&1" | crontab -
CMD (crond -l 2 -L /dev/stdout &) && node server.js
