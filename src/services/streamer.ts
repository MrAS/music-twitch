import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs-extra';
import winston from 'winston';
import { config } from '../config';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

// Get FFmpeg executable path from env or default to 'ffmpeg'
const FFMPEG_PATH = process.env.FFMPEG_PATH
    ? path.join(process.env.FFMPEG_PATH, 'ffmpeg.exe')
    : 'ffmpeg';

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
}

export class StreamerService {
    private currentProcess: ChildProcess | null = null;
    private rtmpUrl: string;
    private currentQuality: string = '720p';

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
            }
        } catch (error) {
            logger.warn('Could not load stream settings, using defaults');
        }
    }

    private saveSettings(): void {
        try {
            const settings: StreamSettings = { quality: this.currentQuality };
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

    /**
     * Check if file is audio-only based on extension
     */
    private isAudioOnly(filePath: string): boolean {
        const ext = path.extname(filePath).toLowerCase();
        return AUDIO_ONLY_EXTENSIONS.includes(ext);
    }

    /**
     * Stream a local file to RTMPS using FFmpeg
     */
    public async streamFile(filePath: string, loop: boolean = false): Promise<void> {
        // Stop any existing stream
        await this.stop();

        const isAudio = this.isAudioOnly(filePath);
        const preset = QUALITY_PRESETS[this.currentQuality] || QUALITY_PRESETS['720p'];

        logger.info(`Starting stream: ${filePath} -> ${this.rtmpUrl} (quality: ${preset.name}, audio-only: ${isAudio})`);

        let args: string[];

        if (isAudio) {
            // For audio-only files, generate a black video background
            const resolution = preset.width > 0 ? `${preset.width}x${preset.height}` : '1280x720';
            args = [
                '-re', // Read at native frame rate
                ...(loop ? ['-stream_loop', '-1'] : []), // Loop audio if specified
                '-f', 'lavfi',
                '-i', `color=c=black:s=${resolution}:r=30`, // Generate black video
                '-i', filePath, // Audio input
                '-shortest', // Stop when shortest input ends
                '-c:v', 'libx264',
                '-preset', preset.preset === 'copy' ? 'veryfast' : preset.preset,
                '-maxrate', preset.videoBitrate === '0' ? '2000k' : preset.videoBitrate,
                '-bufsize', preset.videoBitrate === '0' ? '4000k' : `${parseInt(preset.videoBitrate) * 2}k`,
                '-pix_fmt', 'yuv420p',
                '-g', '60',
                '-c:a', 'aac',
                '-b:a', preset.audioBitrate === '0' ? '128k' : preset.audioBitrate,
                '-ar', '44100',
                '-map', '0:v', // Use video from first input (lavfi)
                '-map', '1:a', // Use audio from second input (file)
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
                '-b:a', '128k',
                '-f', 'flv',
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
                '-ar', '44100',
                '-f', 'flv',
                '-tls_verify', '0', // Disable TLS verification for compatibility
                this.rtmpUrl
            ];
        }

        return new Promise((resolve, reject) => {
            this.currentProcess = spawn(FFMPEG_PATH, args, {
                stdio: ['pipe', 'pipe', 'pipe']
            });

            this.currentProcess.on('error', (err) => {
                logger.error('FFmpeg error:', err);
                reject(err);
            });

            this.currentProcess.stderr?.on('data', (data: Buffer) => {
                const line = data.toString();
                // Log progress occasionally
                if (line.includes('frame=') || line.includes('time=')) {
                    logger.info(`FFmpeg: ${line.substring(0, 100)}`);
                }
            });

            this.currentProcess.on('close', (code) => {
                logger.info(`FFmpeg exited with code ${code}`);
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
