#!/bin/sh

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
else
  echo "Error: .env file not found."
  exit 1
fi

if [ -z "$NORD_TOKEN" ]; then
  echo "Error: NORD_TOKEN is not set"
  exit 1
fi

TOKEN=$NORD_TOKEN
URL="https://api.nordvpn.com/v1/users/services/credentials"

# 1. Fetch data using Basic Auth
# -u handles the 'username:password' format
response=$(curl -s -u "token:$TOKEN" "$URL")

# Check if the response is empty or unauthorized
if [ -z "$response" ]; then
    echo "Error: No response from API."
    exit 1
fi

# 2. Parse the response
echo "--- NordVPN Service Credentials ---"
echo "$response" | jq '.'

