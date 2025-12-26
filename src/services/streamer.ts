import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import https from 'https';
import http from 'http';
import winston from 'winston';
import { config } from '../config';
import { insightsTracker } from './progress';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

// Get FFmpeg executable path from env or default to 'ffmpeg'
const FFMPEG_PATH = process.env.FFMPEG_PATH
    ? path.join(process.env.FFMPEG_PATH, 'ffmpeg.exe')
    : 'ffmpeg';

// File paths
const ID_MAPPING_FILE = path.join(config.system.cacheDir, 'id_mapping.json');
const THUMBNAILS_DIR = path.join(config.system.cacheDir, 'thumbnails');

// Audio-only extensions that need video generation
const AUDIO_ONLY_EXTENSIONS = ['.m4a', '.mp3', '.aac', '.flac', '.wav', '.ogg'];

// Quality presets
export interface QualityPreset {
    name: string;
    resolution: string;
    width: number;
    height: number;
    videoBitrate: string;
    audioBitrate: string;
    preset: string;
}

export const QUALITY_PRESETS: { [key: string]: QualityPreset } = {
    '480p': {
        name: '480p',
        resolution: '854x480',
        width: 854,
        height: 480,
        videoBitrate: '1500k',
        audioBitrate: '96k',
        preset: 'veryfast'
    },
    '720p': {
        name: '720p',
        resolution: '1280x720',
        width: 1280,
        height: 720,
        videoBitrate: '3000k',
        audioBitrate: '128k',
        preset: 'veryfast'
    },
    '1080p': {
        name: '1080p',
        resolution: '1920x1080',
        width: 1920,
        height: 1080,
        videoBitrate: '6000k',
        audioBitrate: '192k',
        preset: 'fast'
    },
    '4k': {
        name: '4K',
        resolution: '3840x2160',
        width: 3840,
        height: 2160,
        videoBitrate: '20000k',
        audioBitrate: '256k',
        preset: 'fast'
    },
    '8k': {
        name: '8K',
        resolution: '7680x4320',
        width: 7680,
        height: 4320,
        videoBitrate: '50000k',
        audioBitrate: '320k',
        preset: 'medium'
    },
    'source': {
        name: 'Source (No Re-encode)',
        resolution: 'original',
        width: 0,
        height: 0,
        videoBitrate: '0',
        audioBitrate: '0',
        preset: 'copy'
    }
};

// Settings file path
const SETTINGS_FILE = './stream-settings.json';

export interface StreamSettings {
    quality: string;
    customBitrate?: string;
    coverImage?: string; // Path to cover image for audio streams
    audioOnly?: boolean; // Audio-only mode (no video)
    useThumbnail?: boolean; // Use YouTube thumbnail as background
}

export class StreamerService {
    private currentProcess: ChildProcess | null = null;
    private rtmpUrl: string;
    private currentQuality: string = '720p';
    private coverImage: string = ''; // Path to cover image for audio streams
    private audioOnly: boolean = true; // Default to audio-only
    private useThumbnail: boolean = false; // Use YouTube thumbnail as background

    constructor() {
        // Get RTMP URL from env or use default
        this.rtmpUrl = process.env.RTMP_URL || 'rtmps://stream.egpeak.com:1936/30becbb1-4642-465c-94a0-215d8467b5e3.stream';
        this.loadSettings();
    }

    private loadSettings(): void {
        try {
            if (fs.existsSync(SETTINGS_FILE)) {
                const settings: StreamSettings = fs.readJsonSync(SETTINGS_FILE);
                if (settings.quality && QUALITY_PRESETS[settings.quality]) {
                    this.currentQuality = settings.quality;
                    logger.info(`Loaded quality setting: ${this.currentQuality}`);
                }
                if (settings.coverImage) {
                    this.coverImage = settings.coverImage;
                    logger.info(`Loaded cover image: ${this.coverImage}`);
                }
                if (typeof settings.audioOnly === 'boolean') {
                    this.audioOnly = settings.audioOnly;
                    logger.info(`Loaded audio-only mode: ${this.audioOnly}`);
                }
                if (typeof settings.useThumbnail === 'boolean') {
                    this.useThumbnail = settings.useThumbnail;
                    logger.info(`Loaded thumbnail stream: ${this.useThumbnail}`);
                }
            }
        } catch (error) {
            logger.warn('Could not load stream settings, using defaults');
        }
    }

    private saveSettings(): void {
        try {
            const settings: StreamSettings = {
                quality: this.currentQuality,
                coverImage: this.coverImage || undefined,
                audioOnly: this.audioOnly,
                useThumbnail: this.useThumbnail
            };
            fs.writeJsonSync(SETTINGS_FILE, settings);
        } catch (error) {
            logger.error('Could not save stream settings', error);
        }
    }

    public getQuality(): string {
        return this.currentQuality;
    }

    public setQuality(quality: string): boolean {
        if (QUALITY_PRESETS[quality]) {
            this.currentQuality = quality;
            this.saveSettings();
            logger.info(`Quality set to: ${quality}`);
            return true;
        }
        return false;
    }

    public getPresets(): { [key: string]: QualityPreset } {
        return QUALITY_PRESETS;
    }

    public getCoverImage(): string {
        return this.coverImage;
    }

    public setCoverImage(imagePath: string): boolean {
        if (imagePath && !fs.existsSync(imagePath)) {
            logger.warn(`Cover image not found: ${imagePath}`);
            return false;
        }
        this.coverImage = imagePath;
        this.saveSettings();
        logger.info(`Cover image set to: ${imagePath || '(none - black background)'}`);
        return true;
    }

    public isAudioOnly(): boolean {
        return this.audioOnly;
    }

    public setAudioOnly(audioOnly: boolean): void {
        this.audioOnly = audioOnly;
        this.saveSettings();
        logger.info(`Audio-only mode: ${audioOnly ? 'enabled' : 'disabled (video mode)'}`);
    }

    public getUseThumbnail(): boolean {
        return this.useThumbnail;
    }

    public setUseThumbnail(use: boolean): void {
        this.useThumbnail = use;
        this.saveSettings();
        logger.info(`Thumbnail stream: ${use ? 'enabled' : 'disabled'}`);
    }

    /**
     * Get video ID from cached filename using id_mapping.json
     */
    private getVideoIdFromFile(filePath: string): string | null {
        const filename = path.basename(filePath);

        // Check id_mapping.json for reverse lookup
        try {
            if (fs.existsSync(ID_MAPPING_FILE)) {
                const mapping: Record<string, string> = fs.readJsonSync(ID_MAPPING_FILE);
                // Reverse lookup: find videoId that maps to this filename
                for (const [videoId, mappedFile] of Object.entries(mapping)) {
                    if (mappedFile === filename) {
                        return videoId;
                    }
                }
            }
        } catch (error) {
            logger.warn('Failed to read id_mapping.json');
        }

        // Fallback: check for yt_VIDEOID pattern in filename
        const ytMatch = filename.match(/yt_([a-zA-Z0-9_-]{11})/);
        if (ytMatch) return ytMatch[1];

        return null;
    }

    /**
     * Download YouTube thumbnail for a video ID
     */
    private async downloadThumbnail(videoId: string): Promise<string | null> {
        await fs.ensureDir(THUMBNAILS_DIR);
        const thumbPath = path.join(THUMBNAILS_DIR, `${videoId}.jpg`);

        // Return cached thumbnail if exists
        if (fs.existsSync(thumbPath)) {
            logger.info(`Using cached thumbnail: ${thumbPath}`);
            return thumbPath;
        }

        // Download from YouTube
        const url = `https://i3.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        logger.info(`Downloading thumbnail: ${url}`);

        return new Promise((resolve) => {
            const file = fs.createWriteStream(thumbPath);
            https.get(url, (response) => {
                if (response.statusCode !== 200) {
                    logger.warn(`Failed to download thumbnail: ${response.statusCode}`);
                    fs.unlinkSync(thumbPath);
                    resolve(null);
                    return;
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    logger.info(`Thumbnail saved: ${thumbPath}`);
                    resolve(thumbPath);
                });
            }).on('error', (err) => {
                logger.error('Thumbnail download error:', err);
                fs.unlink(thumbPath, () => { });
                resolve(null);
            });
        });
    }

    /**
     * Get thumbnail URL for streaming (direct YouTube URL - no download needed)
     */
    public getThumbnailUrlForFile(filePath: string): string | null {
        if (!this.useThumbnail) return null;

        const videoId = this.getVideoIdFromFile(filePath);
        if (!videoId) {
            logger.info('No video ID found for thumbnail');
            return null;
        }

        // Return direct YouTube thumbnail URL - FFmpeg can read from HTTP
        const thumbUrl = `https://i3.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        logger.info(`Using direct thumbnail URL: ${thumbUrl}`);
        return thumbUrl;
    }

    /**
     * Check if file is audio-only based on extension
     */
    private isAudioFile(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return AUDIO_ONLY_EXTENSIONS.includes(ext);
    }

    /**
     * Get the playlist file path
     */
    public getPlaylistPath(): string {
        return path.join(config.system.cacheDir, 'playlist.txt');
    }

    /**
     * Write a playlist file for FFmpeg concat demuxer
     */
    public writePlaylist(files: string[]): void {
        const playlistPath = this.getPlaylistPath();
        const content = files.map(f => `file '${f}'`).join('\n');
        fs.writeFileSync(playlistPath, content);
        logger.info(`Playlist written with ${files.length} files: ${playlistPath}`);
    }

    /**
     * Add a file to the playlist
     */
    public addToPlaylist(filePath: string): void {
        const playlistPath = this.getPlaylistPath();
        const line = `file '${filePath}'\n`;
        fs.appendFileSync(playlistPath, line);
        logger.info(`Added to playlist: ${filePath}`);
    }

    /**
     * Stream using playlist.txt with concat demuxer (continuous streaming)
     * Command: ffmpeg -re -f concat -safe 0 -i playlist.txt -c:a aac -b:a 128k -ar 44100 -f flv rtmp://...
     */
    public async streamPlaylist(): Promise<void> {
        const playlistPath = this.getPlaylistPath();

        if (!fs.existsSync(playlistPath)) {
            throw new Error('Playlist file not found. Add files first.');
        }

        // Stop any existing stream
        await this.stop();

        logger.info(`Starting playlist stream: ${playlistPath} -> ${this.rtmpUrl}`);
        insightsTracker.startStream('Playlist');

        const args = [
            '-re',
            '-f', 'concat',
            '-safe', '0',
            '-i', playlistPath,
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-f', 'flv',
            this.rtmpUrl
        ];

        logger.info(`FFmpeg command: ffmpeg ${args.join(' ')}`);

        return new Promise((resolve, reject) => {
            this.currentProcess = spawn(FFMPEG_PATH, args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.currentProcess.on('error', (err) => {
                logger.error('FFmpeg error:', err);
                insightsTracker.streamError(err.message);
                reject(err);
            });

            this.currentProcess.stderr?.on('data', (data: Buffer) => {
                const line = data.toString();
                // Parse FFmpeg output for insights
                insightsTracker.parseFFmpegOutput(line);

                if (line.includes('time=') || line.includes('size=')) {
                    logger.info(`FFmpeg: ${line.substring(0, 120)}`);
                }
            });

            this.currentProcess.on('close', (code) => {
                logger.info(`FFmpeg playlist exited with code ${code}`);
                insightsTracker.stopStream();
                this.currentProcess = null;
                if (code === 0 || code === 255) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });

            // Give FFmpeg time to start
            setTimeout(() => {
                if (this.currentProcess) {
                    logger.info('Playlist stream started successfully');
                    resolve();
                }
            }, 2000);
        });
    }

    /**
     * Stream a local file to RTMPS using FFmpeg
     */
    public async streamFile(filePath: string, loop: boolean = false): Promise<void> {
        // Stop any existing stream
        await this.stop();

        // Wait for RTMP connection to be released by Restreamer
        logger.info('Waiting for RTMP connection to be released...');
        await new Promise(resolve => setTimeout(resolve, 2000));

        const isAudio = this.isAudioFile(filePath);
        const preset = QUALITY_PRESETS[this.currentQuality] || QUALITY_PRESETS['720p'];

        logger.info(`Starting stream: ${filePath} -> ${this.rtmpUrl} (quality: ${preset.name}, audio-only: ${isAudio})`);

        // Emit stream starting event
        const streamTitle = path.basename(filePath);
        insightsTracker.startStream(streamTitle);

        let args: string[];

        if (isAudio) {
            // For audio-only files, we need to generate a video track (RTMP requires video)
            logger.info(`Streaming audio-only: ${filePath}`);

            // Try to get thumbnail URL if enabled
            let videoSource: string[] = ['-f', 'lavfi', '-i', 'color=c=black:s=1280x720:r=30:d=99999'];

            if (this.useThumbnail) {
                const thumbUrl = this.getThumbnailUrlForFile(filePath);
                if (thumbUrl) {
                    logger.info(`Using thumbnail URL as background: ${thumbUrl}`);
                    // Loop the thumbnail image from URL with proper framerate
                    videoSource = ['-loop', '1', '-framerate', '30', '-i', thumbUrl];
                } else {
                    logger.warn('No thumbnail URL available, using black background');
                }
            }

            // Build args - exact match to working manual command
            args = [
                ...videoSource, // [-loop, 1, -framerate, 30, -i, URL] or lavfi
                '-i', filePath,
                '-map', '0:v', // Use video from image/lavfi
                '-map', '1:a', // Use audio from file
                '-c:v', 'libx264',
                '-preset', 'ultrafast',
                '-tune', 'stillimage',
                '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-ar', '48000',
                '-shortest', // End when audio ends
                '-f', 'flv',
                this.rtmpUrl
            ];
        } else if (preset.preset === 'copy') {
            // Source quality - just copy streams
            args = [
                '-re', // Read at native frame rate
                ...(loop ? ['-stream_loop', '-1'] : []), // Loop if specified
                '-i', filePath,
                '-c:v', 'copy',
                '-c:a', 'aac',
                '-b:a', '192k',
                '-ar', '48000',
                '-f', 'flv',
                '-flvflags', 'no_duration_filesize', // Low-latency
                this.rtmpUrl
            ];
        } else {
            // For video files, stream with quality settings
            args = [
                '-re', // Read at native frame rate
                ...(loop ? ['-stream_loop', '-1'] : []), // Loop if specified
                '-i', filePath,
                '-vf', `scale=${preset.width}:${preset.height}:force_original_aspect_ratio=decrease,pad=${preset.width}:${preset.height}:(ow-iw)/2:(oh-ih)/2`,
                '-c:v', 'libx264',
                '-preset', preset.preset,
                '-maxrate', preset.videoBitrate,
                '-bufsize', `${parseInt(preset.videoBitrate) * 2}k`,
                '-pix_fmt', 'yuv420p',
                '-g', '50',
                '-c:a', 'aac',
                '-b:a', preset.audioBitrate,
                '-ar', '48000',
                '-f', 'flv',
                '-flvflags', 'no_duration_filesize', // Low-latency
                this.rtmpUrl
            ];
        }

        return new Promise((resolve, reject) => {
            this.currentProcess = spawn(FFMPEG_PATH, args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.currentProcess.on('error', (err) => {
                logger.error('FFmpeg error:', err);
                insightsTracker.streamError(err.message);
                reject(err);
            });

            // Buffer to capture FFmpeg errors
            let stderrBuffer: string[] = [];

            this.currentProcess.stderr?.on('data', (data: Buffer) => {
                const line = data.toString();
                // Store last 30 lines of stderr for error diagnosis
                stderrBuffer.push(line);
                if (stderrBuffer.length > 30) stderrBuffer.shift();

                // Log error lines immediately
                if (line.includes('error') || line.includes('Error') ||
                    line.includes('failed') || line.includes('Failed') ||
                    line.includes('Broken pipe') || line.includes('Connection')) {
                    logger.error(`FFmpeg ERROR: ${line}`);
                }

                // Parse FFmpeg output for insights
                insightsTracker.parseFFmpegOutput(line);
                // Log progress
                if (line.includes('frame=') || line.includes('time=')) {
                    logger.info(`FFmpeg: ${line.substring(0, 200)}`);
                }
            });

            this.currentProcess.on('close', (code) => {
                logger.info(`FFmpeg exited with code ${code}`);
                if (code !== 0 && code !== 255) {
                    logger.error(`FFmpeg stderr (last lines): ${stderrBuffer.join('')}`);
                }
                this.currentProcess = null;
                insightsTracker.stopStream();
                if (code === 0 || code === 255) {
                    resolve();
                } else {
                    insightsTracker.streamError(`FFmpeg exited with code ${code}`);
                    reject(new Error(`FFmpeg exited with code ${code}`));
                }
            });

            // Give FFmpeg time to start
            setTimeout(() => {
                if (this.currentProcess) {
                    logger.info('Stream started successfully');
                    resolve();
                }
            }, 2000);
        });
    }

    /**
     * Stop current stream
     */
    public async stop(): Promise<void> {
        if (this.currentProcess) {
            logger.info('Stopping current stream');
            this.currentProcess.kill('SIGTERM');

            // Wait for process to exit
            await new Promise<void>((resolve) => {
                if (!this.currentProcess) {
                    resolve();
                    return;
                }
                this.currentProcess.on('close', () => resolve());
                setTimeout(() => resolve(), 3000); // Force resolve after 3s
            });

            this.currentProcess = null;
        }
    }

    /**
     * Check if currently streaming
     */
    public isStreaming(): boolean {
        return this.currentProcess !== null;
    }
}
