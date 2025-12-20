import path from 'path';
import fs from 'fs-extra';
import execa from 'execa';
import { config } from '../config';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

// Use YT_DLP_PATH env var or default to system 'yt-dlp'
const YT_DLP_PATH = process.env.YT_DLP_PATH || 'yt-dlp';

export interface YouTubeSearchResult {
    id: string;
    title: string;
    url: string;
    duration: number;
}

export class YouTubeService {
    private lastSearchResults: YouTubeSearchResult[] = [];

    constructor() {
        fs.ensureDirSync(config.system.cacheDir);
    }

    /**
     * Get the last search results for selection
     */
    public getLastSearchResults(): YouTubeSearchResult[] {
        return this.lastSearchResults;
    }

    /**
     * Check if a video is already cached
     */
    public isCached(videoId: string): boolean {
        const filename = `yt_${videoId}.mp4`;
        const filePath = path.resolve(config.system.cacheDir, filename);
        return fs.existsSync(filePath);
    }

    /**
     * Get cached file path if exists
     */
    public getCachedPath(videoId: string): string | null {
        const filename = `yt_${videoId}.mp4`;
        const filePath = path.resolve(config.system.cacheDir, filename);
        return fs.existsSync(filePath) ? filePath : null;
    }

    /**
     * Search YouTube for a query and return up to 10 results
     */
    public async searchMultiple(query: string, count: number = 10): Promise<YouTubeSearchResult[]> {
        try {
            logger.info(`Searching YouTube for: ${query} (${count} results)`);

            // Use yt-dlp to search YouTube
            const result = await execa(YT_DLP_PATH, [
                `ytsearch${count}:${query}`,
                '--dump-json',
                '--flat-playlist',
                '--no-download'
            ]);

            // Parse multiple JSON objects (one per line)
            const lines = result.stdout.trim().split('\n');
            const results = lines.map(line => {
                const info = JSON.parse(line);
                return {
                    id: info.id,
                    title: info.title,
                    url: `https://www.youtube.com/watch?v=${info.id}`,
                    duration: info.duration || 0
                };
            });

            // Store for later selection
            this.lastSearchResults = results;
            return results;
        } catch (error) {
            logger.error('YouTube search failed', error);
            return [];
        }
    }

    /**
     * Search YouTube for a query and return the first result
     */
    public async search(query: string): Promise<YouTubeSearchResult | null> {
        try {
            logger.info(`Searching YouTube for: ${query}`);

            const result = await execa(YT_DLP_PATH, [
                `ytsearch1:${query}`,
                '--dump-json',
                '--no-playlist',
                '--no-download'
            ]);

            const info = JSON.parse(result.stdout);

            return {
                id: info.id,
                title: info.title,
                url: `https://www.youtube.com/watch?v=${info.id}`,
                duration: info.duration || 0
            };
        } catch (error) {
            logger.error('YouTube search failed', error);
            return null;
        }
    }

    /**
     * Download a YouTube video by URL and return the file path
     */
    public async download(videoId: string, url: string): Promise<string> {
        const filename = `yt_${videoId}.mp4`;
        const filePath = path.resolve(config.system.cacheDir, filename);

        // Check if already cached
        if (fs.existsSync(filePath)) {
            logger.info(`YouTube video cached: ${filePath}`);
            return filePath;
        }

        logger.info(`Downloading YouTube video: ${url}`);

        // Import progress tracker
        const { progressTracker } = require('./progress');

        // Get video title for progress display
        const title = this.lastSearchResults.find(r => r.id === videoId)?.title || videoId;
        progressTracker.start(title);

        try {
            // Use execa with pipe to track progress
            const subprocess = execa(YT_DLP_PATH, [
                '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                '-o', filePath,
                '--no-playlist',
                '--newline',  // Important for progress parsing
                url
            ]);

            // Parse stdout for progress
            subprocess.stdout?.on('data', (data: Buffer) => {
                const line = data.toString();
                progressTracker.parseYtDlpOutput(line);
            });

            await subprocess;

            progressTracker.complete();
            logger.info(`Download complete: ${filePath}`);
            return filePath;
        } catch (error) {
            progressTracker.error('Download failed');
            logger.error('YouTube download failed', error);
            throw error;
        }
    }

    /**
     * Ensure a video is downloaded (from cache or fresh download)
     */
    public async ensureDownloaded(videoId: string, url: string): Promise<string> {
        const cached = this.getCachedPath(videoId);
        if (cached) {
            logger.info(`Using cached video: ${cached}`);
            return cached;
        }
        return this.download(videoId, url);
    }
}
