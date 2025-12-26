import express from 'express';
import cors from 'cors';
import path from 'path';
import jwt from 'jsonwebtoken';
import { config } from './config';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

// Types
export interface AppServices {
    catalog: any;
    queue: any;
    youtube: any;
    restreamer: any;
    streamer: any;
    twitchBot: any;
}

let services: AppServices;

export function setServices(s: AppServices) {
    services = s;
}

export function getServices(): AppServices {
    return services;
}

// JWT Auth Middleware
export function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    try {
        const decoded = jwt.verify(token, config.admin.jwtSecret);
        (req as any).user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
}

export function createServer(): express.Application {
    const app = express();

    app.use(cors());
    app.use(express.json());

    // Auth routes (no auth required)
    app.post('/api/admin/login', (req, res) => {
        const { username, password } = req.body;

        if (username === config.admin.username && password === config.admin.password) {
            const token = jwt.sign({ username }, config.admin.jwtSecret, { expiresIn: '24h' });
            res.json({ token, username });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    });

    // SSE endpoint for live download progress (no auth for simplicity)
    app.get('/api/admin/progress', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        // Import progress tracker dynamically to avoid circular deps
        const { progressTracker } = require('./services/progress');

        // Send current state immediately
        res.write(`data: ${JSON.stringify(progressTracker.getCurrent())}\n\n`);

        // Listen for updates
        const onProgress = (data: any) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        progressTracker.on('progress', onProgress);

        // Clean up on disconnect
        req.on('close', () => {
            progressTracker.off('progress', onProgress);
        });
    });

    // SSE endpoint for all real-time insights (download, stream, queue, system events)
    app.get('/api/admin/insights', (req, res) => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();

        const { insightsTracker } = require('./services/progress');

        // Send recent insights history on connect
        const recentInsights = insightsTracker.getRecentInsights();
        for (const insight of recentInsights.slice(-20)) {
            res.write(`data: ${JSON.stringify(insight)}\n\n`);
        }

        // Listen for new insights
        const onInsight = (data: any) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        insightsTracker.on('insight', onInsight);

        // Clean up on disconnect
        req.on('close', () => {
            insightsTracker.off('insight', onInsight);
        });
    });

    // Protected routes
    app.use('/api/admin', authMiddleware);

    // Status endpoint
    app.get('/api/admin/status', async (req, res) => {
        try {
            const { queue, twitchBot, restreamer } = getServices();
            res.json({
                botConnected: twitchBot?.isConnected() || false,
                currentPlaying: queue?.getCurrent() || null,
                queueLength: queue?.getQueue()?.length || 0,
                coreReachable: true // TODO: ping core
            });
        } catch (error) {
            res.status(500).json({ error: 'Failed to get status' });
        }
    });

    // Playlist streaming endpoints
    app.post('/api/admin/playlist/start', async (req, res) => {
        const { streamer } = getServices();
        try {
            await streamer.streamPlaylist();
            res.json({ success: true, message: 'Playlist streaming started' });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/admin/playlist/add', async (req, res) => {
        const { filePath } = req.body;
        const { streamer } = getServices();

        if (!filePath) {
            return res.status(400).json({ error: 'filePath required' });
        }

        streamer.addToPlaylist(filePath);
        res.json({ success: true, added: filePath });
    });

    app.post('/api/admin/playlist/write', async (req, res) => {
        const { files } = req.body;
        const { streamer } = getServices();

        if (!files || !Array.isArray(files)) {
            return res.status(400).json({ error: 'files array required' });
        }

        streamer.writePlaylist(files);
        res.json({ success: true, count: files.length });
    });

    // Queue endpoints
    app.get('/api/admin/queue', (req, res) => {
        const { queue } = getServices();
        res.json({
            current: queue.getCurrent(),
            queue: queue.getQueue()
        });
    });

    app.post('/api/admin/queue', (req, res) => {
        const { key, user = 'Admin' } = req.body;
        const { queue, catalog } = getServices();
        const item = catalog.getByKey(key);
        if (!item) {
            return res.status(404).json({ error: 'Item not found in catalog' });
        }
        queue.enqueue(item, user);
        res.json({ success: true, item });
    });

    app.delete('/api/admin/queue/:index', (req, res) => {
        const { queue } = getServices();
        const index = parseInt(req.params.index);
        const q = queue.getQueue();
        if (index >= 0 && index < q.length) {
            q.splice(index, 1);
            res.json({ success: true });
        } else {
            res.status(400).json({ error: 'Invalid index' });
        }
    });

    app.delete('/api/admin/queue', async (req, res) => {
        const { queue } = getServices();
        await queue.stop();
        res.json({ success: true });
    });

    app.post('/api/admin/queue/skip', async (req, res) => {
        const { queue } = getServices();
        await queue.skip();
        res.json({ success: true });
    });

    // Catalog endpoints
    app.get('/api/admin/allowed', (req, res) => {
        const { catalog } = getServices();
        res.json(catalog.getAll());
    });

    app.post('/api/admin/allowed', (req, res) => {
        const { catalog } = getServices();
        const { key, title, source } = req.body;
        if (!key || !title || !source) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        catalog.addItem({ key, title, source });
        res.json({ success: true });
    });

    app.put('/api/admin/allowed/:key', (req, res) => {
        const { catalog } = getServices();
        const { key } = req.params;
        const updates = req.body;
        catalog.updateItem(key, updates);
        res.json({ success: true });
    });

    app.delete('/api/admin/allowed/:key', (req, res) => {
        const { catalog } = getServices();
        catalog.deleteItem(req.params.key);
        res.json({ success: true });
    });

    // Cache endpoints
    app.get('/api/admin/cache', async (req, res) => {
        const fs = await import('fs-extra');
        const cacheDir = config.system.cacheDir;
        try {
            const files = await fs.readdir(cacheDir);
            const fileStats = await Promise.all(
                files.map(async (file: string) => {
                    const filePath = path.join(cacheDir, file);
                    const stats = await fs.stat(filePath);
                    return {
                        name: file,
                        size: stats.size,
                        modified: stats.mtime
                    };
                })
            );
            res.json(fileStats);
        } catch (error) {
            res.json([]);
        }
    });

    app.delete('/api/admin/cache/:filename', async (req, res) => {
        const fs = await import('fs-extra');
        const filePath = path.join(config.system.cacheDir, req.params.filename);
        try {
            await fs.remove(filePath);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to delete file' });
        }
    });

    app.delete('/api/admin/cache', async (req, res) => {
        const fs = await import('fs-extra');
        try {
            await fs.emptyDir(config.system.cacheDir);
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to clear cache' });
        }
    });

    // Play a local file from cache
    app.post('/api/admin/cache/:filename/play', async (req, res) => {
        const fs = await import('fs-extra');
        const { queue } = getServices();
        const filePath = path.resolve(config.system.cacheDir, req.params.filename);

        if (!await fs.pathExists(filePath)) {
            return res.status(404).json({ error: 'File not found' });
        }

        // Create a temporary item to enqueue
        const item = {
            key: req.params.filename,
            title: req.params.filename.replace(/\.[^/.]+$/, ''), // Remove extension
            source: {
                type: 'local_file' as const,
                path: filePath
            }
        };

        queue.enqueue(item, 'Admin');
        res.json({ success: true, title: item.title });
    });

    // Quality settings endpoints
    app.get('/api/admin/quality', (req, res) => {
        const { streamer } = getServices();
        res.json({
            current: streamer.getQuality(),
            presets: streamer.getPresets()
        });
    });

    app.post('/api/admin/quality', (req, res) => {
        const { streamer } = getServices();
        const { quality } = req.body;
        if (!quality) {
            return res.status(400).json({ error: 'Quality preset required' });
        }
        const success = streamer.setQuality(quality);
        if (success) {
            res.json({ success: true, current: quality });
        } else {
            res.status(400).json({ error: 'Invalid quality preset' });
        }
    });

    // Video Mode endpoints
    app.get('/api/admin/videomode', (req, res) => {
        const { streamer } = getServices();
        res.json({ enabled: !streamer.isAudioOnly() });
    });

    app.post('/api/admin/videomode/enable', (req, res) => {
        const { streamer } = getServices();
        streamer.setAudioOnly(false);
        res.json({ success: true, enabled: true });
    });

    app.post('/api/admin/videomode/disable', (req, res) => {
        const { streamer } = getServices();
        streamer.setAudioOnly(true);
        res.json({ success: true, enabled: false });
    });

    // Thumbnail Stream endpoints (use YouTube thumbnail as stream background)
    app.get('/api/admin/thumbnail-stream', (req, res) => {
        const { streamer } = getServices();
        res.json({ enabled: streamer.getUseThumbnail() });
    });

    app.post('/api/admin/thumbnail-stream/enable', (req, res) => {
        const { streamer } = getServices();
        streamer.setUseThumbnail(true);
        res.json({ success: true, enabled: true });
    });

    app.post('/api/admin/thumbnail-stream/disable', (req, res) => {
        const { streamer } = getServices();
        streamer.setUseThumbnail(false);
        res.json({ success: true, enabled: false });
    });

    // Cover image settings endpoints
    app.get('/api/admin/cover', (req, res) => {
        const { streamer } = getServices();
        res.json({
            coverImage: streamer.getCoverImage() || null
        });
    });

    app.post('/api/admin/cover', (req, res) => {
        const { streamer } = getServices();
        const { coverImage } = req.body;

        // Allow clearing the cover image with empty string or null
        const imagePath = coverImage || '';
        const success = streamer.setCoverImage(imagePath);

        if (success || !imagePath) {
            res.json({ success: true, coverImage: imagePath || null });
        } else {
            res.status(400).json({ error: 'Cover image file not found' });
        }
    });

    // ===== YouTube Search & Play Endpoints =====
    app.post('/api/admin/youtube/search', async (req, res) => {
        const { query, limit = 10 } = req.body;
        const { youtube } = getServices();

        if (!query) {
            return res.status(400).json({ error: 'Query required' });
        }

        try {
            const results = await youtube.searchMultiple(query, limit);
            // Add cached status to each result
            const resultsWithStatus = results.map((r: any) => ({
                ...r,
                cached: youtube.isCached(r.id)
            }));
            res.json({ results: resultsWithStatus });
        } catch (error: any) {
            res.status(500).json({ error: error.message || 'Search failed' });
        }
    });

    app.post('/api/admin/youtube/play', async (req, res) => {
        const { videoId, url, title } = req.body;
        const { queue, youtube, twitchBot } = getServices();

        if (!videoId || !url) {
            return res.status(400).json({ error: 'videoId and url required' });
        }

        try {
            const filePath = await youtube.ensureDownloaded(videoId, url);
            queue.enqueue({
                key: `yt_${videoId}`,
                title: title || videoId,
                source: { type: 'local_file', path: filePath }
            }, 'Admin (Web)');

            // Notify Twitch chat
            if (twitchBot && twitchBot.sendMessage) {
                twitchBot.sendMessage(`🎵 Now queued: ${title || videoId} (via Web)`);
            }

            res.json({ success: true, title });
        } catch (error: any) {
            res.status(500).json({ error: error.message || 'Failed to play' });
        }
    });

    app.post('/api/admin/queue/add', (req, res) => {
        const { path, title } = req.body;
        const { queue, twitchBot } = getServices();

        if (!path || !title) {
            return res.status(400).json({ error: 'path and title required' });
        }

        queue.enqueue({
            key: `cache_${Date.now()}`,
            title: title,
            source: { type: 'local_file', path: path }
        }, 'Admin (Web)');

        // Notify Twitch chat
        if (twitchBot && twitchBot.sendMessage) {
            twitchBot.sendMessage(`🎵 Queued: ${title} (via Web)`);
        }

        res.json({ success: true, title });
    });

    app.post('/api/admin/queue/remove', (req, res) => {
        const { index } = req.body;
        const { queue } = getServices();

        if (typeof index !== 'number') {
            return res.status(400).json({ error: 'Index required' });
        }

        const success = queue.removeFromQueue(index);
        res.json({ success });
    });

    // AI Playlist endpoints
    app.post('/api/admin/playlist/generate', async (req, res) => {
        const { description, count = 5, mode = 'shuffle' } = req.body;
        if (!description) {
            return res.status(400).json({ error: 'Description required' });
        }

        try {
            const { AIPlaylistService } = await import('./services/aiplaylist');
            const aiPlaylist = new AIPlaylistService();
            const playlist = await aiPlaylist.generatePlaylist({
                description,
                count: Math.min(count, 10),
                mode
            });
            res.json(playlist);
        } catch (error: any) {
            res.status(500).json({ error: error.message || 'Failed to generate playlist' });
        }
    });

    // Play YouTube URL directly
    app.post('/api/admin/play/url', async (req, res) => {
        const { url } = req.body;
        const { queue, youtube } = getServices();

        if (!url) {
            return res.status(400).json({ error: 'URL required' });
        }

        try {
            // Extract video ID from URL or search for it
            let result;
            if (url.includes('youtube.com') || url.includes('youtu.be')) {
                // Extract video ID from URL
                const videoIdMatch = url.match(/(?:v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
                if (videoIdMatch) {
                    result = {
                        id: videoIdMatch[1],
                        url: `https://www.youtube.com/watch?v=${videoIdMatch[1]}`,
                        title: `YouTube Video ${videoIdMatch[1]}`
                    };
                }
            }

            // If not a direct URL, search for it
            if (!result) {
                result = await youtube.search(url);
            }

            if (!result) {
                return res.status(404).json({ error: 'Video not found' });
            }

            // Download and queue
            const filePath = await youtube.ensureDownloaded(result.id, result.url);
            queue.enqueue({
                key: `yt_${result.id}`,
                title: result.title,
                source: { type: 'local_file', path: filePath }
            }, 'Admin (Web)');

            res.json({ success: true, title: result.title, id: result.id });
        } catch (error: any) {
            res.status(500).json({ error: error.message || 'Failed to play URL' });
        }
    });

    app.post('/api/admin/playlist/queue', async (req, res) => {
        const { songs } = req.body;
        const { queue, youtube } = getServices();

        if (!songs || !Array.isArray(songs)) {
            return res.status(400).json({ error: 'Songs array required' });
        }

        let queued = 0;
        for (const song of songs.slice(0, 10)) {
            try {
                const result = await youtube.search(song.searchQuery);
                if (result) {
                    const filePath = await youtube.ensureDownloaded(result.id, result.url);
                    queue.enqueue({
                        key: `yt_${result.id}`,
                        title: result.title,
                        source: { type: 'local_file', path: filePath }
                    }, 'Admin (AI Playlist)');
                    queued++;
                }
            } catch (err) {
                // Continue with next song
            }
        }

        res.json({ success: true, queued });
    });

    // Auto-playlist endpoints
    app.get('/api/admin/autoplaylist', (req, res) => {
        const { queue } = getServices();
        res.json(queue.getAutoPlaylistInfo());
    });

    app.post('/api/admin/autoplaylist/enable', (req, res) => {
        const { queue, youtube } = getServices();
        const { description, songsPerBatch = 3 } = req.body;

        if (!description) {
            return res.status(400).json({ error: 'Description required' });
        }

        // Set YouTube service reference
        queue.setYouTubeService(youtube);
        queue.enableAutoPlaylist(description, songsPerBatch);
        res.json({ success: true, description, songsPerBatch });
    });

    app.post('/api/admin/autoplaylist/disable', (req, res) => {
        const { queue } = getServices();
        queue.disableAutoPlaylist();
        res.json({ success: true });
    });

    // YouTube suggestions mode endpoints
    app.post('/api/admin/suggestions/enable', (req, res) => {
        const { queue, youtube } = getServices();
        queue.setYouTubeService(youtube);
        queue.enableYouTubeSuggestions();
        res.json({ success: true, message: 'YouTube suggestions enabled' });
    });

    app.post('/api/admin/suggestions/disable', (req, res) => {
        const { queue } = getServices();
        queue.disableYouTubeSuggestions();
        res.json({ success: true, message: 'YouTube suggestions disabled' });
    });

    app.get('/api/admin/suggestions', (req, res) => {
        const { queue } = getServices();
        res.json({
            enabled: queue.isYouTubeSuggestionsEnabled(),
            autoPlaylistInfo: queue.getAutoPlaylistInfo()
        });
    });

    // Twitch logs
    app.get('/api/admin/twitch/logs', (req, res) => {
        const { twitchBot } = getServices();
        res.json(twitchBot?.getLogs() || []);
    });

    // Core controls
    app.post('/api/admin/core/start', async (req, res) => {
        const { restreamer } = getServices();
        try {
            await restreamer.startProcess();
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to start process' });
        }
    });

    app.post('/api/admin/core/stop', async (req, res) => {
        const { restreamer } = getServices();
        try {
            await restreamer.cancelProcess();
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to stop process' });
        }
    });

    app.post('/api/admin/core/restart', async (req, res) => {
        const { restreamer } = getServices();
        try {
            await restreamer.cancelProcess();
            await new Promise(resolve => setTimeout(resolve, 1000));
            await restreamer.startProcess();
            res.json({ success: true });
        } catch (error) {
            res.status(500).json({ error: 'Failed to restart process' });
        }
    });

    // Update endpoints
    const { exec } = require('child_process');
    const execPromise = (cmd: string): Promise<string> => {
        return new Promise((resolve, reject) => {
            exec(cmd, { cwd: path.join(__dirname, '..'), maxBuffer: 10 * 1024 * 1024 }, (err: any, stdout: string, stderr: string) => {
                if (err) reject(new Error(stderr || err.message));
                else resolve(stdout + (stderr ? `\n${stderr}` : ''));
            });
        });
    };

    app.post('/api/admin/update/pull', async (req, res) => {
        try {
            const output = await execPromise('git pull origin master');
            res.json({ success: true, output });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/admin/update/build', async (req, res) => {
        try {
            const output = await execPromise('npm run build');
            res.json({ success: true, output });
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    app.post('/api/admin/update/full', async (req, res) => {
        try {
            let output = '';
            output += '=== Git Pull ===\n';
            output += await execPromise('git pull origin master');
            output += '\n\n=== NPM Build ===\n';
            output += await execPromise('npm run build');
            res.json({ success: true, output, restart: 'Process will restart shortly. Refresh the page in a few seconds.' });

            // Give time for response to be sent, then exit (PM2 will restart)
            setTimeout(() => {
                process.exit(0);
            }, 1000);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    });

    // Serve static files from web/dist in production
    const webDistPath = path.join(__dirname, '../web/dist');
    app.use(express.static(webDistPath));

    // Catch-all route for SPA - serve index.html for non-API routes
    app.use((req, res, next) => {
        if (req.path.startsWith('/api/')) return next();
        res.sendFile(path.join(webDistPath, 'index.html'));
    });

    return app;
}
