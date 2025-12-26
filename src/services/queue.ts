import { EnqueuedItem, AllowedItem } from '../types';
import { DownloaderService } from './downloader';
import { StreamerService } from './streamer';
import { config } from '../config';
import { insightsTracker } from './progress';
import winston from 'winston';
import * as fs from 'fs-extra';
import * as path from 'path';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

const STATE_FILE = './queue-state.json';

export interface QueueState {
    queue: EnqueuedItem[];
    current: EnqueuedItem | null;
    lastPlayedVideoId: string;
    suggestionsEnabled: boolean;
}

export interface AutoPlaylistConfig {
    enabled: boolean;
    description: string;
    songsPerBatch: number;
    playedSongs: Set<string>;  // Track already played to ensure uniqueness
    useYouTubeSuggestions: boolean; // Use YouTube's related videos instead of AI
}

export class QueueService {
    private queue: EnqueuedItem[] = [];
    private current: EnqueuedItem | null = null;
    private timer: NodeJS.Timeout | null = null;
    private isProcessing: boolean = false;
    private isPlayingStandby: boolean = false;
    private lastPlayedVideoId: string = ''; // Track last played YouTube video for suggestions
    private autoPlaylist: AutoPlaylistConfig = {
        enabled: false,
        description: '',
        songsPerBatch: 3,
        playedSongs: new Set(),
        useYouTubeSuggestions: false
    };
    private youtubeService: any = null;

    constructor(
        private downloader: DownloaderService,
        private streamer: StreamerService
    ) {
        // Load saved state on startup
        this.loadState();

        // Start standby video on initialization if configured
        if (config.system.standbyVideo) {
            this.playStandby();
        }
    }

    // ===== STATE PERSISTENCE =====
    private saveState(): void {
        try {
            const state: QueueState = {
                queue: this.queue,
                current: this.current,
                lastPlayedVideoId: this.lastPlayedVideoId,
                suggestionsEnabled: this.autoPlaylist.useYouTubeSuggestions
            };
            fs.writeJsonSync(STATE_FILE, state);
            logger.debug('Queue state saved');
        } catch (error) {
            logger.warn('Failed to save queue state', error);
        }
    }

    private loadState(): void {
        try {
            if (fs.existsSync(STATE_FILE)) {
                const state: QueueState = fs.readJsonSync(STATE_FILE);
                this.queue = state.queue || [];
                this.current = state.current;
                this.lastPlayedVideoId = state.lastPlayedVideoId || '';
                this.autoPlaylist.useYouTubeSuggestions = state.suggestionsEnabled || false;
                logger.info(`Loaded queue state: ${this.queue.length} items in queue`);

                // If there was a current item, add it back to front of queue
                if (this.current) {
                    this.queue.unshift(this.current);
                    this.current = null;
                    logger.info(`Restored interrupted song to queue`);
                }

                // Auto-resume: if queue has items, start playing after services init
                if (this.queue.length > 0) {
                    logger.info(`Auto-resuming: ${this.queue.length} items to play`);
                    setTimeout(() => {
                        if (!this.current && !this.isProcessing) {
                            this.playNext();
                        }
                    }, 3000); // Wait 3s for services to initialize
                }
            }
        } catch (error) {
            logger.warn('Could not load queue state, starting fresh');
        }
    }

    public setYouTubeService(youtube: any) {
        this.youtubeService = youtube;
    }

    public enqueue(item: AllowedItem, user: string) {
        const enqueued: EnqueuedItem = { ...item, requestedBy: user };
        this.queue.push(enqueued);
        logger.info(`Enqueued: ${item.key} by ${user}`);

        // Emit queue event
        insightsTracker.queueEvent('enqueued', {
            title: item.title,
            user,
            queueLength: this.queue.length
        });

        // Save state after queue change
        this.saveState();

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
            playedSongs: new Set(),
            useYouTubeSuggestions: false
        };
        logger.info(`Auto-playlist enabled: "${description}" (${songsPerBatch} songs per batch)`);
    }

    public disableAutoPlaylist(): void {
        this.autoPlaylist.enabled = false;
        this.autoPlaylist.useYouTubeSuggestions = false;
        this.autoPlaylist.playedSongs.clear();
        logger.info('Auto-playlist disabled');
    }

    public enableYouTubeSuggestions(): void {
        this.autoPlaylist.enabled = true;
        this.autoPlaylist.useYouTubeSuggestions = true;
        this.autoPlaylist.playedSongs.clear();
        logger.info('YouTube suggestions mode enabled');
        this.saveState();
    }

    public disableYouTubeSuggestions(): void {
        this.autoPlaylist.useYouTubeSuggestions = false;
        if (!this.autoPlaylist.description) {
            this.autoPlaylist.enabled = false;
        }
        logger.info('YouTube suggestions mode disabled');
        this.saveState();
    }

    public isYouTubeSuggestionsEnabled(): boolean {
        return this.autoPlaylist.useYouTubeSuggestions;
    }

    public isAutoPlaylistEnabled(): boolean {
        return this.autoPlaylist.enabled;
    }

    public getAutoPlaylistInfo(): { enabled: boolean; description: string; youTubeSuggestions: boolean } {
        return {
            enabled: this.autoPlaylist.enabled,
            description: this.autoPlaylist.description,
            youTubeSuggestions: this.autoPlaylist.useYouTubeSuggestions
        };
    }

    public async skip(): Promise<void> {
        const skippedTitle = this.current?.title;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        await this.streamer.stop();
        insightsTracker.queueEvent('skipped', { title: skippedTitle });
        this.current = null;
        this.saveState();
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
        insightsTracker.queueEvent('cleared', {});
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
        insightsTracker.queueEvent('auto-generating', {});

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
        insightsTracker.queueEvent('playing', { title: nextItem.title, user: nextItem.requestedBy });

        try {
            // 1. Ensure file exists
            const filePath = await this.downloader.ensure(nextItem);

            // 2. Get duration
            const durationSec = await this.downloader.getDuration(filePath);
            logger.info(`Duration: ${durationSec}s`);

            // 3. Stream via FFmpeg
            await this.streamer.streamFile(filePath, false);
            logger.info('Stream started successfully');

            // 4. If YouTube suggestions enabled, queue next related video
            if (this.autoPlaylist.useYouTubeSuggestions && this.youtubeService && this.queue.length === 0) {
                // Extract video ID from the current item (format: yt_VIDEOID)
                const videoIdMatch = nextItem.key.match(/^yt_([a-zA-Z0-9_-]{11})/);
                if (videoIdMatch) {
                    const currentVideoId = videoIdMatch[1];
                    this.lastPlayedVideoId = currentVideoId;

                    // Fetch related videos in background (don't block playback)
                    this.queueNextRelatedVideo(currentVideoId).catch(err => {
                        logger.error('Failed to queue related video', err);
                    });
                }
            }

            // 5. Set Timer (add small buffer)
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

    /**
     * Queue the next related video from YouTube suggestions
     */
    private async queueNextRelatedVideo(videoId: string): Promise<void> {
        if (!this.youtubeService) return;

        try {
            const related = await this.youtubeService.getRelatedVideos(videoId, 5);

            // Find first related video that hasn't been played
            for (const video of related) {
                if (!this.autoPlaylist.playedSongs.has(video.id)) {
                    logger.info(`Queueing related video: ${video.title}`);

                    // Download and queue
                    const filePath = await this.youtubeService.ensureDownloaded(video.id, video.url);

                    const item: AllowedItem = {
                        key: `yt_${video.id}`,
                        title: video.title,
                        source: { type: 'local_file', path: filePath }
                    };

                    this.queue.push({ ...item, requestedBy: 'YouTube Suggestions' });
                    this.autoPlaylist.playedSongs.add(video.id);

                    insightsTracker.queueEvent('enqueued', {
                        title: video.title,
                        user: 'YouTube Suggestions',
                        queueLength: this.queue.length
                    });

                    return; // Only queue one
                }
            }

            logger.info('No new related videos found');
        } catch (error) {
            logger.error('Failed to get related videos', error);
        }
    }
}
