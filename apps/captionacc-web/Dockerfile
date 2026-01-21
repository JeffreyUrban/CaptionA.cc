# syntax = docker/dockerfile:1

# Use the version specified in .nvmrc
ARG NODE_VERSION=24.12.0
FROM node:${NODE_VERSION}-slim as base

LABEL fly_launch_runtime="React Router"

# React Router app lives here
WORKDIR /app

# Set production environment
ENV NODE_ENV="production"


# Throw-away build stage to reduce size of final image
FROM base as build

# Build-time environment variables (set via fly.toml [build.args] or --build-arg)
# These get baked into the JS bundle at build time
ARG VITE_API_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_WEB3FORMS_ACCESS_KEY
ARG VITE_UMAMI_WEBSITE_ID
ARG VITE_UMAMI_SRC
ARG VITE_WASABI_BUCKET

# Install packages needed to build node modules
RUN apt-get update -qq && \
    apt-get install --no-install-recommends -y build-essential node-gyp pkg-config python-is-python3

# Install node modules
COPY --link package-lock.json package.json ./
RUN npm ci --include=dev

# Copy application code
COPY --link . .

# Build application (VITE_ env vars are available at build time)
ENV VITE_API_URL=$VITE_API_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY \
    VITE_WEB3FORMS_ACCESS_KEY=$VITE_WEB3FORMS_ACCESS_KEY \
    VITE_UMAMI_WEBSITE_ID=$VITE_UMAMI_WEBSITE_ID \
    VITE_UMAMI_SRC=$VITE_UMAMI_SRC \
    VITE_WASABI_BUCKET=$VITE_WASABI_BUCKET
RUN npm run build

# Remove development dependencies (--ignore-scripts prevents husky from running)
RUN npm prune --omit=dev --ignore-scripts


# Final stage for app image
FROM base

# Copy built application
COPY --from=build /app /app

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "npm", "run", "start" ]
