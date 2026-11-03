# Stage 1: build the web app
FROM node:22-slim AS build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: small runtime image with the server and the built app
FROM node:22-slim
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data TRUST_PROXY=1
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/src ./src
COPY --from=build /app/client/dist /app/client/dist
ENV STATIC_DIR=/app/client/dist
VOLUME ["/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
