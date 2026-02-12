# Build stage
FROM node:18-alpine AS build

WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage - use unprivileged nginx for OpenShift compatibility
FROM nginxinc/nginx-unprivileged:alpine

# Copy built assets
COPY --from=build /app/build /usr/share/nginx/html

# Copy nginx config for SPA routing (non-root, port 8080)
USER root
RUN echo 'server { \
    listen 8080; \
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
