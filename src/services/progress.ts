import { EventEmitter } from 'events';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

export interface DownloadProgress {
    title: string;
    percent: number;
    downloaded: string;
    total: string;
    speed: string;
    status: 'downloading' | 'complete' | 'error' | 'idle';
}

class ProgressTracker extends EventEmitter {
    private current: DownloadProgress = {
        title: '',
        percent: 0,
        downloaded: '',
        total: '',
        speed: '',
        status: 'idle'
    };

    public update(progress: Partial<DownloadProgress>) {
        this.current = { ...this.current, ...progress };
        this.emit('progress', this.current);
    }

    public start(title: string) {
        this.current = {
            title,
            percent: 0,
            downloaded: '0 B',
            total: '?',
            speed: '0 B/s',
            status: 'downloading'
        };
        this.emit('progress', this.current);
    }

    public complete() {
        this.current.percent = 100;
        this.current.status = 'complete';
        this.emit('progress', this.current);

        // Reset after 3 seconds
        setTimeout(() => {
            this.current.status = 'idle';
            this.emit('progress', this.current);
        }, 3000);
    }

    public error(message: string) {
        this.current.status = 'error';
        this.emit('progress', this.current);
    }

    public getCurrent(): DownloadProgress {
        return this.current;
    }

    // Parse yt-dlp output for progress
    public parseYtDlpOutput(line: string) {
        // Match: [download]  45.2% of   50.00MiB at    1.23MiB/s ETA 00:30
        const match = line.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+~?(\S+)\s+at\s+(\S+)/);
        if (match) {
            this.update({
                percent: parseFloat(match[1]),
                total: match[2],
                speed: match[3],
                status: 'downloading'
            });
        }
    }
}

// Singleton instance
export const progressTracker = new ProgressTracker();
