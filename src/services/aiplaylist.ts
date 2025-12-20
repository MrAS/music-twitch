import axios from 'axios';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

// Pollinations.ai OpenAI-compatible endpoint
const POLLINATIONS_URL = 'https://text.pollinations.ai/v1/chat/completions';

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

        const prompt = `Generate a music playlist of exactly ${count} songs for: "${description}"

Return ONLY a valid JSON object with this exact structure (no markdown):
{"name":"Playlist Name","description":"mood description","songs":[{"searchQuery":"Artist - Song Title","title":"Song Title","artist":"Artist Name"}]}

Rules:
- searchQuery must be "Artist - Song Title" format for YouTube search
- Include popular, well-known songs that match the mood
- For Arabic music requests, include authentic Arabic artists`;

        try {
            const response = await axios.post(POLLINATIONS_URL, {
                model: 'openai',
                messages: [
                    { role: 'system', content: 'You are a music playlist generator. Return only valid JSON, no markdown or explanation.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8
            }, {
                timeout: 60000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            // Get content from OpenAI-style response
            let content = response.data?.choices?.[0]?.message?.content || response.data;

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
