# Cloudflare Sandbox container image — issue #131 phase 3c.
#
# The Sandbox SDK runs each Sandbox Durable Object instance inside a
# container. Wrangler builds this image automatically (`wrangler dev`
# and `wrangler deploy`) and pushes it to Cloudflare's Container
# Registry on deploy. We don't need to docker build / docker push by
# hand.
#
# Base image:
#   * `docker.io/cloudflare/sandbox:<version>` — lean image with
#     Node.js 24 and Bun. Default (no `-python` suffix) because the
#     phase 3c workload is a Node.js test gate (npm install / typecheck
#     / vitest / vite build), not Python.
#
# **Version sync (required).** The image tag MUST match the
# `@cloudflare/sandbox` npm package version in `package.json`. The
# SDK queries the container's reported version on startup and logs a
# warning if they diverge; on a wide-enough divergence, features stop
# working. When bumping `@cloudflare/sandbox`, bump this tag in lock-
# step. See:
# https://developers.cloudflare.com/sandbox/concepts/sandboxes/#version-compatibility
FROM docker.io/cloudflare/sandbox:0.10.0

# The base image includes git, node, npm, bash, and curl, but the lean
# variant does not ship a usable CA bundle for git HTTPS in local
# `wrangler dev`. Without `ca-certificates`, cloning the remote
# Cloudflare Artifacts git endpoint from the Sandbox fails with:
#
#   server certificate verification failed. CAfile: none CRLfile: none
#
# Install the distro CA bundle so both local Sandbox runs and deployed
# container runs can verify GitHub / Artifacts HTTPS remotes normally.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && update-ca-certificates \
  && git config --system http.sslCAInfo /etc/ssl/certs/ca-certificates.crt \
  && rm -rf /var/lib/apt/lists/*

ENV GIT_SSL_CAINFO=/etc/ssl/certs/ca-certificates.crt
