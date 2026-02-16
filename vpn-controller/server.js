const express = require('express');
const fetch = require('node-fetch');
const fs = require('fs').promises;

const app = express();
const PORT = 3000;
const GLUETUN_API = process.env.GLUETUN_API || 'http://gluetun:8000';
const GLUETUN_AUTH = process.env.GLUETUN_AUTH || null;
const REQUIRE_AUTH = process.env.REQUIRE_AUTH === 'true';

app.use(express.json());

// Basic auth middleware
function requireAuth(req, res, next) {
  if (!REQUIRE_AUTH) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const credentials = Buffer.from(authHeader.split(' ')[1], 'base64').toString();
  if (GLUETUN_AUTH && credentials !== GLUETUN_AUTH) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  next();
}

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

  const text = await response.text();
  
  // Handle different response types
  if (response.status === 401) {
    throw new Error('Unauthorized: Invalid Gluetun credentials');
  }
  
  if (!response.ok) {
    throw new Error(`Gluetun API error: ${response.status} ${response.statusText}`);
  }

  // Check if response is just plain text (like "running")
  if (text && !text.startsWith('{') && !text.startsWith('[')) {
    return { message: text.trim() };
  }

  // Try to parse JSON
  try {
    return JSON.parse(text);
  } catch {
    return { message: text || 'Success' };
  }
}

// Get current VPN status
app.get('/api/status', requireAuth, async (req, res) => {
  try {
    const [publicIp, vpnStatus, realIp] = await Promise.all([
      gluetunFetch('/v1/publicip/ip'),
      gluetunFetch('/v1/vpn/status'),
      fetch('https://ifconfig.co/json').then(r => r.json()).catch(() => null)
    ]);
    

    res.json({
      connected: vpnStatus.status === 'running' || vpnStatus.message === 'running',
      publicIp: publicIp.public_ip,
      country: publicIp.country,
      region: publicIp.region,
      city: publicIp.city,
      status: vpnStatus.status || vpnStatus.message,
      realIp: realIp ? {
        ip: realIp.ip,
        country: realIp.country,
        city: realIp.city
      } : null
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get available servers from servers.json
app.get('/api/servers', requireAuth, async (req, res) => {
  try {
    const serversPath = process.env.SERVERS_PATH || '/gluetun/servers.json';
    const serversData = await fs.readFile(serversPath, 'utf-8');
    const servers = JSON.parse(serversData);

    // Get NordVPN servers from the correct structure
    const nordvpnData = servers.nordvpn || {};
    const nordvpnServers = nordvpnData.servers || [];
    
    // Filter only WireGuard servers
    const wireguardServers = nordvpnServers.filter(server => 
      server.vpn === 'wireguard'
    );

    const countriesMap = new Map();

    wireguardServers.forEach(server => {
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

    console.log(`Loaded ${wireguardServers.length} WireGuard servers from ${Object.keys(result).length} countries`);
    
    res.json(result);
  } catch (error) {
    console.error('Error reading servers.json:', error);
    // Fallback to common NordVPN locations
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
      'Singapore': ['Singapore']
    });
  }
});

// Change VPN location
app.post('/api/change-location', requireAuth, async (req, res) => {
  try {
    const { country, city } = req.body;

    // Get current settings
    const currentSettings = await gluetunFetch('/v1/vpn/settings', { method: 'GET' });

    // Store original values for comparison
    const originalCountries = currentSettings.provider.server_selection.countries || [];
    const originalCities = currentSettings.provider.server_selection.cities || [];
    
    const newCountries = [country];
    const newCities = city ? [city] : [];

    // Check if settings actually changed
    const settingsChanged = 
      JSON.stringify(originalCountries) !== JSON.stringify(newCountries) ||
      JSON.stringify(originalCities) !== JSON.stringify(newCities);

    if (!settingsChanged) {
      return res.json({
        success: true,
        noChange: true,
        message: `Already connected to ${country}${city ? ', ' + city : ''}. No change needed.`
      });
    }

    // Modify settings
    currentSettings.provider.server_selection.countries = newCountries;
    currentSettings.provider.server_selection.cities = newCities;

    // Update settings
    const updateResponse = await gluetunFetch('/v1/vpn/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(currentSettings)
    });

    // Check if Gluetun returned "running" or similar
    const responseMsg = updateResponse.message || updateResponse.status || 'updated';
    
    res.json({
      success: true,
      changed: true,
      message: `Location updated to ${country}${city ? ', ' + city : ''}. ${responseMsg === 'running' ? 'VPN is reconnecting.' : 'Settings applied.'}`,
      gluetunResponse: responseMsg
    });

  } catch (error) {
    console.error('Update Failed:', error);
    
    if (error.message.includes('Unauthorized')) {
      return res.status(401).json({ error: 'Unauthorized: Check Gluetun API credentials' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Get all raw settings as JSON
app.get('/api/settings/raw', requireAuth, async (req, res) => {
  try {
    const rawSettings = await gluetunFetch('/v1/vpn/settings');
    res.header("Content-Type", 'application/json');
    res.send(JSON.stringify(rawSettings, null, 4));
  } catch (error) {
    console.error('Error fetching raw settings:', error);
    
    if (error.message.includes('Unauthorized')) {
      return res.status(401).json({ error: 'Unauthorized: Check Gluetun API credentials' });
    }
    
    res.status(500).json({ 
      error: "Could not fetch settings from Gluetun",
      details: error.message 
    });
  }
});

// Get current settings (formatted)
app.get('/api/settings', requireAuth, async (req, res) => {
  try {
    const settings = await gluetunFetch('/v1/vpn/settings');
    
    res.json({
      provider: settings.provider?.name,
      countries: settings.provider?.server_selection?.countries || [],
      cities: settings.provider?.server_selection?.cities || [],
      protocol: settings.provider?.port_forwarding?.enabled ? 'With Port Forwarding' : 'Standard'
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    
    if (error.message.includes('Unauthorized')) {
      return res.status(401).json({ error: 'Unauthorized: Check Gluetun API credentials' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Restart VPN
app.post('/api/restart', requireAuth, async (req, res) => {
  try {
    await gluetunFetch('/v1/vpn/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' })
    });

    await new Promise(resolve => setTimeout(resolve, 1000));

    await gluetunFetch('/v1/vpn/status', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'running' })
    });

    res.json({ success: true, message: 'VPN restarting...' });
  } catch (error) {
    if (error.message.includes('Unauthorized')) {
      return res.status(401).json({ error: 'Unauthorized: Check Gluetun API credentials' });
    }
    
    res.status(500).json({ error: error.message });
  }
});

// Start server with graceful shutdown
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`VPN Controller running on http://0.0.0.0:${PORT}`);
  console.log(`Gluetun API: ${GLUETUN_API}`);
  console.log(`Authentication: ${REQUIRE_AUTH ? 'ENABLED' : 'DISABLED'}`);
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown() {
  console.log('\nReceived shutdown signal, closing server gracefully...');
  
  server.close(() => {
    console.log('Server closed. Exiting process.');
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}
