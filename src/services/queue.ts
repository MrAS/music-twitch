import { EnqueuedItem, AllowedItem } from '../types';
import { DownloaderService } from './downloader';
import { RestreamerService } from './restreamer';
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

    constructor(
        private downloader: DownloaderService,
        private restreamer: RestreamerService
    ) { }

    public enqueue(item: AllowedItem, user: string) {
        const enqueued: EnqueuedItem = { ...item, requestedBy: user };
        this.queue.push(enqueued);
        logger.info(`Enqueued: ${item.key} by ${user}`);

        // If not playing, start immediately
        if (!this.current && !this.isProcessing) {
            this.playNext();
        }
    }

    public getQueue(): EnqueuedItem[] {
        return this.queue;
    }

    public getCurrent(): EnqueuedItem | null {
        return this.current;
    }

    public async stop() {
        this.clearTimer();
        this.queue = [];
        this.current = null;
        this.isProcessing = false;
        await this.restreamer.cancelProcess();
        logger.info('Stopped playback and cleared queue.');
    }

    public async skip() {
        logger.info('Skipping current track...');
        await this.playNext();
    }

    private clearTimer() {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }

    private async playNext() {
        this.clearTimer();
        this.isProcessing = true; // Lock to prevent double playing

        if (this.queue.length === 0) {
            this.current = null;
            this.isProcessing = false;
            await this.restreamer.cancelProcess();
            logger.info('Queue empty. Stopped.');
            return;
        }

        const nextItem = this.queue.shift();
        if (!nextItem) return; // Should not happen

        this.current = nextItem;
        logger.info(`Preparing to play: ${nextItem.title}`);

        try {
            // 1. Ensure file exists
            const filePath = await this.downloader.ensure(nextItem);

            // 2. Get duration
            const durationSec = await this.downloader.getDuration(filePath);
            logger.info(`Duration: ${durationSec}s`);

            // 3. Update Restreamer
            await this.restreamer.updateProcessConfig(filePath);

            // 4. Start Process
            await this.restreamer.startProcess();

            // 5. Set Timer (add small buffer, e.g. 2s)
            this.timer = setTimeout(() => {
                this.playNext();
            }, (durationSec + 2) * 1000);

            this.isProcessing = false;

        } catch (error) {
            logger.error(`Failed to play ${nextItem.key}`, error);
            // If failed, try next one immediately
            this.current = null;
            this.playNext();
        }
    }
}
