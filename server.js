require('dotenv').config();
const express = require('express');
const { Rcon } = require('rcon-client');
const fs = require('fs');
const path = require('path');
const basicAuth = require('express-basic-auth');
const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

// Basic Authentication
const users = {
    [process.env.ADMIN_USERNAME]: process.env.ADMIN_PASSWORD
};

app.use(basicAuth({
    users: users,
    challenge: true,
    realm: 'Minecraft Server Control Panel'
}));

app.use(express.static('public'));

// RCON configuration
const config = {
    host: process.env.RCON_HOST,
    port: parseInt(process.env.RCON_PORT),
    password: process.env.RCON_PASSWORD,
    modsPath: process.env.MODS_PATH,
    serverPath: process.env.SERVER_PATH
};

let rcon = null;
let serverStats = {
    players: 0,
    maxPlayers: 0,
    tps: 20,
    uptime: 0,
    mods: []
};

async function connectRcon() {
    if (rcon === null || !rcon.connected) {
        rcon = await Rcon.connect({
            host: config.host,
            port: config.port,
            password: config.password
        });
        console.log('RCON authenticated');
    }
    return rcon;
}

async function getMaxPlayers() {
    try {
        const propertiesPath = path.join(config.serverPath || '.', 'server.properties');
        if (fs.existsSync(propertiesPath)) {
            const content = fs.readFileSync(propertiesPath, 'utf8');
            const maxPlayersMatch = content.match(/max-players=(\d+)/);
            if (maxPlayersMatch) {
                return parseInt(maxPlayersMatch[1]);
            }
        }
        
        const rcon = await connectRcon();
        const response = await rcon.send('list');
        const match = response.match(/\d+\/(\d+)/);
        if (match) {
            return parseInt(match[1]);
        }
    } catch (error) {
        console.error('Error getting max players:', error);
    }
    return 20;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function updateServerStats() {
    try {
        const rcon = await connectRcon();
        
        const listResponse = await rcon.send('list');
        const playerMatch = listResponse.match(/There are (\d+)\/(\d+) players online/);
        if (playerMatch) {
            serverStats.players = parseInt(playerMatch[1]);
            serverStats.maxPlayers = parseInt(playerMatch[2]);
        } else {
            serverStats.maxPlayers = await getMaxPlayers();
        }

        try {
            const tpsResponse = await rcon.send('tps');
            const tpsMatch = tpsResponse.match(/\d+\.\d+/);
            if (tpsMatch) {
                serverStats.tps = parseFloat(tpsMatch[0]);
            }
        } catch (e) {
            serverStats.tps = 20;
        }

        try {
            const modsDir = config.modsPath;
            if (fs.existsSync(modsDir)) {
                serverStats.mods = fs.readdirSync(modsDir)
                    .filter(file => file.endsWith('.jar'))
                    .map(file => ({
                        name: file.replace('.jar', ''),
                        size: formatBytes(fs.statSync(path.join(modsDir, file)).size)
                    }));
            }
        } catch (e) {
            console.error('Error reading mods:', e);
        }

    } catch (error) {
        console.error('Error updating server stats:', error);
        rcon = null;
    }
}

app.get('/api/stats', async (req, res) => {
    try {
        await updateServerStats();
        res.json(serverStats);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/command', async (req, res) => {
    const { command } = req.body;
    
    if (!command) {
        return res.status(400).json({ success: false, error: 'No command provided' });
    }

    try {
        const rcon = await connectRcon();
        const response = await rcon.send(command);
        res.json({ success: true, response });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Validate required environment variables
const requiredEnvVars = [
    'ADMIN_USERNAME',
    'ADMIN_PASSWORD',
    'RCON_HOST',
    'RCON_PORT',
    'RCON_PASSWORD',
    'MODS_PATH',
    'SERVER_PATH'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingEnvVars.length > 0) {
    console.error('Missing required environment variables:', missingEnvVars.join(', '));
    process.exit(1);
}

// Start server
app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
    updateServerStats(); // Initial stats update
    setInterval(updateServerStats, 5000); // Update every 5 seconds
});
