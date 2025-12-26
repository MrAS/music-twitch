import { EventEmitter } from 'events';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

// Event Types
export type InsightType = 'download' | 'stream' | 'queue' | 'system' | 'error';

export interface BaseInsight {
    type: InsightType;
    timestamp: number;
    message: string;
}

export interface DownloadInsight extends BaseInsight {
    type: 'download';
    title: string;
    percent: number;
    downloaded: string;
    total: string;
    speed: string;
    status: 'downloading' | 'complete' | 'error' | 'idle';
}

export interface StreamInsight extends BaseInsight {
    type: 'stream';
    status: 'starting' | 'streaming' | 'stopped' | 'error';
    title?: string;
    frame?: number;
    fps?: number;
    time?: string;
    bitrate?: string;
    speed?: string;
}

export interface QueueInsight extends BaseInsight {
    type: 'queue';
    action: 'enqueued' | 'playing' | 'skipped' | 'cleared' | 'auto-generating';
    title?: string;
    user?: string;
    queueLength?: number;
}

export interface SystemInsight extends BaseInsight {
    type: 'system' | 'error';
    level: 'info' | 'warn' | 'error';
}

export type Insight = DownloadInsight | StreamInsight | QueueInsight | SystemInsight;

// Legacy download progress interface for backward compatibility
export interface DownloadProgress {
    title: string;
    percent: number;
    downloaded: string;
    total: string;
    speed: string;
    status: 'downloading' | 'complete' | 'error' | 'idle';
}

class InsightsTracker extends EventEmitter {
    private downloadState: DownloadProgress = {
        title: '',
        percent: 0,
        downloaded: '',
        total: '',
        speed: '',
        status: 'idle'
    };

    private streamState: Partial<StreamInsight> = {
        status: 'stopped'
    };

    private recentInsights: Insight[] = [];
    private maxInsights = 100;

    private emit_insight(insight: Insight) {
        this.recentInsights.push(insight);
        if (this.recentInsights.length > this.maxInsights) {
            this.recentInsights.shift();
        }
        this.emit('insight', insight);
    }

    // Download tracking (legacy compatible)
    public updateDownload(progress: Partial<DownloadProgress>) {
        this.downloadState = { ...this.downloadState, ...progress };
        this.emit('progress', this.downloadState); // Legacy event

        const insight: DownloadInsight = {
            type: 'download',
            timestamp: Date.now(),
            message: `Download: ${this.downloadState.title} - ${Math.round(this.downloadState.percent)}%`,
            ...this.downloadState
        };
        this.emit_insight(insight);
    }

    public startDownload(title: string) {
        this.downloadState = {
            title,
            percent: 0,
            downloaded: '0 B',
            total: '?',
            speed: '0 B/s',
            status: 'downloading'
        };
        this.emit('progress', this.downloadState);

        this.emit_insight({
            type: 'download',
            timestamp: Date.now(),
            message: `Starting download: ${title}`,
            ...this.downloadState
        });
    }

    public completeDownload() {
        this.downloadState.percent = 100;
        this.downloadState.status = 'complete';
        this.emit('progress', this.downloadState);

        this.emit_insight({
            type: 'download',
            timestamp: Date.now(),
            message: `Download complete: ${this.downloadState.title}`,
            ...this.downloadState
        });

        // Reset after 3 seconds
        setTimeout(() => {
            this.downloadState.status = 'idle';
            this.emit('progress', this.downloadState);
        }, 3000);
    }

    public errorDownload(errorMsg: string) {
        this.downloadState.status = 'error';
        this.emit('progress', this.downloadState);

        this.emit_insight({
            type: 'error',
            timestamp: Date.now(),
            message: `Download error: ${errorMsg}`,
            level: 'error'
        });
    }

    // Stream tracking
    public updateStream(update: Partial<StreamInsight>) {
        this.streamState = { ...this.streamState, ...update };

        const insight: StreamInsight = {
            type: 'stream',
            timestamp: Date.now(),
            message: this.formatStreamMessage(this.streamState),
            status: this.streamState.status || 'streaming',
            ...this.streamState as any
        };
        this.emit_insight(insight);
    }

    private formatStreamMessage(state: Partial<StreamInsight>): string {
        if (state.status === 'starting') {
            return `Starting stream: ${state.title || 'Unknown'}`;
        }
        if (state.status === 'stopped') {
            return 'Stream stopped';
        }
        if (state.status === 'error') {
            return `Stream error: ${state.title || 'Unknown error'}`;
        }
        // Streaming status with stats
        const parts = [];
        if (state.time) parts.push(`Time: ${state.time}`);
        if (state.bitrate) parts.push(`Bitrate: ${state.bitrate}`);
        if (state.fps) parts.push(`FPS: ${state.fps}`);
        if (state.speed) parts.push(`Speed: ${state.speed}`);
        return parts.length > 0 ? `Streaming: ${parts.join(' | ')}` : 'Streaming...';
    }

    public startStream(title: string) {
        this.streamState = { status: 'starting', title };
        this.emit_insight({
            type: 'stream',
            timestamp: Date.now(),
            message: `Starting stream: ${title}`,
            status: 'starting',
            title
        });
    }

    public stopStream() {
        this.streamState = { status: 'stopped' };
        this.emit_insight({
            type: 'stream',
            timestamp: Date.now(),
            message: 'Stream stopped',
            status: 'stopped'
        });
    }

    public streamError(errorMsg: string) {
        this.streamState = { status: 'error' };
        this.emit_insight({
            type: 'stream',
            timestamp: Date.now(),
            message: `Stream error: ${errorMsg}`,
            status: 'error',
            title: errorMsg
        });
    }

    // Queue tracking
    public queueEvent(action: QueueInsight['action'], details: { title?: string; user?: string; queueLength?: number }) {
        let message = '';
        switch (action) {
            case 'enqueued':
                message = `${details.title} queued by ${details.user || 'Unknown'}`;
                break;
            case 'playing':
                message = `Now playing: ${details.title}`;
                break;
            case 'skipped':
                message = `Skipped: ${details.title || 'current track'}`;
                break;
            case 'cleared':
                message = 'Queue cleared';
                break;
            case 'auto-generating':
                message = 'Auto-generating more songs...';
                break;
        }

        this.emit_insight({
            type: 'queue',
            timestamp: Date.now(),
            message,
            action,
            ...details
        });
    }

    // System messages
    public systemMessage(message: string, level: 'info' | 'warn' | 'error' = 'info') {
        this.emit_insight({
            type: level === 'error' ? 'error' : 'system',
            timestamp: Date.now(),
            message,
            level
        });
    }

    // Parse yt-dlp output for progress (legacy)
    public parseYtDlpOutput(line: string) {
        // Match: [download]  45.2% of   50.00MiB at    1.23MiB/s ETA 00:30
        const match = line.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+~?(\S+)\s+at\s+(\S+)/);
        if (match) {
            this.updateDownload({
                percent: parseFloat(match[1]),
                total: match[2],
                speed: match[3],
                status: 'downloading'
            });
        }
    }

    // Parse FFmpeg stderr for stream progress
    public parseFFmpegOutput(line: string) {
        // Match: frame=  123 fps= 30 q=28.0 size=    1234kB time=00:00:05.00 bitrate= 2000.0kbits/s speed=1.0x
        const frameMatch = line.match(/frame=\s*(\d+)/);
        const fpsMatch = line.match(/fps=\s*([\d.]+)/);
        const timeMatch = line.match(/time=(\d+:\d+:\d+\.\d+)/);
        const bitrateMatch = line.match(/bitrate=\s*([\d.]+\s*\w+)/);
        const speedMatch = line.match(/speed=\s*([\d.]+x)/);

        if (frameMatch || timeMatch) {
            this.updateStream({
                status: 'streaming',
                frame: frameMatch ? parseInt(frameMatch[1]) : undefined,
                fps: fpsMatch ? parseFloat(fpsMatch[1]) : undefined,
                time: timeMatch ? timeMatch[1] : undefined,
                bitrate: bitrateMatch ? bitrateMatch[1] : undefined,
                speed: speedMatch ? speedMatch[1] : undefined
            });
        }

        // Check for error messages
        if (line.toLowerCase().includes('error') || line.includes('Failed to')) {
            this.streamError(line.trim());
        }
    }

    // Getters
    public getDownloadState(): DownloadProgress {
        return this.downloadState;
    }

    public getStreamState(): Partial<StreamInsight> {
        return this.streamState;
    }

    public getRecentInsights(): Insight[] {
        return this.recentInsights;
    }

    // Legacy compatibility
    public getCurrent(): DownloadProgress {
        return this.downloadState;
    }

    public start(title: string) {
        this.startDownload(title);
    }

    public update(progress: Partial<DownloadProgress>) {
        this.updateDownload(progress);
    }

    public complete() {
        this.completeDownload();
    }

    public error(message: string) {
        this.errorDownload(message);
    }
}

// Singleton instance
export const insightsTracker = new InsightsTracker();

// Legacy export for backward compatibility
export const progressTracker = insightsTracker;
