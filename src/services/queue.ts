import { EnqueuedItem, AllowedItem } from '../types';
import { DownloaderService } from './downloader';
import { StreamerService } from './streamer';
import { config } from '../config';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

export class QueueService {
    private queue: EnqueuedItem[] = [];
    private current: EnqueuedItem | null = null;
    private timer: NodeJS.Timeout | null = null;
    private isProcessing: boolean = false;
    private isPlayingStandby: boolean = false;

    constructor(
        private downloader: DownloaderService,
        private streamer: StreamerService
    ) {
        // Start standby video on initialization if configured
        if (config.system.standbyVideo) {
            this.playStandby();
        }
    }

    public enqueue(item: AllowedItem, user: string) {
        const enqueued: EnqueuedItem = { ...item, requestedBy: user };
        this.queue.push(enqueued);
        logger.info(`Enqueued: ${item.key} by ${user}`);

        // If not playing real content, start immediately
        if ((!this.current || this.isPlayingStandby) && !this.isProcessing) {
            this.playNext();
        }
    }

    public getQueue(): EnqueuedItem[] {
        return this.queue;
    }

    public getCurrent(): EnqueuedItem | null {
        return this.isPlayingStandby ? null : this.current;
    }

    public isOnStandby(): boolean {
        return this.isPlayingStandby;
    }

    public async skip(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        await this.streamer.stop();
        this.current = null;
        await this.playNext();
    }

    public async stop(): Promise<void> {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        await this.streamer.stop();
        this.current = null;
        this.queue = [];
        this.isPlayingStandby = false;
    }

    public removeFromQueue(index: number): boolean {
        if (index >= 0 && index < this.queue.length) {
            this.queue.splice(index, 1);
            return true;
        }
        return false;
    }

    private async playStandby(): Promise<void> {
        if (!config.system.standbyVideo) {
            logger.info('No standby video configured. Stream will stop when queue is empty.');
            return;
        }

        this.isPlayingStandby = true;
        logger.info('Playing standby video (looping)');

        try {
            // Stream standby video with loop enabled
            await this.streamer.streamFile(config.system.standbyVideo, true);
        } catch (error) {
            logger.error('Failed to play standby video', error);
        }
    }

    public async playNext(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        // Stop current stream
        await this.streamer.stop();

        if (this.queue.length === 0) {
            this.current = null;
            this.isProcessing = false;

            // Play standby instead of stopping
            await this.playStandby();
            return;
        }

        // Stop standby if it was playing
        this.isPlayingStandby = false;

        const nextItem = this.queue.shift();
        if (!nextItem) return;

        this.current = nextItem;
        logger.info(`Preparing to play: ${nextItem.title}`);

        try {
            // 1. Ensure file exists
            const filePath = await this.downloader.ensure(nextItem);

            // 2. Get duration
            const durationSec = await this.downloader.getDuration(filePath);
            logger.info(`Duration: ${durationSec}s`);

            // 3. Stream via FFmpeg
            await this.streamer.streamFile(filePath, false);
            logger.info('Stream started successfully');

            // 4. Set Timer (add small buffer)
            this.timer = setTimeout(() => {
                this.playNext();
            }, (durationSec + 2) * 1000);

            this.isProcessing = false;

        } catch (error) {
            logger.error(`Failed to play ${nextItem.key}`, error);
            this.current = null;
            this.isProcessing = false;
            this.playNext();
        }
    }
}
