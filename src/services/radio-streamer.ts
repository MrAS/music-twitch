import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import https from 'https';
import winston from 'winston';
import { config } from '../config';
import { insightsTracker } from './progress';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

// Paths
const FFMPEG_PATH = process.env.FFMPEG_PATH
    ? path.join(process.env.FFMPEG_PATH, 'ffmpeg.exe')
    : 'ffmpeg';
const PLAYLIST_FILE = path.join(config.system.cacheDir, 'radio_playlist.txt');
const CURRENT_TITLE_FILE = path.join(config.system.cacheDir, 'current_title.txt');
const CURRENT_THUMBNAIL_FILE = path.join(config.system.cacheDir, 'current_thumbnail.jpg');
const ID_MAPPING_FILE = path.join(config.system.cacheDir, 'id_mapping.json');
const DEFAULT_THUMBNAIL = path.join(config.system.cacheDir, 'default_thumbnail.jpg');

export interface RadioSettings {
    rtmpUrl: string;
    enabled: boolean;
}

/**
 * 24/7 Radio Streamer
 * Uses FFmpeg concat demuxer for continuous audio
 * Dynamic title overlay that reloads from file
 * Per-song thumbnail updates
 */
export class RadioStreamer {
    private ffmpegProcess: ChildProcess | null = null;
    private rtmpUrl: string;
    private isRunning: boolean = false;
    private currentSongIndex: number = 0;
    private songQueue: { path: string; title: string; videoId?: string }[] = [];

    constructor() {
        this.rtmpUrl = process.env.RTMP_URL || 'rtmp://localhost:1935/live';
        fs.ensureDirSync(config.system.cacheDir);
        this.initializeFiles();
    }

    private initializeFiles(): void {
        // Create default title file
        if (!fs.existsSync(CURRENT_TITLE_FILE)) {
            fs.writeFileSync(CURRENT_TITLE_FILE, '24/7 Radio - Waiting for songs...');
        }

        // Create default thumbnail (black image) if not exists
        if (!fs.existsSync(DEFAULT_THUMBNAIL)) {
            this.createBlackThumbnail(DEFAULT_THUMBNAIL);
        }

        // Copy default to current if needed
        if (!fs.existsSync(CURRENT_THUMBNAIL_FILE)) {
            fs.copyFileSync(DEFAULT_THUMBNAIL, CURRENT_THUMBNAIL_FILE);
        }

        // Initialize empty playlist
        if (!fs.existsSync(PLAYLIST_FILE)) {
            fs.writeFileSync(PLAYLIST_FILE, '');
        }
    }

    private createBlackThumbnail(filepath: string): void {
        // Create a 1x1 black pixel JPEG (minimal)
        // In production, you'd want a proper 1280x720 black image
        const blackPixel = Buffer.from([
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
            0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
            0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
            0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
            0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
            0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
            0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
            0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
            0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
            0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
            0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
            0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
            0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
            0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
            0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
            0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
            0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
            0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
            0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
            0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
            0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
            0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
            0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
            0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
            0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
            0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD5, 0xDB, 0x20, 0xA8, 0xA0, 0x02, 0x8A,
            0x00, 0xFF, 0xD9
        ]);
        fs.writeFileSync(filepath, blackPixel);
    }

    /**
     * Update the current song title (FFmpeg will reload)
     */
    public updateTitle(title: string): void {
        fs.writeFileSync(CURRENT_TITLE_FILE, title);
        logger.info(`Radio title updated: ${title}`);
    }

    /**
     * Update the current thumbnail from a video ID
     */
    public async updateThumbnail(videoId: string): Promise<boolean> {
        const url = `https://i3.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        logger.info(`Downloading thumbnail for radio: ${videoId}`);

        return new Promise((resolve) => {
            const file = fs.createWriteStream(CURRENT_THUMBNAIL_FILE);
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    logger.warn(`Failed to download thumbnail: ${response.statusCode}`);
                    resolve(false);
                    return;
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    logger.info(`Radio thumbnail updated: ${videoId}`);
                    resolve(true);
                });
            }).on('error', (err) => {
                logger.error('Thumbnail download error:', err);
                resolve(false);
            });
        });
    }

    /**
     * Get video ID from filename
     */
    private getVideoIdFromFile(filePath: string): string | null {
        const filename = path.basename(filePath);

        try {
            if (fs.existsSync(ID_MAPPING_FILE)) {
                const mapping: Record<string, string> = fs.readJsonSync(ID_MAPPING_FILE);
                for (const [videoId, mappedFile] of Object.entries(mapping)) {
                    if (mappedFile === filename) {
                        return videoId;
                    }
                }
            }
        } catch (error) {
            // Ignore
        }

        const ytMatch = filename.match(/yt_([a-zA-Z0-9_-]{11})/);
        if (ytMatch) return ytMatch[1];

        return null;
    }

    /**
     * Add a song to the radio queue
     */
    public async addSong(filePath: string, title: string): Promise<void> {
        const videoId = this.getVideoIdFromFile(filePath) || undefined;

        this.songQueue.push({ path: filePath, title, videoId });

        // Append to playlist file
        const playlistEntry = `file '${filePath.replace(/\\/g, '/')}'\n`;
        fs.appendFileSync(PLAYLIST_FILE, playlistEntry);

        logger.info(`Radio: Added ${title} to queue`);

        // If this is the first song and not running, start
        if (!this.isRunning && this.songQueue.length === 1) {
            await this.updateSongVisuals(this.songQueue[0]);
        }
    }

    /**
     * Update visuals for current song
     */
    private async updateSongVisuals(song: { path: string; title: string; videoId?: string }): Promise<void> {
        this.updateTitle(song.title);
        if (song.videoId) {
            await this.updateThumbnail(song.videoId);
        }
        insightsTracker.startStream(song.title);
    }

    /**
     * Start the 24/7 radio stream
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('Radio is already running');
            return;
        }

        logger.info('Starting 24/7 Radio stream...');
        this.isRunning = true;

        // Start FFmpeg with concat demuxer + dynamic overlays
        await this.startFFmpeg();
    }

    private async startFFmpeg(): Promise<void> {
        /*
         * This FFmpeg command:
         * 1. Reads audio from concat playlist (can be updated)
         * 2. Loops the current thumbnail image
         * 3. Overlays the title text (reloads every second)
         * 4. Streams to RTMP
         */
        const args = [
            // Input 1: Audio from concat playlist
            '-re',
            '-f', 'concat',
            '-safe', '0',
            '-i', PLAYLIST_FILE,

            // Input 2: Thumbnail image (looped)
            '-loop', '1',
            '-i', CURRENT_THUMBNAIL_FILE,

            // Complex filter for video + text overlay
            '-filter_complex',
            `[1:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30[bg];` +
            `[bg]drawtext=textfile='${CURRENT_TITLE_FILE.replace(/\\/g, '/')}':reload=1:` +
            `fontsize=36:fontcolor=white:bordercolor=black:borderw=2:` +
            `x=(w-text_w)/2:y=h-60[v]`,

            // Output mapping
            '-map', '[v]',
            '-map', '0:a',

            // Video encoding
            '-c:v', 'libx264',
            '-preset', 'ultrafast',
            '-tune', 'stillimage',
            '-g', '60',
            '-b:v', '1000k',
            '-maxrate', '1000k',
            '-bufsize', '2000k',
            '-pix_fmt', 'yuv420p',

            // Audio encoding
            '-c:a', 'aac',
            '-b:a', '192k',
            '-ar', '48000',

            // Output
            '-f', 'flv',
            '-flvflags', 'no_duration_filesize',
            this.rtmpUrl
        ];

        logger.info(`FFmpeg Radio args: ${args.join(' ')}`);

        this.ffmpegProcess = spawn(FFMPEG_PATH, args, { stdio: ['pipe', 'pipe', 'pipe'] });

        this.ffmpegProcess.stderr?.on('data', (data: Buffer) => {
            const line = data.toString();
            if (line.includes('frame=') || line.includes('time=')) {
                logger.debug(`Radio FFmpeg: ${line.substring(0, 100)}`);
            }
            // Detect when song changes (Duration line appears)
            if (line.includes('Opening')) {
                this.onSongChange();
            }
        });

        this.ffmpegProcess.on('close', (code) => {
            logger.info(`Radio FFmpeg exited with code ${code}`);
            this.isRunning = false;

            // Auto-restart if unexpected exit
            if (code !== 0 && code !== 255) {
                logger.info('Radio FFmpeg crashed, restarting in 5s...');
                setTimeout(() => this.start(), 5000);
            }
        });

        this.ffmpegProcess.on('error', (err) => {
            logger.error('Radio FFmpeg error:', err);
        });
    }

    private onSongChange(): void {
        this.currentSongIndex++;
        if (this.currentSongIndex < this.songQueue.length) {
            const song = this.songQueue[this.currentSongIndex];
            this.updateSongVisuals(song);
        }
    }

    /**
     * Stop the radio stream
     */
    public async stop(): Promise<void> {
        if (this.ffmpegProcess) {
            this.ffmpegProcess.kill('SIGTERM');
            this.ffmpegProcess = null;
        }
        this.isRunning = false;
        this.songQueue = [];
        this.currentSongIndex = 0;

        // Clear playlist
        fs.writeFileSync(PLAYLIST_FILE, '');

        logger.info('Radio stream stopped');
    }

    public isStreaming(): boolean {
        return this.isRunning;
    }

    public getQueueLength(): number {
        return this.songQueue.length - this.currentSongIndex;
    }
}

// Singleton instance
export const radioStreamer = new RadioStreamer();
