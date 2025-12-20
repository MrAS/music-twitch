import axios from 'axios';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

export interface PlaylistRequest {
    description: string;
    count: number;
    mode: 'unique' | 'repeat' | 'shuffle';
}

export interface PlaylistSong {
    searchQuery: string;
    title: string;
    artist?: string;
}

export interface GeneratedPlaylist {
    name: string;
    songs: PlaylistSong[];
    description: string;
}

export class AIPlaylistService {

    public async generatePlaylist(request: PlaylistRequest): Promise<GeneratedPlaylist> {
        const { description, count, mode } = request;

        logger.info(`Generating AI playlist: "${description}" with ${count} songs`);

        // Simple prompt as URL path - pollinations.ai format
        const prompt = `Create JSON playlist of ${count} songs for "${description}". Return ONLY: {"name":"Name","songs":[{"searchQuery":"Artist - Song","title":"Song","artist":"Artist"}]}`;

        try {
            // Use simple GET request with prompt as path
            const url = `https://text.pollinations.ai/${encodeURIComponent(prompt)}`;

            const response = await axios.get(url, {
                timeout: 60000,
                headers: {
                    'User-Agent': 'TwitchMusicBot/1.0'
                }
            });

            let content = response.data;

            if (typeof content === 'string') {
                content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    content = JSON.parse(jsonMatch[0]);
                } else {
                    logger.error(`No JSON in response: ${content.substring(0, 200)}`);
                    throw new Error('No valid JSON found');
                }
            }

            const playlist: GeneratedPlaylist = {
                name: content.name || `${description} Playlist`,
                description: content.description || description,
                songs: content.songs || []
            };

            if (mode === 'shuffle') {
                playlist.songs = this.shuffleArray([...playlist.songs]);
            }

            logger.info(`Generated "${playlist.name}" with ${playlist.songs.length} songs`);
            return playlist;

        } catch (error: any) {
            logger.error(`AI playlist failed: ${error.message}`);
            throw new Error(`Failed to generate playlist: ${error.message}`);
        }
    }

    public async quickGenerate(keywords: string, count: number = 5): Promise<PlaylistSong[]> {
        const playlist = await this.generatePlaylist({ description: keywords, count, mode: 'unique' });
        return playlist.songs;
    }

    private shuffleArray<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}

export const aiPlaylistService = new AIPlaylistService();
