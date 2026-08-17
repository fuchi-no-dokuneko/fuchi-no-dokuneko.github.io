#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first"
npm ci --ignore-scripts --no-audit --no-fund
