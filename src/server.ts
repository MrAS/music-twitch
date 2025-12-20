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
