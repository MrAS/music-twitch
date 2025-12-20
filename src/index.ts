import { CatalogService } from './services/catalog';
import { DownloaderService } from './services/downloader';
import { StreamerService } from './services/streamer';
import { RestreamerService } from './services/restreamer';
import { QueueService } from './services/queue';
import { YouTubeService } from './services/youtube';
import { TwitchBot } from './twitch';
import { createServer, setServices } from './server';
import { config } from './config';

async function main() {
    const catalog = new CatalogService();
    const downloader = new DownloaderService();
    const streamer = new StreamerService();
    const restreamer = new RestreamerService(); // Keep for API access
    const queue = new QueueService(downloader, streamer);
    const youtube = new YouTubeService();
    const bot = new TwitchBot(catalog, queue, youtube);

    // Set services for API routes
    setServices({
        catalog,
        queue,
        youtube,
        restreamer,
        streamer,
        twitchBot: bot
    });

    // Start Express server
    const app = createServer();
    app.listen(config.admin.port, () => {
        console.log(`Admin dashboard running at http://localhost:${config.admin.port}`);
    });

    // Connect to Twitch
    await bot.connect();
}

main().catch(console.error);
