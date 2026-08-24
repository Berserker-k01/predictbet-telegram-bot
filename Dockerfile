FROM node:22-alpine
WORKDIR /app

RUN apk add --no-cache tzdata
ENV TZ=Europe/Paris

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV ADMIN_PORT=8788
EXPOSE 8788

CMD ["node", "src/index.js"]
