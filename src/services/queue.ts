import { EnqueuedItem, AllowedItem } from '../types';
import { DownloaderService } from './downloader';
import { StreamerService } from './streamer';
import { config } from '../config';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

export interface AutoPlaylistConfig {
    enabled: boolean;
    description: string;
    songsPerBatch: number;
    playedSongs: Set<string>;  // Track already played to ensure uniqueness
}

export class QueueService {
    private queue: EnqueuedItem[] = [];
    private current: EnqueuedItem | null = null;
    private timer: NodeJS.Timeout | null = null;
    private isProcessing: boolean = false;
    private isPlayingStandby: boolean = false;
    private autoPlaylist: AutoPlaylistConfig = {
        enabled: false,
        description: '',
        songsPerBatch: 3,
        playedSongs: new Set()
    };
    private youtubeService: any = null;

    constructor(
        private downloader: DownloaderService,
        private streamer: StreamerService
    ) {
        // Start standby video on initialization if configured
        if (config.system.standbyVideo) {
            this.playStandby();
        }
    }

    public setYouTubeService(youtube: any) {
        this.youtubeService = youtube;
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

    // Auto-playlist methods
    public enableAutoPlaylist(description: string, songsPerBatch: number = 3): void {
        this.autoPlaylist = {
            enabled: true,
            description,
            songsPerBatch,
            playedSongs: new Set()
        };
        logger.info(`Auto-playlist enabled: "${description}" (${songsPerBatch} songs per batch)`);
    }

    public disableAutoPlaylist(): void {
        this.autoPlaylist.enabled = false;
        this.autoPlaylist.playedSongs.clear();
        logger.info('Auto-playlist disabled');
    }

    public isAutoPlaylistEnabled(): boolean {
        return this.autoPlaylist.enabled;
    }

    public getAutoPlaylistInfo(): { enabled: boolean; description: string } {
        return {
            enabled: this.autoPlaylist.enabled,
            description: this.autoPlaylist.description
        };
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
        this.disableAutoPlaylist();
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

    private async generateMoreSongs(): Promise<void> {
        if (!this.autoPlaylist.enabled || !this.youtubeService) return;

        logger.info(`Auto-generating more songs for: "${this.autoPlaylist.description}"`);

        try {
            // Import AI playlist service dynamically
            const { AIPlaylistService } = await import('./aiplaylist');
            const aiPlaylist = new AIPlaylistService();

            // Generate more songs with unique filter
            const playlist = await aiPlaylist.generatePlaylist({
                description: this.autoPlaylist.description,
                count: this.autoPlaylist.songsPerBatch + 2, // Get a few extra to filter
                mode: 'shuffle'
            });

            // Queue only songs not already played
            for (const song of playlist.songs) {
                if (this.autoPlaylist.playedSongs.has(song.searchQuery)) {
                    logger.info(`Skipping already played: ${song.searchQuery}`);
                    continue;
                }

                if (this.queue.length >= this.autoPlaylist.songsPerBatch) break;

                try {
                    const result = await this.youtubeService.search(song.searchQuery);
                    if (result) {
                        const filePath = await this.youtubeService.ensureDownloaded(result.id, result.url);

                        const item: AllowedItem = {
                            key: `yt_${result.id}`,
                            title: result.title,
                            source: { type: 'local_file', path: filePath }
                        };

                        this.queue.push({ ...item, requestedBy: 'AutoPlaylist' });
                        this.autoPlaylist.playedSongs.add(song.searchQuery);
                        logger.info(`Auto-queued: ${result.title}`);
                    }
                } catch (err) {
                    logger.warn(`Failed to queue: ${song.searchQuery}`);
                }
            }
        } catch (error) {
            logger.error('Failed to generate more songs', error);
        }
    }

    public async playNext(): Promise<void> {
        if (this.isProcessing) return;
        this.isProcessing = true;

        // Stop current stream
        await this.streamer.stop();

        if (this.queue.length === 0) {
            // If auto-playlist is enabled, generate more songs
            if (this.autoPlaylist.enabled) {
                await this.generateMoreSongs();

                if (this.queue.length > 0) {
                    this.isProcessing = false;
                    await this.playNext();
                    return;
                }
            }

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
