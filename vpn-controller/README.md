# Gluetun VPN Controller Setup

A server-side web application to control your Gluetun VPN location with a nice UI.

## Features
- Shows current VPN connection status (connected/disconnected)
- Displays current IP, country, city
- Lists all available countries and cities from Gluetun's servers.json
- Change VPN location via dropdown selection
- Restart VPN connection
- Auto-refreshes status every 30 seconds

## Installation

1. **Create the vpn-controller directory in your project:**
   ```bash
   cd ~/projects/vpn-server
   mkdir vpn-controller
   ```

2. **Copy these files into the vpn-controller directory:**
   - server.js
   - package.json
   - Dockerfile
   - public/index.html (create public directory first)

   ```bash
   mkdir vpn-controller/public
   cp server.js vpn-controller/
   cp package.json vpn-controller/
   cp Dockerfile vpn-controller/
   cp public/index.html vpn-controller/public/
   ```

3. **Add the vpn-controller service to your docker-compose.yml:**
   
   Add this to your existing services section:
   ```yaml
   vpn-controller:
     build: ./vpn-controller
     container_name: vpn-controller
     ports:
       - 8080:3000
     environment:
       - GLUETUN_API=http://gluetun:8000
       - SERVERS_PATH=/gluetun/servers.json
     volumes:
       - ./gluetun:/gluetun:ro
     depends_on:
       - gluetun
     restart: unless-stopped
   ```

4. **Start the controller:**
   ```bash
   docker-compose up -d --build vpn-controller
   ```

5. **Access the web interface:**
   Open your browser and go to:
   ```
   http://192.168.88.65:8080
   ```

## How It Works

- The Node.js server runs inside Docker and connects directly to Gluetun via the Docker network
- It reads the servers.json file that Gluetun generates (contains all NordVPN servers)
- The web UI talks to the Node.js backend (not directly to Gluetun)
- No authentication prompts in the browser - all handled server-side

## Environment Variables

- `GLUETUN_API`: Gluetun control server URL (default: http://gluetun:8000)
- `SERVERS_PATH`: Path to servers.json (default: /gluetun/servers.json)
- `GLUETUN_AUTH`: Optional Basic Auth credentials (format: "username:password")

## Troubleshooting

**Can't connect to Gluetun:**
- Check that both containers are on the same Docker network
- Verify Gluetun's control server is running on port 8000

**No countries showing:**
- Check that servers.json exists at /gluetun/servers.json
- The app falls back to a hardcoded list if the file is missing

**Changes not taking effect:**
- Gluetun takes 5-10 seconds to reconnect after changing settings
- The UI automatically refreshes after 5 seconds
