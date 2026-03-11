FROM node:22-alpine
RUN apk add --no-cache python3 make g++ curl
RUN mkdir -p /deps && cd /deps && npm init -y && npm install node-pty ws capnweb
ENV NODE_PATH=/deps/node_modules
EXPOSE 3000
EXPOSE 3001
