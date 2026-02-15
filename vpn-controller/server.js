const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = 3000;
const GLUETUN_API = process.env.GLUETUN_API || 'http://gluetun:8000';
const GLUETUN_AUTH = process.env.GLUETUN_AUTH || null; // Format: "username:password" for Basic Auth

app.use(express.json());
app.use(express.static('public'));

// Helper function to make authenticated requests to Gluetun
async function gluetunFetch(endpoint, options = {}) {
    const headers = { ...options.headers };
    
    if (GLUETUN_AUTH) {
        const auth = Buffer.from(GLUETUN_AUTH).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
    }
    
    const response = await fetch(`${GLUETUN_API}${endpoint}`, {
        ...options,
        headers
    });
    
    if (!response.ok) {
        throw new Error(`Gluetun API error: ${response.status} ${response.statusText}`);
    }
    
    return response.json();
}

// Get current VPN status
app.get('/api/status', async (req, res) => {
    try {
        const [publicIp, vpnStatus] = await Promise.all([
            gluetunFetch('/v1/publicip/ip'),
            gluetunFetch('/v1/vpn/status')
        ]);
        
        res.json({
            connected: vpnStatus.status === 'running',
            publicIp: publicIp.public_ip,
            country: publicIp.country,
            region: publicIp.region,
            city: publicIp.city,
            status: vpnStatus.status
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get available servers from servers.json
app.get('/api/servers', async (req, res) => {
    try {
        const serversPath = process.env.SERVERS_PATH || '/gluetun/servers.json';
        const serversData = await fs.readFile(serversPath, 'utf-8');
        const servers = JSON.parse(serversData);
        
        // Extract unique countries and cities for nordvpn
        const nordvpnServers = servers.nordvpn || [];
        const countriesMap = new Map();
        
        nordvpnServers.forEach(server => {
            const country = server.country;
            if (!countriesMap.has(country)) {
                countriesMap.set(country, new Set());
            }
            if (server.city) {
                countriesMap.get(country).add(server.city);
            }
        });
        
        const result = {};
        countriesMap.forEach((cities, country) => {
            result[country] = Array.from(cities).sort();
        });
        
        res.json(result);
    } catch (error) {
        console.error('Error reading servers.json:', error);
        // Fallback to hardcoded list if file not found
        res.json({
            'United States': ['Atlanta', 'Buffalo', 'Charlotte', 'Chicago', 'Dallas', 'Denver', 'Los Angeles', 'Manassas', 'Miami', 'New York', 'Phoenix', 'Saint Louis', 'Salt Lake City', 'San Francisco', 'Seattle'],
            'United Kingdom': ['London'],
            'Canada': ['Montreal', 'Toronto', 'Vancouver'],
            'Germany': ['Berlin', 'Frankfurt'],
            'France': ['Paris'],
            'Netherlands': ['Amsterdam'],
            'Switzerland': ['Zurich'],
            'Australia': ['Adelaide', 'Brisbane', 'Melbourne', 'Perth', 'Sydney'],
            'Japan': ['Tokyo'],
            'Singapore': ['Singapore'],
            'Sweden': ['Stockholm'],
            'Norway': ['Oslo'],
            'Denmark': ['Copenhagen'],
            'Italy': ['Milan'],
            'Spain': ['Madrid'],
            'Belgium': ['Brussels'],
            'Austria': ['Vienna'],
            'Poland': ['Warsaw'],
            'Finland': ['Helsinki'],
            'Ireland': ['Dublin']
        });
    }
});

// Change VPN location
app.post('/api/change-location', async (req, res) => {
    try {
        const { country, city } = req.body;
        
        if (!country) {
            return res.status(400).json({ error: 'Country is required' });
        }
        
        const envPath = '/.env';
        let envContent = await fs.readFile(envPath, 'utf-8');

        // Update or add SERVER_COUNTRIES
        if (envContent.match(/^NORD_SERVER_COUNTRIES=/m)) {
            envContent = envContent.replace(/^NORD_SERVER_COUNTRIES=.*/m, `NORD_SERVER_COUNTRIES=${country}`);
        } else {
            envContent += `\nNORD_SERVER_COUNTRIES=${country}`;
        }

        // Update or add SERVER_CITIES if provided
        if (city) {
            if (envContent.match(/^NORD_SERVER_CITIES=/m)) {
                envContent = envContent.replace(/^NORD_SERVER_CITIES=.*/m, `NORD_SERVER_CITIES=${city}`);
            } else {
                envContent += `\nNORD_SERVER_CITIES=${city}`;
            }
        } else {
            // Remove SERVER_CITIES if no city specified
            envContent = envContent.replace(/^NORD_SERVER_CITIES=.*\n?/m, '');
        }

        await fs.writeFile(envPath, envContent);

        const http = require('http');
        const socketPath = '/var/run/docker.sock';
        
        await new Promise((resolve, reject) => {
            const options = {
                socketPath,
                path: '/containers/gluetun/restart',
                method: 'POST'
            };
            
            const req = http.request(options, (res) => {
                if (res.statusCode === 204) {
                    resolve();
                } else {
                    reject(new Error(`Docker API returned ${res.statusCode}`));
                }
            });
            
            req.on('error', reject);
            req.end();
        });


        
        res.json({ 
            success: true, 
            message: `Changing to ${city ? city + ', ' : ''}${country}. Reconnecting...` 
        });
    } catch (error) {
        console.error('Error changing location:', error);
        res.status(500).json({ error: error.message });
    }
});

// Restart VPN
app.post('/api/restart', async (req, res) => {
    try {
        // Stop VPN
        await gluetunFetch('/v1/vpn/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'stopped' })
        });
        
        // Wait a moment
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Start VPN
        await gluetunFetch('/v1/vpn/status', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: 'running' })
        });
        
        res.json({ success: true, message: 'VPN restarting...' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`VPN Controller running on http://0.0.0.0:${PORT}`);
    console.log(`Gluetun API: ${GLUETUN_API}`);
});
