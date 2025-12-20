import tmi from 'tmi.js';
import { config } from './config';
import { CatalogService } from './services/catalog';
import { QueueService } from './services/queue';
import { YouTubeService } from './services/youtube';
import { AllowedItem, EnqueuedItem } from './types';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

interface CommandLog {
    timestamp: Date;
    user: string;
    command: string;
    args: string;
    action: string;
}

export class TwitchBot {
    private client: tmi.Client;
    private connected: boolean = false;
    private commandLogs: CommandLog[] = [];

    constructor(
        private catalog: CatalogService,
        private queue: QueueService,
        private youtube: YouTubeService
    ) {
        this.client = new tmi.Client({
            options: { debug: true },
            identity: {
                username: config.twitch.username,
                password: config.twitch.token,
            },
            channels: [config.twitch.channel],
        });

        this.client.on('message', this.handleMessage.bind(this));
    }

    public async connect() {
        try {
            await this.client.connect();
            this.connected = true;
            logger.info('Connected to Twitch Chat');
        } catch (error) {
            this.connected = false;
            logger.error('Failed to connect to Twitch', error);
        }
    }

    public isConnected(): boolean {
        return this.connected;
    }

    public getLogs(): CommandLog[] {
        return this.commandLogs.slice(-100);
    }

    private logCommand(user: string, command: string, args: string, action: string) {
        this.commandLogs.push({
            timestamp: new Date(),
            user,
            command,
            args,
            action
        });
        if (this.commandLogs.length > 100) {
            this.commandLogs.shift();
        }
    }

    private async handleMessage(channel: string, tags: tmi.ChatUserstate, msg: string, self: boolean) {
        if (self) return;
        if (!msg.startsWith('@')) return;

        const args = msg.slice(1).split(' ');
        const command = args.shift()?.toLowerCase();
        const isMod = tags.mod || tags.username?.toLowerCase() === channel.replace('#', '').toLowerCase();
        const user = tags.username || 'Unknown';

        switch (command) {
            case 'play':
                if (!isMod) return;
                this.logCommand(user, 'play', args.join(' '), 'Play from catalog');
                this.handlePlay(channel, args.join(' '), user);
                break;
            case 'playid':
                if (!isMod) return;
                this.logCommand(user, 'playid', args[0], 'Play by ID');
                this.handlePlayId(channel, args[0], user);
                break;
            case 'yt':
                if (!isMod) return;
                this.handleYouTubeSearch(channel, args.join(' '), user);
                break;
            case 'yt1': case 'yt2': case 'yt3': case 'yt4': case 'yt5':
            case 'yt6': case 'yt7': case 'yt8': case 'yt9': case 'yt10':
                if (!isMod) return;
                const num = parseInt(command!.replace('yt', ''));
                this.handleYouTubeSelect(channel, num, user);
                break;
            case 'queue':
                this.handleShowQueue(channel);
                break;
            case 'now':
                this.handleNowPlaying(channel);
                break;
            case 'skip':
                if (!isMod) return;
                this.logCommand(user, 'skip', '', 'Skipped');
                await this.queue.skip();
                this.client.say(channel, 'Skipped current track.');
                break;
            case 'stop':
                if (!isMod) return;
                this.logCommand(user, 'stop', '', 'Stopped');
                await this.queue.stop();
                this.client.say(channel, 'Stopped playback and cleared queue.');
                break;
        }
    }

    private handlePlay(channel: string, keywords: string, user: string) {
        if (!keywords) return;
        const results = this.catalog.search(keywords);

        if (results.length === 0) {
            this.client.say(channel, `No matches for "${keywords}" in catalog. Try @yt ${keywords}`);
        } else if (results.length === 1) {
            this.queue.enqueue(results[0], user);
            this.client.say(channel, `Enqueued: ${results[0].title}`);
        } else {
            const top5 = results.slice(0, 5).map((r: AllowedItem) => r.key).join(', ');
            this.client.say(channel, `Multiple matches: ${top5}. Use @playid <key>`);
        }
    }

    private handlePlayId(channel: string, key: string, user: string) {
        if (!key) return;
        const item = this.catalog.getByKey(key);
        if (item) {
            this.queue.enqueue(item, user);
            this.client.say(channel, `Enqueued: ${item.title}`);
        } else {
            this.client.say(channel, `Item "${key}" not found.`);
        }
    }

    private async handleYouTubeSearch(channel: string, query: string, user: string) {
        if (!query) {
            this.client.say(channel, 'Usage: @yt <search query>');
            return;
        }

        this.client.say(channel, `Searching YouTube for "${query}"...`);
        this.logCommand(user, 'yt', query, 'Searching YouTube');

        try {
            const results = await this.youtube.searchMultiple(query, 10);

            if (results.length === 0) {
                this.client.say(channel, `No YouTube results for "${query}".`);
                return;
            }

            // Show results with cache indicator
            const lines: string[] = [];
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                const cached = this.youtube.isCached(r.id) ? '✓' : '';
                const title = r.title.length > 35 ? r.title.substring(0, 35) + '...' : r.title;
                lines.push(`${i + 1}. ${title} ${cached}`);
            }

            // Send results in batches
            this.client.say(channel, `Results (✓=cached):`);
            for (let i = 0; i < lines.length; i += 3) {
                const chunk = lines.slice(i, i + 3).join(' | ');
                this.client.say(channel, chunk);
            }
            this.client.say(channel, `Use @yt1 to @yt${results.length} to play.`);

        } catch (error) {
            logger.error('YouTube search failed', error);
            this.client.say(channel, `Search failed. Try again later.`);
        }
    }

    private async handleYouTubeSelect(channel: string, num: number, user: string) {
        const results = this.youtube.getLastSearchResults();

        if (results.length === 0) {
            this.client.say(channel, 'No search results. Use @yt <query> first.');
            return;
        }

        if (num < 1 || num > results.length) {
            this.client.say(channel, `Invalid. Use @yt1 to @yt${results.length}.`);
            return;
        }

        const result = results[num - 1];
        const cached = this.youtube.isCached(result.id);

        this.logCommand(user, `yt${num}`, result.title, cached ? 'Playing from cache' : 'Downloading');

        try {
            if (cached) {
                this.client.say(channel, `From cache: ${result.title}`);
            } else {
                this.client.say(channel, `Downloading: ${result.title}...`);
            }

            const filePath = await this.youtube.ensureDownloaded(result.id, result.url);

            const item: AllowedItem = {
                key: `yt_${result.id}`,
                title: result.title,
                source: {
                    type: 'local_file',
                    path: filePath
                }
            };

            this.queue.enqueue(item, user);
            this.client.say(channel, `Enqueued: ${result.title}`);

        } catch (error) {
            logger.error('YouTube download failed', error);
            this.client.say(channel, `Download failed. Try again.`);
        }
    }

    private handleShowQueue(channel: string) {
        const q = this.queue.getQueue();
        if (q.length === 0) {
            this.client.say(channel, 'Queue is empty.');
            return;
        }
        const titles = q.slice(0, 3).map((item: EnqueuedItem, i: number) => `${i + 1}. ${item.title}`).join(' | ');
        const more = q.length > 3 ? ` +${q.length - 3} more` : '';
        this.client.say(channel, `Queue: ${titles}${more}`);
    }

    private handleNowPlaying(channel: string) {
        const current = this.queue.getCurrent();
        if (current) {
            this.client.say(channel, `Now: ${current.title} (by @${current.requestedBy})`);
        } else {
            this.client.say(channel, 'Nothing playing.');
        }
    }
}
