import { CatalogService } from './services/catalog';
import { DownloaderService } from './services/downloader';
import { RestreamerService } from './services/restreamer';
import { QueueService } from './services/queue';
import { TwitchBot } from './twitch';

async function main() {
    const catalog = new CatalogService();
    const downloader = new DownloaderService();
    const restreamer = new RestreamerService();
    const queue = new QueueService(downloader, restreamer);
    const bot = new TwitchBot(catalog, queue);

    await bot.connect();
}

main().catch(console.error);
