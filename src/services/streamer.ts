import { spawn, ChildProcess } from 'child_process';
import winston from 'winston';
import { config } from '../config';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

export class StreamerService {
    private currentProcess: ChildProcess | null = null;
    private rtmpUrl: string;

    constructor() {
        // Get RTMP URL from env or use default
        this.rtmpUrl = process.env.RTMP_URL || 'rtmps://stream.egpeak.com:1936/30becbb1-4642-465c-94a0-215d8467b5e3.stream';
    }

    /**
     * Stream a local file to RTMPS using FFmpeg
     */
    public async streamFile(filePath: string, loop: boolean = false): Promise<void> {
        // Stop any existing stream
        await this.stop();

        logger.info(`Starting stream: ${filePath} -> ${this.rtmpUrl}`);

        const args = [
            '-re', // Read at native frame rate
            ...(loop ? ['-stream_loop', '-1'] : []), // Loop if specified
            '-i', filePath,
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-maxrate', '3000k',
            '-bufsize', '6000k',
            '-pix_fmt', 'yuv420p',
            '-g', '50',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-ar', '44100',
            '-f', 'flv',
            this.rtmpUrl
        ];

        return new Promise((resolve, reject) => {
            this.currentProcess = spawn('ffmpeg', args, {
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
