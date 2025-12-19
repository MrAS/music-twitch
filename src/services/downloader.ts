import path from 'path';
import fs from 'fs-extra';
import execa from 'execa';
import ffmpeg from 'fluent-ffmpeg';
import { AllowedItem } from '../types';
import { config } from '../config';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

export class DownloaderService {
    constructor() {
        fs.ensureDirSync(config.system.cacheDir);
    }

    public async ensure(item: AllowedItem): Promise<string> {
        if (item.source.type === 'local_file') {
            if (!item.source.path) throw new Error('Local file path missing');
            if (!fs.existsSync(item.source.path)) {
                logger.error(`Local file not found: ${item.source.path}`);
                throw new Error('Local file not found');
            }
            return item.source.path;
        }

        if (item.source.type === 'youtube_url') {
            if (!item.source.url) throw new Error('YouTube URL missing');
            const filename = `${item.key}.mp4`;
            const filePath = path.resolve(config.system.cacheDir, filename);

            if (fs.existsSync(filePath)) {
                // Simple check: exists. Could add expiration logic here.
                logger.info(`File cached: ${filePath}`);
                return filePath;
            }

            logger.info(`Downloading ${item.key} from ${item.source.url}...`);
            try {
                // yt-dlp -f 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best' -o filePath
                await execa('yt-dlp', [
                    '-f', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                    '-o', filePath,
                    '--no-playlist',
                    item.source.url
                ]);
                logger.info(`Download complete: ${filePath}`);
                return filePath;
            } catch (error: any) { // Type 'any' to handle unknown error structure from execa
                logger.error('Download failed', error);
                throw error;
            }
        }

        throw new Error('Unknown source type');
    }

    public getDuration(filePath: string): Promise<number> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) return reject(err);
                const duration = metadata.format.duration;
                resolve(duration ? Math.floor(duration) : 0);
            });
        });
    }
}
