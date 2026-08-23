FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
RUN mkdir -p /app/data
VOLUME ["/app/data"]
ENV NODE_ENV=production
CMD ["node", "src/index.js"]
