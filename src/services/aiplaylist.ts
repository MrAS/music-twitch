import axios from 'axios';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

// Pollinations.ai text generation endpoint
const POLLINATIONS_URL = 'https://text.pollinations.ai/';

export interface PlaylistRequest {
    description: string;           // Mood/genre description
    count: number;                 // Number of songs
    mode: 'unique' | 'repeat' | 'shuffle';  // Playlist mode
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

    /**
     * Generate a playlist using AI based on a mood or description
     */
    public async generatePlaylist(request: PlaylistRequest): Promise<GeneratedPlaylist> {
        const { description, count, mode } = request;

        logger.info(`Generating AI playlist: "${description}" with ${count} songs (${mode} mode)`);

        const prompt = `Generate a music playlist of exactly ${count} songs matching: "${description}"

Return ONLY valid JSON (no markdown, no explanation):
{"name":"Playlist Name","description":"mood description","songs":[{"searchQuery":"Artist - Song","title":"Song","artist":"Artist"}]}

Rules:
- searchQuery format: "Artist - Song Title"
- Include popular, well-known songs
- Mix different artists
- For Arabic music, use authentic regional artists`;

        try {
            // Pollinations uses simple GET with URL-encoded prompt
            const encodedPrompt = encodeURIComponent(prompt);
            const response = await axios.get(`${POLLINATIONS_URL}${encodedPrompt}`, {
                timeout: 60000,
                params: {
                    model: 'openai',
                    json: true
                }
            });

            // Parse the response
            let content = response.data;

            // If string, try to parse JSON
            if (typeof content === 'string') {
                // Remove markdown code blocks if present
                content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                // Find JSON object in the response
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    content = JSON.parse(jsonMatch[0]);
                } else {
                    throw new Error('No valid JSON found in response');
                }
            }

            const playlist: GeneratedPlaylist = {
                name: content.name || `${description} Playlist`,
                description: content.description || description,
                songs: content.songs || []
            };

            // Apply mode transformations
            if (mode === 'shuffle') {
                playlist.songs = this.shuffleArray([...playlist.songs]);
            }

            logger.info(`Generated playlist "${playlist.name}" with ${playlist.songs.length} songs`);
            return playlist;

        } catch (error: any) {
            logger.error('AI playlist generation failed:', error.message);
            throw new Error(`Failed to generate playlist: ${error.message}`);
        }
    }

    /**
     * Quick generate based on simple keywords
     */
    public async quickGenerate(keywords: string, count: number = 5): Promise<PlaylistSong[]> {
        const playlist = await this.generatePlaylist({
            description: keywords,
            count,
            mode: 'unique'
        });
        return playlist.songs;
    }

    /**
     * Shuffle array using Fisher-Yates algorithm
     */
    private shuffleArray<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}

export const aiPlaylistService = new AIPlaylistService();
