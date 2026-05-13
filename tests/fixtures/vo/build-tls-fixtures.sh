#!/usr/bin/env bash
# Generates a localhost self-signed cert/key pair for the HTTPS server tests.
# Run once: bash tests/fixtures/vo/build-tls-fixtures.sh
# Outputs are gitignored (per tests/fixtures/vo/.gitignore).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"

# Write a minimal openssl config that includes SAN without relying on -addext
# (some OpenSSL 3.x builds have a broken system openssl.cnf that rejects -addext).
TMPCONF="$(mktemp /tmp/openssl-tls-XXXXXX.cnf)"
trap 'rm -f "$TMPCONF"' EXIT
cat > "$TMPCONF" << 'EOCONF'
[req]
distinguished_name = req_dn
x509_extensions = v3_req
prompt = no

[req_dn]
CN = localhost

[v3_req]
subjectAltName = DNS:localhost,IP:127.0.0.1
EOCONF

OPENSSL_CONF="$TMPCONF" openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
  -keyout "$DIR/key.pem" -out "$DIR/cert.pem" \
  -config "$TMPCONF"
echo "wrote $DIR/cert.pem and $DIR/key.pem"
