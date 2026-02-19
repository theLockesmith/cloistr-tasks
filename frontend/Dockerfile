# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci --legacy-peer-deps

# Copy source and build
COPY . .
RUN npm run build

# Production stage - use unprivileged nginx for OpenShift compatibility
FROM nginxinc/nginx-unprivileged:alpine

# Copy built assets
COPY --from=build /app/build /usr/share/nginx/html

# Copy nginx config for SPA routing + API proxy (non-root, port 8080)
USER root
RUN echo 'server { \
    listen 8080; \
    location /api/ { \
        proxy_pass http://coldforge-tasks-backend.cloistr.svc.cluster.local:80/; \
        proxy_http_version 1.1; \
        proxy_set_header Host $host; \
        proxy_set_header X-Real-IP $remote_addr; \
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; \
        proxy_set_header X-Forwarded-Proto $scheme; \
    } \
    location / { \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf && \
    chown -R nginx:nginx /usr/share/nginx/html
USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
