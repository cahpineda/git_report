#!/bin/bash
# Generates the GitHub activity report and saves it with a timestamped filename.
# Usage: bash run-report.sh

set -euo pipefail

FILENAME="report-$(date +%Y-%m-%d-%H-%M).md"

echo "Generating report → ${FILENAME}" >&2

node report.js > "${FILENAME}"

echo "Done. Report saved to: ${FILENAME}" >&2
