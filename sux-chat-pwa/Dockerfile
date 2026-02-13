# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# TURN env for Vite build
ARG VITE_TURN_URL
ARG VITE_TURN_USERNAME
ARG VITE_TURN_CREDENTIAL
ENV VITE_TURN_URL=$VITE_TURN_URL
ENV VITE_TURN_USERNAME=$VITE_TURN_USERNAME
ENV VITE_TURN_CREDENTIAL=$VITE_TURN_CREDENTIAL

# Build the application
RUN npm run build

# Production stage
FROM nginx:alpine

# Copy built files from builder
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
