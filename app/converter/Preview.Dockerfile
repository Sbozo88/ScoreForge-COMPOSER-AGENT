FROM node:22-bookworm-slim AS site
WORKDIR /app
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=site /app/dist ./dist
COPY converter/preview.mjs ./converter/preview.mjs
ENV HOST=0.0.0.0 PORT=4173
USER node
EXPOSE 4173
CMD ["node", "converter/preview.mjs"]
