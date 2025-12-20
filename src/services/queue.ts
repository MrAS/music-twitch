import { EnqueuedItem, AllowedItem } from '../types';
import { DownloaderService } from './downloader';
import { RestreamerService } from './restreamer';
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
        private restreamer: RestreamerService
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

    public async stop() {
        this.clearTimer();
        this.queue = [];
        this.current = null;
        this.isProcessing = false;
        this.isPlayingStandby = false;
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

    private async playStandby() {
        if (!config.system.standbyVideo) {
            logger.info('No standby video configured. Stream will stop when queue is empty.');
            await this.restreamer.cancelProcess();
            return;
        }

        try {
            this.isPlayingStandby = true;
            logger.info('Playing standby video...');

            // Update to standby video (loop infinitely)
            await this.restreamer.updateProcessConfig(config.system.standbyVideo, true);
            await this.restreamer.startProcess();

        } catch (error) {
            logger.error('Failed to play standby video', error);
            this.isPlayingStandby = false;
        }
    }

    private async playNext() {
        this.clearTimer();
        this.isProcessing = true;

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

            // 3. Update Restreamer
            await this.restreamer.updateProcessConfig(filePath, false);

            // 4. Start Process
            await this.restreamer.startProcess();

            // 5. Set Timer (add small buffer)
            this.timer = setTimeout(() => {
                this.playNext();
            }, (durationSec + 2) * 1000);

            this.isProcessing = false;

        } catch (error) {
            logger.error(`Failed to play ${nextItem.key}`, error);
            this.current = null;
            this.playNext();
        }
    }
}
