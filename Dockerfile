FROM node:24-slim
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
ARG DEBIAN_MIRROR=http://deb.debian.org
RUN sed -i "s|http://deb.debian.org|${DEBIAN_MIRROR}|g" /etc/apt/sources.list.d/debian.sources
RUN npx playwright install --with-deps chromium && apt-get update && apt-get install -y --no-install-recommends fonts-noto-cjk && rm -rf /var/lib/apt/lists/*
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev && chmod -R a+rX /ms-playwright
USER node
CMD ["sleep", "infinity"]
