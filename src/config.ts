import dotenv from 'dotenv';
dotenv.config();

export const config = {
    twitch: {
        username: process.env.TWITCH_USERNAME || '',
        token: process.env.TWITCH_TOKEN || '',
        channel: process.env.TWITCH_CHANNEL || '',
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
    }
};
