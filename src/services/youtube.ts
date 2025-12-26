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

// Optional: YouTube cookies file path for bypassing rate limits
const COOKIES_FILE = process.env.YOUTUBE_COOKIES || '';

// Get cookies arguments if file exists
function getCookiesArgs(): string[] {
    if (COOKIES_FILE) {
        if (fs.existsSync(COOKIES_FILE)) {
            logger.info(`Using YouTube cookies from: ${COOKIES_FILE}`);
            return ['--cookies', COOKIES_FILE];
        } else {
            logger.warn(`YouTube cookies file not found: ${COOKIES_FILE}`);
            logger.warn('Proceeding without cookies. You may encounter rate limit errors.');
        }
    }
    return [];
}

// Check if cookies are properly configured
function checkCookiesConfig(): { configured: boolean; valid: boolean; message: string } {
    if (!COOKIES_FILE) {
        return {
            configured: false,
            valid: false,
            message: 'YOUTUBE_COOKIES environment variable not set. Run ./setup-youtube-cookies.sh to configure.'
        };
    }

    if (!fs.existsSync(COOKIES_FILE)) {
        return {
            configured: true,
            valid: false,
            message: `Cookies file not found: ${COOKIES_FILE}. Please export cookies from your browser.`
        };
    }

    return {
        configured: true,
        valid: true,
        message: 'YouTube cookies configured correctly.'
    };
}

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
        return this.getCachedPath(videoId) !== null;
    }

    /**
     * Get cached file path if exists (checks mapping file and legacy formats)
     */
    public getCachedPath(videoId: string): string | null {
        // Check new mapping system first
        const mappingFile = path.resolve(config.system.cacheDir, 'id_mapping.json');
        try {
            if (fs.existsSync(mappingFile)) {
                const mapping = fs.readJsonSync(mappingFile);
                if (mapping[videoId]) {
                    const mappedPath = path.resolve(config.system.cacheDir, mapping[videoId]);
                    if (fs.existsSync(mappedPath)) return mappedPath;
                }
            }
        } catch (e) { }

        // Fall back to legacy yt_VIDEOID format
        const m4aPath = path.resolve(config.system.cacheDir, `yt_${videoId}.m4a`);
        if (fs.existsSync(m4aPath)) return m4aPath;
        const mp4Path = path.resolve(config.system.cacheDir, `yt_${videoId}.mp4`);
        if (fs.existsSync(mp4Path)) return mp4Path;
        return null;
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
                '--no-download',
                '--js-runtimes', 'deno',
                ...getCookiesArgs()
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
                '--no-download',
                '--js-runtimes', 'deno',
                ...getCookiesArgs()
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
     * Get related/suggested videos for a given video ID
     * Uses yt-dlp to fetch YouTube's recommendations
     */
    public async getRelatedVideos(videoId: string, count: number = 5): Promise<YouTubeSearchResult[]> {
        try {
            logger.info(`Fetching related videos for: ${videoId}`);

            // Get related videos using yt-dlp with the video's watch page
            const result = await execa(YT_DLP_PATH, [
                `https://www.youtube.com/watch?v=${videoId}`,
                '--flat-playlist',
                '--dump-json',
                '--no-download',
                '--extractor-args', 'youtube:player_skip=webpage',
                '--playlist-items', `1-${count + 1}`, // Get a few extras in case first is current
                ...getCookiesArgs()
            ]);

            const lines = result.stdout.split('\n').filter(line => line.trim());
            const related: YouTubeSearchResult[] = [];

            for (const line of lines) {
                try {
                    const info = JSON.parse(line);
                    // Skip the original video
                    if (info.id && info.id !== videoId) {
                        related.push({
                            id: info.id,
                            title: info.title || `Video ${info.id}`,
                            url: `https://www.youtube.com/watch?v=${info.id}`,
                            duration: info.duration || 0
                        });
                    }
                    if (related.length >= count) break;
                } catch (e) {
                    // Skip invalid JSON lines
                }
            }

            logger.info(`Found ${related.length} related videos`);
            return related;
        } catch (error) {
            logger.error('Failed to get related videos', error);
            return [];
        }
    }

    /**
     * Download a YouTube video by URL and return the file path
     * Downloads audio-only (M4A) to avoid merge issues.
     * Files are named with incrementing numbers and song titles.
     */
    public async download(videoId: string, url: string): Promise<string> {
        // Get video title
        const title = this.lastSearchResults.find(r => r.id === videoId)?.title || videoId;

        // Sanitize title for filename (remove invalid characters)
        const sanitizedTitle = title
            .replace(/[<>:"/\\|?*]/g, '') // Remove invalid file chars
            .replace(/\s+/g, ' ')          // Normalize whitespace
            .trim()
            .substring(0, 80);             // Limit length

        // Get next number by counting existing files
        const existingFiles = fs.readdirSync(config.system.cacheDir)
            .filter(f => f.match(/^\d+-/) && (f.endsWith('.m4a') || f.endsWith('.mp4')));
        const nextNum = existingFiles.length + 1;

        // Create filename: "1-Song Title.m4a"
        const filename = `${nextNum}-${sanitizedTitle}.m4a`;
        const filePath = path.resolve(config.system.cacheDir, filename);

        // Store mapping of videoId to filename for cache lookups
        const mappingFile = path.resolve(config.system.cacheDir, 'id_mapping.json');
        let mapping: Record<string, string> = {};
        try {
            if (fs.existsSync(mappingFile)) {
                mapping = fs.readJsonSync(mappingFile);
            }
        } catch (e) { }

        // Check if this video is already downloaded
        if (mapping[videoId] && fs.existsSync(path.resolve(config.system.cacheDir, mapping[videoId]))) {
            const cachedPath = path.resolve(config.system.cacheDir, mapping[videoId]);
            logger.info(`YouTube audio cached: ${cachedPath}`);
            return cachedPath;
        }

        logger.info(`Downloading YouTube audio: ${title} -> ${filename}`);

        // Import progress tracker
        const { progressTracker } = require('./progress');
        progressTracker.start(title);

        try {
            // Download audio-only (no merge needed, much more reliable)
            const subprocess = execa(YT_DLP_PATH, [
                '-f', 'bestaudio[ext=m4a]/bestaudio/best',
                '-o', filePath,
                '--no-playlist',
                '--newline',  // Important for progress parsing
                '--js-runtimes', 'deno',
                ...getCookiesArgs(),
                url
            ]);

            // Parse stdout for progress
            subprocess.stdout?.on('data', (data: Buffer) => {
                const line = data.toString();
                progressTracker.parseYtDlpOutput(line);
            });

            await subprocess;

            // Save mapping
            mapping[videoId] = filename;
            fs.writeJsonSync(mappingFile, mapping);

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
