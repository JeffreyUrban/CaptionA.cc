# Traefik API Gateway
# Generic gateway service for multiple projects

FROM traefik:v3.2

# Copy static configuration
COPY traefik.yml /etc/traefik/traefik.yml

# Copy dynamic configurations
COPY dynamic/ /etc/traefik/dynamic/

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:8080/ping || exit 1

# Expose ports
# 8080: HTTP (redirects to HTTPS)
# 8443: HTTPS
EXPOSE 8080 8443

# Traefik runs as non-root by default
USER root
