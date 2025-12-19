import tmi from 'tmi.js';
import { config } from '../config';
import { CatalogService } from './catalog';
import { QueueService } from './queue';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

export class TwitchBot {
    private client: tmi.Client;

    constructor(
        private catalog: CatalogService,
        private queue: QueueService
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
            logger.info('Connected to Twitch Chat');
        } catch (error) {
            logger.error('Failed to connect to Twitch', error);
        }
    }

    private async handleMessage(channel: string, tags: tmi.ChatUserstate, msg: string, self: boolean) {
        if (self) return;
        if (!msg.startsWith('!')) return;

        const args = msg.slice(1).split(' ');
        const command = args.shift()?.toLowerCase();
        const isMod = tags.mod || tags.username?.toLowerCase() === channel.replace('#', '').toLowerCase();

        // Commands
        switch (command) {
            case 'play':
                if (!isMod) return;
                this.handlePlay(channel, args.join(' '), tags.username || 'Unknown');
                break;
            case 'playid':
                if (!isMod) return;
                this.handlePlayId(channel, args[0], tags.username || 'Unknown');
                break;
            case 'queue':
                this.handleShowQueue(channel);
                break;
            case 'now':
                this.handleNowPlaying(channel);
                break;
            case 'skip':
                if (!isMod) return;
                await this.queue.skip();
                this.client.say(channel, 'Skipped current track.');
                break;
            case 'stop':
                if (!isMod) return;
                await this.queue.stop();
                this.client.say(channel, 'Stopped playback and cleared queue.');
                break;
        }
    }

    private handlePlay(channel: string, keywords: string, user: string) {
        if (!keywords) return;
        const results = this.catalog.search(keywords);

        if (results.length === 0) {
            this.client.say(channel, `No matches for "${keywords}" in catalog.`);
        } else if (results.length === 1) {
            this.queue.enqueue(results[0], user);
            this.client.say(channel, `Enqueued: ${results[0].title}`);
        } else {
            // Show top 5
            const top5 = results.slice(0, 5).map(r => r.key).join(', ');
            this.client.say(channel, `Multiple matches found: ${top5}. Use !playid <key> to select.`);
        }
    }

    private handlePlayId(channel: string, key: string, user: string) {
        if (!key) return;
        const item = this.catalog.getByKey(key);
        if (item) {
            this.queue.enqueue(item, user);
            this.client.say(channel, `Enqueued: ${item.title}`);
        } else {
            this.client.say(channel, `Item with key "${key}" not found.`);
        }
    }

    private handleShowQueue(channel: string) {
        const q = this.queue.getQueue();
        if (q.length === 0) {
            this.client.say(channel, 'Queue is empty.');
            return;
        }
        const titles = q.slice(0, 3).map((item, i) => `${i + 1}. ${item.title}`).join(' | ');
        const more = q.length > 3 ? ` ...and ${q.length - 3} more` : '';
        this.client.say(channel, `Next: ${titles}${more}`);
    }

    private handleNowPlaying(channel: string) {
        const current = this.queue.getCurrent();
        if (current) {
            this.client.say(channel, `Now Playing: ${current.title} (Requested by @${current.requestedBy})`);
        } else {
            this.client.say(channel, 'Nothing is playing.');
        }
    }
}
