# The journey search API: docker build -t train-api . && docker run -p 8080:8080 train-api
# It loads the published timetables at start and every 6 hours; see docs/developers.md.
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["npx", "tsx", "src/server.ts"]
