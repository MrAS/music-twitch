import dotenv from 'dotenv';
dotenv.config();

export const config = {
    twitch: {
        username: process.env.TWITCH_USERNAME || '',
        token: process.env.TWITCH_TOKEN || '',
        channel: process.env.TWITCH_CHANNEL || '',
        // Comma-separated list of allowed users (empty = mods only)
        allowedUsers: (process.env.ALLOWED_USERS || '').split(',').map(u => u.trim().toLowerCase()).filter(u => u),
    },
    core: {
        url: process.env.CORE_URL || 'http://localhost:8080',
        username: process.env.CORE_USER || '',
        password: process.env.CORE_PASS || '',
        processId: process.env.CORE_PROCESS_ID || 'twitchplayer',
    },
    system: {
        cacheDir: process.env.CACHE_DIR || './cache',
        allowedCatalogPath: process.env.ALLOWED_CATALOG_PATH || './allowed.json',
        standbyVideo: process.env.STANDBY_VIDEO || '', // Path or URL to loop when queue is empty
    },
    admin: {
        username: process.env.ADMIN_USERNAME || 'admin',
        password: process.env.ADMIN_PASSWORD || 'admin123',
        jwtSecret: process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production',
        port: parseInt(process.env.API_PORT || '3000'),
    }
};
