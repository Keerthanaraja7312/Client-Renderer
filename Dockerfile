FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

# Backend origin (both variable names point to the same backend)
ARG VITE_DATASTORE_API_URL
ARG VITE_API_BASE
ARG VITE_DEFAULT_PAGE=""
ARG VITE_REQUIRE_LOGIN="true"

ENV VITE_DATASTORE_API_URL=$VITE_DATASTORE_API_URL
ENV VITE_API_BASE=$VITE_API_BASE
ENV VITE_DEFAULT_PAGE=$VITE_DEFAULT_PAGE
ENV VITE_REQUIRE_LOGIN=$VITE_REQUIRE_LOGIN

RUN test -n "$VITE_DATASTORE_API_URL" || (echo "ERROR: VITE_DATASTORE_API_URL is not set" && exit 1)
RUN test -n "$VITE_API_BASE" || (echo "ERROR: VITE_API_BASE is not set" && exit 1)

RUN npx vite build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80