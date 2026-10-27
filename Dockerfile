FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3013

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js ./
COPY work-tracker.html ./
COPY src/ ./src/

EXPOSE 3013

CMD ["node", "server.js"]
