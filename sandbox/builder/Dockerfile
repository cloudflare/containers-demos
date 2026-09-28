# Node.js 24 with common tools for building software.
FROM node:24-trixie-slim

# The package lists stay in the image so that a later apt-get update only
# revalidates them.
RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
        bash build-essential ca-certificates curl git python3 python3-setuptools unzip
