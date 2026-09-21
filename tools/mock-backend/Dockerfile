FROM node:22-alpine
RUN npm install -g pnpm@latest
WORKDIR /app
COPY tools/mock-backend/package.json ./
RUN pnpm install
COPY tools/mock-backend/src ./src
COPY tools/mock-backend/tsconfig.json ./
RUN pnpm build
CMD ["node", "dist/index.js"]
