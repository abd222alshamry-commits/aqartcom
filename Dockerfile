FROM node:22-alpine
RUN apk add --no-cache ffmpeg postgresql-client font-dejavu
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
RUN mkdir -p /var/data && ln -s /var/data/uploads /app/uploads && ln -s /var/data/private_uploads /app/private_uploads && ln -s /var/data/backups /app/backups
ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "-c", "mkdir -p /var/data/uploads /var/data/private_uploads /var/data/backups && exec node server/server.js"]
