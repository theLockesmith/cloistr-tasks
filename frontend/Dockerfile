# Build stage
FROM node:22.23.2-alpine AS build

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
COPY --from=build /app/dist /usr/share/nginx/html

# nginx config for SPA routing + API proxy (non-root, port 8080).
#
# The config lives in a TEMPLATE, not an inlined literal, so the API upstream can
# be a variable. See frontend/default.conf.template for the full reasoning: an
# inlined literal upstream made nginx resolve the backend Service name at startup
# and refuse to boot anywhere that name does not resolve.
USER root
COPY default.conf.template /etc/nginx/templates/default.conf.template
RUN rm -f /etc/nginx/conf.d/default.conf && \
    chown -R nginx:nginx /usr/share/nginx/html

# NGINX_ENTRYPOINT_LOCAL_RESOLVERS gates 15-local-resolvers.envsh, which is what
# populates NGINX_LOCAL_RESOLVERS from /etc/resolv.conf. Without it the resolver
# directive keeps its literal ${NGINX_LOCAL_RESOLVERS} text and nginx will not start.
ENV NGINX_ENTRYPOINT_LOCAL_RESOLVERS=1
# Mandatory. envsubst would otherwise blank out nginx's OWN runtime variables
# ($host, $remote_addr, $scheme, ...) because they look like shell variables.
ENV NGINX_ENVSUBST_FILTER="NGINX_LOCAL_RESOLVERS|TASKS_BACKEND_HOST"
ENV TASKS_BACKEND_HOST="cloistr-tasks-backend.cloistr.svc.cluster.local"

USER nginx

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
