#!/bin/sh
# Asks PHP-FPM's ping endpoint over FastCGI; exits non-zero when FPM does not answer "pong".
set -e
SCRIPT_NAME=/ping SCRIPT_FILENAME=/ping REQUEST_METHOD=GET \
  cgi-fcgi -bind -connect 127.0.0.1:9000 | grep -q pong
